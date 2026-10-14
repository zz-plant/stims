/**
 * A shader's `ret` is the pixel's colour, three components wide, in both
 * stages; a warp shader's `uv` is where it reads the previous frame. Writing
 * a two-component value to `ret` is an HLSL error, fails to compile on WebGL
 * (`vec3(<vec2>)`), and renders the coordinate as a red-green gradient on
 * WebGPU. The compiler reports it on the offending line instead.
 */
import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../src/compiler.ts';

function retWidthErrors(lines: string[]) {
  return compileMilkdropPresetSource(lines.join('\n'), {
    id: 'ret-width',
  }).diagnostics.filter(
    (diagnostic) => diagnostic.code === 'preset_shader_ret_vec2',
  );
}

describe('shader ret width', () => {
  test('a warp shader that returns a coordinate is an error on that line', () => {
    const errors = retWidthErrors([
      '[preset00]',
      'fDecay=1',
      '[warp_shader]',
      'vec2 c = uv - vec2(0.5, 0.5);',
      'ret = uv + c * 0.1;',
    ]);
    expect(errors).toEqual([
      expect.objectContaining({ severity: 'error', line: 5 }),
    ]);
  });

  test('the read it suggests compiles without the error', () => {
    const shader = ['vec2 c = uv - vec2(0.5, 0.5);', 'ret = uv + c * 0.1;'];
    const [error] = retWidthErrors(['[preset00]', '[warp_shader]', ...shader]);
    const suggestion = /ret = texture2D\(sampler_main, .+\)\.rgb;/u.exec(
      error?.message ?? '',
    )?.[0];
    expect(suggestion).toBe('ret = texture2D(sampler_main, uv + c * 0.1).rgb;');

    const fixed = compileMilkdropPresetSource(
      ['[preset00]', '[warp_shader]', shader[0], suggestion].join('\n'),
      { id: 'ret-width-fixed' },
    );
    expect(
      fixed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    ).toEqual([]);
  });

  test("MilkDrop 2's numbered HLSL lines are checked and located", () => {
    const errors = retWidthErrors([
      '[preset00]',
      'warp_1=`shader_body',
      'warp_2=`{',
      'warp_3=`float2 d = uv - 0.5;',
      'warp_4=`ret = uv + d * q1;',
      'warp_5=`}',
    ]);
    expect(errors).toEqual([expect.objectContaining({ line: 5 })]);
  });

  test('a composite shader returning two components is an error', () => {
    const errors = retWidthErrors([
      '[preset00]',
      '[comp_shader]',
      'ret = texture2D(sampler_main, uv).xy;',
    ]);
    expect(errors).toEqual([
      expect.objectContaining({ severity: 'error', line: 3 }),
    ]);
  });

  test('a compound write of a vec2 is an error too', () => {
    const errors = retWidthErrors([
      '[preset00]',
      '[warp_shader]',
      'ret = texture2D(sampler_main, uv).rgb;',
      'ret += uv * 0.1;',
    ]);
    expect(errors).toEqual([expect.objectContaining({ line: 4 })]);
  });

  test.each([
    ['a scalar, which broadcasts', 'ret = length(uv - 0.5);'],
    ['a three-component swizzle', 'ret = uv.xyx;'],
    ['a vec4 sample, which truncates', 'ret = tex2D(sampler_main, uv);'],
    ['a colour helper', 'ret = GetBlur1(uv);'],
    ['a call whose width is unknown', 'ret = mystery(uv);'],
    ['a two-component swizzle target', 'ret.xy = uv;'],
    ['an undeclared local', 'ret = z;'],
  ])('%s is not flagged', (_label, statement) => {
    expect(retWidthErrors(['[preset00]', '[warp_shader]', statement])).toEqual(
      [],
    );
  });
});
