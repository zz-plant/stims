import { describe, expect, test } from 'bun:test';
import { validatePresetSource } from '../../functions/api/validate-preset.ts';

describe('validate-preset API parser', () => {
  test('validates clean MilkDrop preset source code', () => {
    const source = `[preset00]
fRating=5.000000
fGammaAdj=1.000000
fDecay=0.980000
per_frame_1=wave_r = wave_r + 0.1;
per_frame_2=wave_g = sin(time);
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(true);
    expect(result.fieldCount).toBe(5);
    expect(result.sections).toEqual(['preset00']);
    expect(result.errors).toHaveLength(0);
  });

  test('catches unclosed parentheses in equations', () => {
    const source = `[preset00]
per_frame_1=wave_r = sin(time;
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'unclosed_parentheses')).toBe(
      true,
    );
  });

  test('catches unbalanced parentheses in equations', () => {
    const source = `[preset00]
per_frame_1=wave_r = sin(time));
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'unbalanced_parentheses')).toBe(
      true,
    );
  });

  test('flags lines without assignments as warnings', () => {
    const source = `[preset00]
some random text line without equals sign
fRating=5.0
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'preset_line_ignored')).toBe(
      true,
    );
  });
});
