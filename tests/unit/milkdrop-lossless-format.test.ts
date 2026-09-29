import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';

/**
 * Opening a preset puts Format's output in the editor, so anything Format
 * drops is deleted from the author's file the moment they open it — before
 * they have typed a thing. These pin what it must hand back as written.
 */
const format = (source: string) =>
  compileMilkdropPresetSource(source, { id: `fmt-${source.length}` })
    .formattedSource;

const SHADER_PRESET = [
  'MILKDROP_PRESET_VERSION=201',
  'PSVERSION=2',
  'PSVERSION_WARP=2',
  'PSVERSION_COMP=2',
  '[preset00]',
  'zoom=1.01',
  'comp_1=`sampler sampler_rand00;',
  'comp_2=`float3 tint(float3 c)',
  'comp_3=`{',
  'comp_4=`  return c * 0.5;',
  'comp_5=`}',
  'comp_6=`shader_body',
  'comp_7=`{',
  'comp_8=`  // darken a bit',
  'comp_9=`  ret = tex2D(sampler_main, uv).xyz;',
  'comp_10=`  ret = tint(ret);',
  'comp_11=`  ;',
  'comp_12=`}',
  '',
].join('\n');

describe('Format keeps what the author wrote', () => {
  test('shader text keeps its comments, braces and shader_body', () => {
    const formatted = format(SHADER_PRESET);
    const comp = formatted.split('[comp_shader]\n')[1] ?? '';
    expect(comp.trimEnd()).toBe(
      [
        'sampler sampler_rand00;',
        'float3 tint(float3 c)',
        '{',
        '  return c * 0.5;',
        '}',
        'shader_body',
        '{',
        '  // darken a bit',
        '  ret = tex2D(sampler_main, uv).xyz;',
        '  ret = tint(ret);',
        '  ;',
        '}',
      ].join('\n'),
    );
  });

  test('the shader renders the same after Format', () => {
    const before = compileMilkdropPresetSource(SHADER_PRESET, { id: 'a' });
    const after = compileMilkdropPresetSource(format(SHADER_PRESET), {
      id: 'b',
    });
    expect(after.ir.shaderText.comp).toBe(before.ir.shaderText.comp);
  });

  test('an empty statement in a shader section is shader text, not an INI comment', () => {
    const once = format(SHADER_PRESET);
    expect(format(once)).toBe(once);
    const compiled = compileMilkdropPresetSource(once, { id: 'semi' });
    expect(compiled.ir.shaderText.comp).toBe(
      compileMilkdropPresetSource(SHADER_PRESET, { id: 'semi0' }).ir.shaderText
        .comp,
    );
  });

  test('equation comments survive, trailing and on their own line', () => {
    const formatted = format(
      [
        'title=T',
        'per_frame_1=// bass pump',
        'per_frame_2=zoom = zoom + 0.1*bass; // breathe',
        'per_frame_3=rot = 0.01;',
        'per_frame_4=// the end',
        '',
      ].join('\n'),
    );
    const frame = formatted
      .split('\n')
      .filter((line) => line.startsWith('per_frame_'));
    expect(frame).toEqual([
      'per_frame_1=// bass pump',
      'per_frame_2=zoom = zoom + 0.1*bass; // breathe',
      'per_frame_3=rot = 0.01;',
      'per_frame_4=// the end',
    ]);
    expect(format(formatted)).toBe(formatted);
  });

  test('a block holding only comments is still written', () => {
    const formatted = format('title=T\nper_pixel_1=// q6=dxm;\n');
    expect(formatted).toContain('per_pixel_1=// q6=dxm;');
  });

  test('fields Stims ignores are handed back, last value in first position', () => {
    const formatted = format(
      [
        '[preset00]',
        'b1ed=0.25',
        'MyCustomKey=42',
        'nWrapMode_x=1',
        'MyCustomKey=43',
        'zoom=1.01',
        '',
      ].join('\n'),
    );
    const kept = formatted
      .split('\n')
      .filter((line) => /^(b1ed|MyCustomKey|nWrapMode_x)=/u.test(line));
    expect(kept).toEqual(['b1ed=0.25', 'MyCustomKey=43', 'nWrapMode_x=1']);
    expect(format(formatted)).toBe(formatted);
  });

  test('statements are terminated, as MilkDrop joins a block before compiling', () => {
    const formatted = format(
      'title=T\nper_frame_1=zoom=1.1\nper_frame_2=rot=0.2\n',
    );
    expect(
      formatted.split('\n').filter((line) => line.startsWith('per_frame_')),
    ).toEqual(['per_frame_1=zoom=1.1;', 'per_frame_2=rot=0.2;']);
  });
});
