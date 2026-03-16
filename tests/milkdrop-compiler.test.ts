import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

describe('milkdrop compiler', () => {
  test('compiles preset metadata, scalars, and program statements', () => {
    const compiled = compileMilkdropPresetSource(
      `
title="Smoke Preset"
author=Test Runner
fDecay=0.91
wave_r=0.2 + 0.3
init_1=q1 = 0.4;
per_frame_1=q1 = q1 + 0.1; wave_a = min(1, wave_a + 0.02);
per_pixel_1=zoom = zoom + 0.0;
      `.trim(),
      { id: 'smoke-preset', origin: 'bundled' },
    );

    expect(compiled.source.id).toBe('smoke-preset');
    expect(compiled.title).toBe('Smoke Preset');
    expect(compiled.author).toBe('Test Runner');
    expect(compiled.ir.numericFields.decay).toBeCloseTo(0.91, 4);
    expect(compiled.ir.numericFields.wave_r).toBeCloseTo(0.5, 4);
    expect(compiled.ir.programs.init.statements.length).toBe(1);
    expect(compiled.ir.programs.perFrame.statements.length).toBe(2);
    expect(compiled.ir.programs.perPixel.statements.length).toBe(1);
    expect(
      compiled.diagnostics.some((entry) => entry.severity === 'error'),
    ).toBe(false);
    expect(compiled.formattedSource).toContain('title="Smoke Preset"');
  });

  test('reports unsupported keys and marks compatibility blocks', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Compat Flag
video_echo=1
      `.trim(),
      { id: 'compat-flag' },
    );

    expect(compiled.ir.compatibility.unsupportedKeys).toContain('video_echo');
    expect(compiled.ir.compatibility.webgl).toBe(false);
    expect(compiled.ir.compatibility.webgpu).toBe(false);
    expect(compiled.ir.compatibility.blockingReasons.length).toBeGreaterThan(0);
    expect(
      compiled.diagnostics.some(
        (entry) =>
          entry.code === 'preset_unsupported_field' &&
          entry.field === 'video_echo',
      ),
    ).toBe(true);
  });

  test('surfaces diagnostics for invalid scalar expressions', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Bad Scalar
wave_r=bad(
      `.trim(),
      { id: 'bad-scalar' },
    );

    expect(
      compiled.diagnostics.some(
        (entry) => entry.code === 'preset_invalid_scalar',
      ),
    ).toBe(true);
    expect(
      compiled.diagnostics.some((entry) => entry.severity === 'error'),
    ).toBe(true);
  });
});
