import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  bandReadsOf,
  cachedBandReads,
  NO_BAND_READS,
} from '../../src/js/frontend/preset-band-reads.ts';

const compile = (lines: string[]) =>
  compileMilkdropPresetSource(
    ['[preset00]', 'fDecay=0.98', ...lines].join('\n'),
    {
      id: 'band-reads',
    },
  ).ir;

describe('bandReadsOf', () => {
  test('lights the bands that reach a drawn control', () => {
    expect(
      bandReadsOf(
        compile([
          'per_frame_1=zoom=1.0+bass*0.08;',
          'per_frame_2=rot=rot+treb_att*0.02;',
        ]),
      ),
    ).toEqual({ bass: true, mid: false, treble: true });
  });

  test('follows a band through a q variable into the per-pixel mesh', () => {
    expect(
      bandReadsOf(
        compile(['per_frame_1=q1=mid;', 'per_pixel_1=zoom=1+q1*0.1*rad;']),
      ),
    ).toEqual({ bass: false, mid: true, treble: false });
  });

  test('ignores a band computed but never drawn', () => {
    expect(
      bandReadsOf(
        compile(['per_frame_1=unused=bass*2;', 'per_frame_2=zoom=1.01;']),
      ),
    ).toEqual(NO_BAND_READS);
  });

  test('lights no band for the whole-mix volume', () => {
    expect(bandReadsOf(compile(['per_frame_1=zoom=1+vol*0.05;']))).toEqual(
      NO_BAND_READS,
    );
  });

  test('reads nothing before a compile is on stage', () => {
    expect(cachedBandReads(null)).toBe(NO_BAND_READS);
  });
});
