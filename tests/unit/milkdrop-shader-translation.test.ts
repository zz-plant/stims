import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { resolveShaderExecutionMode } from '../../src/js/milkdrop/shader-execution-mode.ts';
import { describeShaderTranslations } from '../../src/js/milkdrop/shader-translation.ts';

const compile = (source: string) =>
  compileMilkdropPresetSource(source, {
    id: `shader-translation-${source.length}`,
  });

describe('shader translation view', () => {
  test('a preset without shaders has nothing to show', () => {
    expect(describeShaderTranslations(compile('title=T\nzoom=1.01\n'))).toEqual(
      [],
    );
  });

  test('a simple warp shader is translated to GLSL from its statements', () => {
    const [warp] = describeShaderTranslations(
      compile(
        [
          'title=T',
          '[warp_shader]',
          'shader_body {',
          '  ret = tex2D(sampler_main, uv).xyz * 0.98;',
          '}',
        ].join('\n'),
      ),
    );
    expect(warp?.stage).toBe('warp');
    expect(warp?.source).toContain('tex2D(sampler_main, uv)');
    expect(warp?.glsl).toBeTruthy();
    // HLSL tex2D does not exist in GLSL; the translation must not contain it.
    expect(warp?.glsl).not.toContain('tex2D(');
  });

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
