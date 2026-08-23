import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWLIST_PATH,
  diagnose,
  flipPixels,
  gridMismatch,
  loadBackendDivergenceAllowlist,
  matchAllowlist,
  noiseCeiling,
  samplePresetIds,
  shiftPixels,
  signedChannelOffsets,
} from '../../scripts/preset-lab-backend-diff.ts';

type Pixels = {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
};

/** Two horizontal bands, so a vertical flip is detectable and a horizontal one is not. */
function bandedImage(topColour: number, bottomColour: number): Pixels {
  const width = 4;
  const height = 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = y < height / 2 ? topColour : bottomColour;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, channels: 4, data };
}

describe('preset-lab-backend-diff pixel helpers', () => {
  it('flips row order vertically', () => {
    const image = bandedImage(0, 255);
    const flipped = flipPixels(image as never, 'vertical') as unknown as Pixels;
    expect(flipped.data[0]).toBe(255);
    expect(flipped.data[flipped.data.length - 4]).toBe(0);
  });

  it('leaves a vertically symmetric image alone under a horizontal flip', () => {
    const image = bandedImage(0, 255);
    const flipped = flipPixels(
      image as never,
      'horizontal',
    ) as unknown as Pixels;
    expect([...flipped.data]).toEqual([...image.data]);
  });

  it('reports the mean signed per-channel offset', () => {
    const a = bandedImage(120, 120);
    const b = bandedImage(100, 100);
    const offsets = signedChannelOffsets(a as never, b as never);
    expect(offsets[0]).toBeCloseTo(20, 5);
    expect(offsets[2]).toBeCloseTo(20, 5);
  });

  it('cancels a constant offset when the offset is subtracted', () => {
    const a = bandedImage(120, 120);
    const b = bandedImage(100, 100);
    const offsets = signedChannelOffsets(a as never, b as never);
    const shifted = shiftPixels(a as never, offsets) as unknown as Pixels;
    expect([...shifted.data]).toEqual([...b.data]);
  });

  it('localises mismatch to the cells that actually differ', () => {
    const a = bandedImage(0, 0);
    const b = bandedImage(255, 0);
    const cells = gridMismatch(a as never, b as never, 16);
    const top = cells.filter((cell) => cell.row === 0);
    const bottom = cells.filter((cell) => cell.row === 2);
    expect(top.every((cell) => cell.mismatchRatio === 1)).toBe(true);
    expect(bottom.every((cell) => cell.mismatchRatio === 0)).toBe(true);
  });
});

describe('preset-lab-backend-diff diagnosis', () => {
  const noiseFloor = 0.02;

  it('calls a cross-backend number inside the noise ceiling a match', () => {
    expect(
      diagnose({
        cross: 0.05,
        flipVertical: 0.4,
        flipHorizontal: 0.4,
        offsetCorrected: 0.05,
        noiseFloor,
      }),
    ).toBe('within-noise');
  });

  it('names a mirrored frame when the flipped comparison is far better', () => {
    // This is the line that would have caught the inverted WebGPU render
    // target row order on sight.
    expect(
      diagnose({
        cross: 0.82,
        flipVertical: 0.03,
        flipHorizontal: 0.8,
        offsetCorrected: 0.82,
        noiseFloor,
      }),
    ).toBe('mirrored-vertical');
  });

  it('names a colour shift when subtracting a constant offset explains it', () => {
    expect(
      diagnose({
        cross: 0.95,
        flipVertical: 0.96,
        flipHorizontal: 0.96,
        offsetCorrected: 0.02,
        noiseFloor,
      }),
    ).toBe('uniform-colour-offset');
  });

  it('falls through to structural when nothing explains the gap', () => {
    expect(
      diagnose({
        cross: 0.6,
        flipVertical: 0.62,
        flipHorizontal: 0.61,
        offsetCorrected: 0.59,
        noiseFloor,
      }),
    ).toBe('structural');
  });

  it('keeps an absolute floor so a perfectly quiet preset is not hair-trigger', () => {
    expect(noiseCeiling(0)).toBeGreaterThan(0);
    expect(
      diagnose({
        cross: 0.004,
        flipVertical: 0.9,
        flipHorizontal: 0.9,
        offsetCorrected: 0.004,
        noiseFloor: 0,
      }),
    ).toBe('within-noise');
  });
});

describe('preset-lab-backend-diff sampling and allowlist', () => {
  it('samples the same presets for the same count and seed', () => {
    const ids = Array.from({ length: 100 }, (_, index) => `p${index}`);
    expect(samplePresetIds(ids, 10, 0)).toEqual(samplePresetIds(ids, 10, 0));
  });

  it('spreads the sample across the corpus rather than taking a prefix', () => {
    const ids = Array.from(
      { length: 100 },
      (_, index) => `p${String(index).padStart(3, '0')}`,
    );
    const sample = samplePresetIds(ids, 10, 0);
    expect(sample.length).toBe(10);
    expect(sample.at(-1)).not.toBe('p009');
  });

  it('matches allowlist entries by id and by pattern', () => {
    const allowlist = {
      presets: { 'a-preset': { reason: 'known', maxMismatchRatio: 0.5 } },
      patterns: [{ test: '^warp-', reason: 'no per-pixel warp on WebGL' }],
    };
    expect(matchAllowlist(allowlist, 'a-preset')?.maxMismatchRatio).toBe(0.5);
    expect(matchAllowlist(allowlist, 'warp-thing')?.reason).toContain('warp');
    expect(matchAllowlist(allowlist, 'unlisted')).toBeNull();
  });

  it('ships a parseable allowlist that every entry justifies', () => {
    expect(fs.existsSync(path.join(process.cwd(), ALLOWLIST_PATH))).toBe(true);
    const allowlist = loadBackendDivergenceAllowlist(process.cwd());
    for (const [id, entry] of Object.entries(allowlist.presets ?? {})) {
      expect(entry.reason?.length, `${id} needs a reason`).toBeGreaterThan(10);
    }
    for (const pattern of allowlist.patterns ?? []) {
      expect(pattern.reason?.length).toBeGreaterThan(10);
      expect(() => new RegExp(pattern.test)).not.toThrow();
    }
  });
});
