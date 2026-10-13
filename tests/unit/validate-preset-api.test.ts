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

  test('rejects expressions the real compiler cannot parse', () => {
    const source = `[preset00]
per_frame_1=wave_r = sin(time;
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(error.severity).toBe('error');
      expect(typeof error.code).toBe('string');
      expect(typeof error.message).toBe('string');
      expect(error.line).toBe(2);
    }
  });

  test('rejects expressions with trailing tokens after a complete expression', () => {
    const source = `[preset00]
per_frame_1=wave_r = sin(time));
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('rejects a per-pixel program that fails to compile', () => {
    const source = `[preset00]
per_pixel_1=zoom = zoom + ^ 2 3;
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('warns on lines without assignments without failing validation', () => {
    const source = `[preset00]
some random text line without equals sign
fRating=5.0
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const warning of result.warnings) {
      expect(warning.severity).toBe('warning');
    }
  });

  test('keeps shader lines as fields with shader sections listed', () => {
    const source = `[preset00]
comp_shader=
shader_body
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(true);
    expect(result.sections).toEqual(['preset00']);
    expect(result.fieldCount).toBe(1);
  });

  test('maps toolchain diagnostics onto the route wire shape', () => {
    const source = `[preset00]
per_frame_1=x = (1;
`;

    const result = validatePresetSource(source);
    expect(result.valid).toBe(false);
    for (const diagnostic of [...result.errors, ...result.warnings]) {
      expect(Object.keys(diagnostic).sort()).toEqual([
        'code',
        'line',
        'message',
        'severity',
      ]);
      expect(['error', 'warning']).toContain(diagnostic.severity);
    }
  });

  test('accepts a real-world bundled preset source', async () => {
    const source = await Bun.file(
      'public/milkdrop-presets/krash-rovastar-cerebral-demons-stars.milk',
    ).text();
    const result = validatePresetSource(source);
    expect(result.valid).toBe(true);
    expect(result.sections).toContain('preset00');
    expect(result.fieldCount).toBeGreaterThan(10);
  });
});
