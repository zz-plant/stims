import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { resolveShaderExecutionMode } from 'milkdrop-toolchain/src/shader-execution-mode.ts';
import { describeShaderTranslations } from 'milkdrop-toolchain/src/shader-translation.ts';

const compile = (source: string) =>
  compileMilkdropPresetSource(source, {
    id: `shader-translation-${source.length}`,
  });

describe('shader translation view', () => {
  test('matches what the renderer compiles for a real bundled preset', () => {
    const compiled = compile(
      readFileSync(
        'public/milkdrop-presets/libraries/projectm-cream-of-the-crop/cotc-royal-mashup-395.milk',
        'utf8',
      ),
    );
    const byStage = Object.fromEntries(
      describeShaderTranslations(compiled).map((t) => [t.stage, t]),
    );
    const { compProgram } = compiled.ir.shaderText;
    // A native shader body is converted as a whole, and the renderer uses
    // that rawGlsl verbatim when it is present.
    expect(byStage.comp?.path).toBe('body');
    expect(byStage.comp?.glsl).toBe(compProgram?.rawGlsl ?? null);
    expect(byStage.comp?.glsl).not.toContain('tex2D(');
    // Per-renderer execution is the shared answer, not re-derived here.
    expect(byStage.comp?.execution).toEqual({
      webgl: resolveShaderExecutionMode(compiled, 'webgl'),
      webgpu: resolveShaderExecutionMode(compiled, 'webgpu'),
    });
    expect(byStage.comp?.execution.webgl).toBe('direct');
  });
});
