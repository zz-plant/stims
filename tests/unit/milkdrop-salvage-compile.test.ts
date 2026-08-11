import { describe, expect, test } from 'bun:test';
import {
  countEquationLines,
  salvageCompileMilkdropPreset,
} from '../../src/js/milkdrop/salvage-compile.ts';

const VALID_SOURCE = `[preset00]
fRating=5.0
fDecay=0.98
nWaveMode=7
per_frame_1=zoom=1.02+bass_att*0.02
per_pixel_1=zoom=(zoom-1)*rad+1
`;

// Unbalanced parenthesis on a per_frame line — the failure shape from the
// bug report ("Expected a comma or closing parenthesis in function call.").
const ONE_BROKEN_LINE = `[preset00]
fRating=5.0
per_frame_1=zoom = 1.01 + 0.02*sin(time
per_frame_2=rot = 0.1*bass_att;
`;

const TWO_BROKEN_LINES = `[preset00]
fRating=5.0
per_frame_1=zoom = 1.01 + 0.02*sin(time
per_frame_2=wave_r = min(1, wave_r + 0.3*(bass(
per_frame_3=rot = 0.1*bass_att;
`;

// fRating is a plain param, not an equation key, so a parse error here is
// not line-droppable — the model produced a genuinely malformed value, not
// a slip in one equation among many.
const BROKEN_STRUCTURAL_LINE = `[preset00]
fRating=(unbalanced
per_frame_1=zoom=1.02+bass_att*0.02
`;

describe('countEquationLines', () => {
  test('counts per_frame/per_pixel/init/wavecode/shapecode/warp/comp lines', () => {
    expect(countEquationLines(VALID_SOURCE)).toBe(2);
  });

  test('does not count plain params or the section header', () => {
    const source = `[preset00]\nfRating=5.0\nfDecay=0.98\nnWaveMode=7\n`;
    expect(countEquationLines(source)).toBe(0);
  });
});

describe('salvageCompileMilkdropPreset', () => {
  test('compiles clean source with nothing dropped', () => {
    const result = salvageCompileMilkdropPreset(VALID_SOURCE, {
      id: 'clean',
      title: 'clean',
      origin: 'generated',
    });
    expect(result).not.toBeNull();
    expect(result?.dropped).toEqual([]);
    expect(
      result?.compiled.diagnostics.filter((d) => d.severity === 'error'),
    ).toEqual([]);
  });

  test('drops a single broken equation line and compiles the rest', () => {
    const result = salvageCompileMilkdropPreset(ONE_BROKEN_LINE, {
      id: 'one-broken',
      title: 'one-broken',
      origin: 'generated',
    });
    expect(result).not.toBeNull();
    expect(result?.dropped).toHaveLength(1);
    expect(result?.dropped[0]?.text).toContain('sin(time');
    expect(
      result?.compiled.diagnostics.filter((d) => d.severity === 'error'),
    ).toEqual([]);
    // The surviving line's equation must still be present in the recompiled
    // source — salvage should not have collaterally dropped it too.
    expect(result?.compiled.source.raw).toContain('rot = 0.1*bass_att');
  });

  test('drops multiple broken lines across repair rounds', () => {
    const result = salvageCompileMilkdropPreset(TWO_BROKEN_LINES, {
      id: 'two-broken',
      title: 'two-broken',
      origin: 'generated',
    });
    expect(result).not.toBeNull();
    expect(result?.dropped).toHaveLength(2);
    expect(
      result?.compiled.diagnostics.filter((d) => d.severity === 'error'),
    ).toEqual([]);
    expect(result?.compiled.source.raw).toContain('rot = 0.1*bass_att');
  });

  test('gives up when the compile error is on a non-equation line', () => {
    const result = salvageCompileMilkdropPreset(BROKEN_STRUCTURAL_LINE, {
      id: 'broken-header',
      title: 'broken-header',
      origin: 'generated',
    });
    expect(result).toBeNull();
  });

  test('gives up past maxDrops instead of gutting the whole preset', () => {
    const lines = ['[preset00]', 'fRating=5.0'];
    for (let i = 0; i < 5; i++) {
      lines.push(`per_frame_${i}=zoom = 1.0 + sin(time`);
    }
    const source = lines.join('\n');
    const result = salvageCompileMilkdropPreset(
      source,
      { id: 'too-broken', title: 'too-broken', origin: 'generated' },
      { maxDrops: 2 },
    );
    expect(result).toBeNull();
  });
});
