import { describe, expect, it } from 'bun:test';
import {
  buildAudioProfile,
  describeAudioProfile,
} from '../../src/js/core/services/audio-matcher.ts';
import {
  computeFrameStats,
  describeFrameParts,
} from '../../src/js/core/services/visual-embedding.ts';
import {
  getAudioBands,
  setAudioBands,
  subscribeAudioEnergy,
} from '../../src/js/frontend/engine-audio-energy-store.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { estimatePresetMotion } from '../../src/js/milkdrop/preset-motion-estimate.ts';

/**
 * The visual search only works if both sides of the index speak one
 * vocabulary. Queries describe palette, edges and motion; presets used to be
 * described as `Preset titled "X", by Y`, so cosine matching degenerated into
 * a filename lottery — measured against production, a real query scored 0.684
 * and deliberate gibberish scored 0.600.
 */

function solidFrame(
  rgb: [number, number, number],
  size = 8,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = rgb[0];
    pixels[i * 4 + 1] = rgb[1];
    pixels[i * 4 + 2] = rgb[2];
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

describe('computeFrameStats', () => {
  it('reports no edges and no motion for a flat frame', () => {
    const stats = computeFrameStats(solidFrame([200, 30, 30]), 8, 8, null);
    expect(stats.edgeDensity).toBeCloseTo(0, 6);
    expect(stats.motionEstimate).toBeCloseTo(0, 6);
  });

  it('detects edges across a hard boundary', () => {
    const size = 8;
    const pixels = solidFrame([0, 0, 0], size);
    for (let y = 0; y < size; y += 1) {
      for (let x = size / 2; x < size; x += 1) {
        const idx = (y * size + x) * 4;
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
      }
    }
    const stats = computeFrameStats(pixels, size, size, null);
    expect(stats.edgeDensity).toBeGreaterThan(0);
  });

  it('measures motion against a previous frame', () => {
    const stats = computeFrameStats(
      solidFrame([255, 255, 255]),
      8,
      8,
      solidFrame([0, 0, 0]),
    );
    expect(stats.motionEstimate).toBeGreaterThan(0.9);
  });

  it('ignores a previous frame of a different size', () => {
    // Guards the resize case: comparing mismatched buffers would read
    // garbage rather than motion.
    const stats = computeFrameStats(
      solidFrame([255, 255, 255], 8),
      8,
      8,
      solidFrame([0, 0, 0], 4),
    );
    expect(stats.motionEstimate).toBeCloseTo(0, 6);
  });
});

describe('describeFrameParts', () => {
  it('names the dominant hue', () => {
    const red = describeFrameParts(
      computeFrameStats(solidFrame([220, 20, 20]), 8, 8, null),
    );
    const blue = describeFrameParts(
      computeFrameStats(solidFrame([20, 20, 220]), 8, 8, null),
    );
    expect(red).toContain('red');
    expect(blue).toContain('blue');
    expect(red).not.toBe(blue);
  });

  it('always emits all three axes so both sides align', () => {
    const text = describeFrameParts({
      histogram: new Array(24).fill(0.04),
      edgeDensity: 0.2,
      motionEstimate: 0.2,
    });
    expect(text).toContain('dominant');
    expect(text).toContain('edges');
    expect(text).toContain('motion');
  });
});

describe('estimatePresetMotion', () => {
  const motionOf = (source: string) =>
    estimatePresetMotion(
      compileMilkdropPresetSource(source, { id: 'motion-probe' }),
    );

  it('reports near zero for an identity transform', () => {
    expect(motionOf('zoom=1\nrot=0\ndx=0\ndy=0\nwarp=0\n')).toBeLessThan(0.01);
  });

  it('grows with zoom away from 1', () => {
    expect(motionOf('zoom=1.4\n')).toBeGreaterThan(motionOf('zoom=1.02\n'));
  });

  it('counts drift and rotation', () => {
    expect(motionOf('dx=0.2\n')).toBeGreaterThan(motionOf('dx=0\n'));
    expect(motionOf('rot=0.6\n')).toBeGreaterThan(motionOf('rot=0\n'));
  });

  it('treats an audio-driven preset as moving even at identity', () => {
    // Most of the interesting catalog recomputes its transform every frame,
    // so reading only the literal fields would call them all static.
    const still = motionOf('zoom=1\n');
    const driven = motionOf('zoom=1\nper_frame_1=zoom = 1 + bass_att*0.1\n');
    expect(driven).toBeGreaterThan(still);
  });

  it('stays within the frame-motion scale it is compared against', () => {
    expect(
      motionOf('zoom=3\ndx=0.5\ndy=0.5\nrot=1\nwarp=10\n'),
    ).toBeLessThanOrEqual(1);
  });
});

describe('describeAudioProfile', () => {
  it('speaks the same vocabulary as the frame description', () => {
    const text = describeAudioProfile(
      buildAudioProfile({ audioEnergy: 0.1, fftBands: [0.6, 0.3, 0.1] }),
    );
    expect(text).toContain('dominant');
    expect(text).toContain('motion');
  });

  it('varies with spectral balance, not just loudness', () => {
    // The regression this replaces: the old implementation read rms and
    // discarded the other five fields, leaving five possible queries total.
    const bassy = describeAudioProfile(
      buildAudioProfile({ audioEnergy: 0.1, fftBands: [0.9, 0.05, 0.05] }),
    );
    const bright = describeAudioProfile(
      buildAudioProfile({ audioEnergy: 0.1, fftBands: [0.05, 0.05, 0.9] }),
    );
    expect(bassy).not.toBe(bright);
  });

  it('varies with loudness at a fixed spectral balance', () => {
    const quiet = describeAudioProfile(
      buildAudioProfile({ audioEnergy: 0.01, fftBands: [0.4, 0.4, 0.2] }),
    );
    const loud = describeAudioProfile(
      buildAudioProfile({ audioEnergy: 0.2, fftBands: [0.4, 0.4, 0.2] }),
    );
    expect(quiet).not.toBe(loud);
  });

  it('produces many distinct queries across plausible inputs', () => {
    const seen = new Set<string>();
    for (const energy of [0.001, 0.01, 0.04, 0.1, 0.3]) {
      for (const bands of [
        [0.9, 0.05, 0.05],
        [0.3, 0.4, 0.3],
        [0.05, 0.15, 0.8],
        [0.5, 0.3, 0.2],
      ]) {
        seen.add(
          describeAudioProfile(
            buildAudioProfile({ audioEnergy: energy, fftBands: bands }),
          ),
        );
      }
    }
    // The old implementation returned one of five strings for every possible
    // input, so two tracks at equal volume were indistinguishable.
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('audio band plumbing', () => {
  it('fabricates bands only when none are supplied', () => {
    // The fallback exists so a caller with nothing but a loudness scalar
    // still gets a profile — but it invents the 0.6/0.3/0.1 split, so a
    // caller that has real bands must pass them.
    const fabricated = buildAudioProfile({ audioEnergy: 0.5 });
    expect(fabricated.bassEnergy).toBeCloseTo(0.3, 6);
    expect(fabricated.midEnergy).toBeCloseTo(0.15, 6);
    expect(fabricated.trebleEnergy).toBeCloseTo(0.05, 6);

    const real = buildAudioProfile({
      audioEnergy: 0.5,
      fftBands: [0.1, 0.2, 0.9],
    });
    expect(real.bassEnergy).toBeCloseTo(0.1, 6);
    expect(real.midEnergy).toBeCloseTo(0.2, 6);
    expect(real.trebleEnergy).toBeCloseTo(0.9, 6);
  });

  it('describes a bright track differently from a bassy one at equal loudness', () => {
    // The end-to-end point of plumbing bands: this pair was byte-identical
    // before, because only rms reached the description.
    const bassy = describeAudioProfile(
      buildAudioProfile({ audioEnergy: 0.12, fftBands: [1.4, 0.3, 0.2] }),
    );
    const bright = describeAudioProfile(
      buildAudioProfile({ audioEnergy: 0.12, fftBands: [0.2, 0.3, 1.4] }),
    );
    expect(bassy).not.toBe(bright);
    expect(bassy).toContain('red');
    expect(bright).toContain('cyan');
  });
});

describe('audio band store', () => {
  it('carries bands and only wakes subscribers on a real change', () => {
    // The seam that made the whole audio search possible: before this the
    // store held one scalar, so the search could not see spectral balance
    // even though the engine had been computing it every frame all along.
    setAudioBands({ bass: 1.4, mid: 0.6, treble: 0.2 });
    expect(getAudioBands()).toEqual({ bass: 1.4, mid: 0.6, treble: 0.2 });

    let wakeups = 0;
    const unsubscribe = subscribeAudioEnergy(() => {
      wakeups += 1;
    });

    // Below the dead band: these update every frame during playback, so an
    // unconditional notify would wake every subscriber 60 times a second.
    setAudioBands({ bass: 1.4001, mid: 0.6, treble: 0.2 });
    expect(wakeups).toBe(0);

    setAudioBands({ bass: 0.2, mid: 0.5, treble: 1.5 });
    expect(wakeups).toBe(1);
    expect(getAudioBands().treble).toBeCloseTo(1.5, 6);

    unsubscribe();
    setAudioBands({ bass: 0, mid: 0, treble: 0 });
    expect(wakeups).toBe(1);
  });
});
