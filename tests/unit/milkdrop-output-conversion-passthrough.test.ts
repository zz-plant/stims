import { describe, expect, it } from 'bun:test';
import { renderWithoutOutputConversion } from '../../src/js/milkdrop/output-conversion-passthrough.ts';

const ACES_FILMIC_TONE_MAPPING = 4;

describe('renderWithoutOutputConversion', () => {
  it('suspends tone mapping and the sRGB encode for the duration of the render', () => {
    const renderer = {
      toneMapping: ACES_FILMIC_TONE_MAPPING,
      outputColorSpace: 'srgb',
    };
    const seen: Array<{ toneMapping: number; outputColorSpace: string }> = [];

    renderWithoutOutputConversion(renderer, () => {
      seen.push({
        toneMapping: renderer.toneMapping,
        outputColorSpace: renderer.outputColorSpace,
      });
    });

    // MilkDrop colours are display-referred: an ACES-tone-mapped canvas turns
    // the certified 100-square border from (255,0,0) into (251,16,20).
    expect(seen).toEqual([{ toneMapping: 0, outputColorSpace: 'srgb-linear' }]);
  });

  it('restores the renderer settings afterwards', () => {
    const renderer = {
      toneMapping: ACES_FILMIC_TONE_MAPPING,
      outputColorSpace: 'srgb',
    };

    renderWithoutOutputConversion(renderer, () => undefined);

    expect(renderer.toneMapping).toBe(ACES_FILMIC_TONE_MAPPING);
    expect(renderer.outputColorSpace).toBe('srgb');
  });

  it('restores the renderer settings when the render throws', () => {
    const renderer = {
      toneMapping: ACES_FILMIC_TONE_MAPPING,
      outputColorSpace: 'srgb',
    };

    expect(() =>
      renderWithoutOutputConversion(renderer, () => {
        throw new Error('device lost');
      }),
    ).toThrow('device lost');
    expect(renderer.toneMapping).toBe(ACES_FILMIC_TONE_MAPPING);
    expect(renderer.outputColorSpace).toBe('srgb');
  });

  it('returns the render result and tolerates a renderer that has neither setting', () => {
    expect(renderWithoutOutputConversion({}, () => 'painted')).toBe('painted');
    expect(renderWithoutOutputConversion(null, () => 'painted')).toBe(
      'painted',
    );
  });

  it('leaves a renderer that already bypasses both conversions untouched', () => {
    const renderer = { toneMapping: 0, outputColorSpace: 'srgb-linear' };
    let observed: unknown = null;

    renderWithoutOutputConversion(renderer, () => {
      observed = { ...renderer };
    });

    expect(observed).toEqual({
      toneMapping: 0,
      outputColorSpace: 'srgb-linear',
    });
    expect(renderer).toEqual({
      toneMapping: 0,
      outputColorSpace: 'srgb-linear',
    });
  });
});
