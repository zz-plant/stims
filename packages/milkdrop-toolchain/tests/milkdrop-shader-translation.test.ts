import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../src/compiler.ts';
import { describeShaderTranslations } from '../src/shader-translation.ts';

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
});
