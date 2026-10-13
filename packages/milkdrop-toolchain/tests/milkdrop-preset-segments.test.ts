import { describe, expect, test } from 'bun:test';
import {
  findMilkdropShaderSegment,
  type MilkdropPresetSegment,
  printMilkdropPresetSegments,
  splitMilkdropPresetSegments,
} from '../src/preset-segments.ts';
import { extractShaderSource } from '../src/shader-source.ts';

/**
 * The segment model has two contracts: it must never lose bytes (printing
 * the split gives the source back exactly) and it must agree with the parser
 * about where shader blocks end — which is the next `[section]` header of
 * any kind, because the parser classifies any bare `[...]` line as a header,
 * even inside a shader body.
 */

const roundTrip = (source: string) =>
  printMilkdropPresetSegments(splitMilkdropPresetSegments(source));

const shaderSegments = (source: string) =>
  splitMilkdropPresetSegments(source).filter(
    (segment): segment is Extract<MilkdropPresetSegment, { kind: 'shader' }> =>
      segment.kind === 'shader',
  );

describe('preset segment split', () => {
  test.each([
    ['empty', ''],
    ['only newlines', '\n\n'],
    ['CRLF', 'zoom=1\r\n[warp_shader]\r\nret = uv;\r\n'],
    ['no final newline', 'zoom=1\n[warp_shader]\nret = uv;'],
    ['lone CR inside a line', 'title=a\rb\n[warp_shader]\nret = uv;\n'],
  ])('reassembles %s byte for byte', (_name, source) => {
    expect(roundTrip(source)).toBe(source);
  });

  test('a source without shader blocks is one equations segment', () => {
    const segments = splitMilkdropPresetSegments(
      '// comment\n[preset00]\nzoom=1\ndecay=0.98\n',
    );
    expect(segments).toEqual([
      {
        kind: 'equations',
        startLine: 1,
        endLine: 4,
        text: '// comment\n[preset00]\nzoom=1\ndecay=0.98\n',
      },
    ]);
  });

  test('splits warp and comp blocks with their header lines', () => {
    const segments = splitMilkdropPresetSegments(
      [
        'zoom=1',
        '[warp_shader]',
        'ret = uv;',
        '[comp_shader]',
        'ret *= 0.5;',
      ].join('\n'),
    );
    expect(segments).toEqual([
      { kind: 'equations', startLine: 1, endLine: 1, text: 'zoom=1\n' },
      {
        kind: 'shader',
        stage: 'warp',
        startLine: 2,
        endLine: 3,
        text: '[warp_shader]\nret = uv;\n',
      },
      {
        kind: 'shader',
        stage: 'comp',
        startLine: 4,
        endLine: 5,
        text: '[comp_shader]\nret *= 0.5;',
      },
    ]);
  });

  test('warp-only sources carry a single shader segment', () => {
    const segments = shaderSegments(
      '[warp_shader]\nvec2 c = uv - vec2(0.5, 0.5);\nret = uv + c * 0.01;\n',
    );
    expect(segments).toEqual([
      {
        kind: 'shader',
        stage: 'warp',
        startLine: 1,
        endLine: 3,
        text: '[warp_shader]\nvec2 c = uv - vec2(0.5, 0.5);\nret = uv + c * 0.01;\n',
      },
    ]);
    expect(findMilkdropShaderSegment('zoom=1\n', 'comp')).toBeNull();
  });

  test('comments, blanks, and #directives stay inside the shader block', () => {
    const source = [
      '[warp_shader]',
      '// wake the feedback',
      '#define TAU 6.283185',
      '',
      'ret = uv;',
    ].join('\n');
    const [warp] = shaderSegments(source);
    expect(warp?.startLine).toBe(1);
    expect(warp?.endLine).toBe(5);
    expect(warp?.text).toBe(source);
  });

  test('a bracket-only line ends the block, matching the parser', () => {
    // The parser treats any line that is just a `[...]` group as a section
    // header, so this ends the warp block at line 3 and reopens equations.
    const source = ['[warp_shader]', 'ret = uv;', '[something]', 'zoom=1'].join(
      '\n',
    );
    const segments = splitMilkdropPresetSegments(source);
    expect(segments).toEqual([
      {
        kind: 'shader',
        stage: 'warp',
        startLine: 1,
        endLine: 2,
        text: '[warp_shader]\nret = uv;\n',
      },
      {
        kind: 'equations',
        startLine: 3,
        endLine: 4,
        text: '[something]\nzoom=1',
      },
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  test('bracketed array lines inside the body do not end the block', () => {
    const source = '[comp_shader]\nfloat taps[4];\nret = uv;\n';
    const [comp] = shaderSegments(source);
    expect(comp?.endLine).toBe(3);
    expect(comp?.text).toBe(source);
  });

  test('re-opening a shader section starts a second block', () => {
    const source = [
      '[warp_shader]',
      'ret = uv;',
      '[preset00]',
      'zoom=1',
      '[warp_shader]',
      'ret = uv * 2.0;',
    ].join('\n');
    const warps = shaderSegments(source);
    expect(warps.map((w) => w.startLine)).toEqual([1, 5]);
    expect(findMilkdropShaderSegment(source, 'warp')?.startLine).toBe(1);
    expect(roundTrip(source)).toBe(source);
  });

  test('the segment body agrees with extractShaderSource', () => {
    const source = [
      '[warp_shader]',
      '// keep me',
      '',
      'ret = uv;',
      '[comp_shader]',
      'ret = tex2D(sampler_main, uv).xyz;',
    ].join('\n');
    const recovered = extractShaderSource(source);
    const bodyOf = (stage: 'warp' | 'comp') => {
      const segment = findMilkdropShaderSegment(source, stage);
      expect(segment).not.toBeNull();
      const lines = (
        segment as Extract<MilkdropPresetSegment, { kind: 'shader' }>
      ).text.split('\n');
      // The header is the first line; a block that ends with a terminator
      // leaves a trailing '' element after the split.
      return (lines.at(-1) === '' ? lines.slice(1, -1) : lines.slice(1)).join(
        '\n',
      );
    };
    expect(recovered.warp).not.toBeNull();
    expect(recovered.comp).not.toBeNull();
    expect(bodyOf('warp')).toBe(recovered.warp as string);
    expect(bodyOf('comp')).toBe(recovered.comp as string);
  });

  test('uppercase headers and MilkDrop 2 warp_N assignments follow the parser', () => {
    const source = [
      '[Preset00]',
      'warp_1=`ret = uv;',
      '[WARP_SHADER]',
      'ret = uv + 0.1;',
    ].join('\n');
    const segments = splitMilkdropPresetSegments(source);
    // warp_1 is an assignment line in a non-shader section, so it belongs to
    // the equations segment; the uppercase header opens the warp block.
    expect(segments).toEqual([
      {
        kind: 'equations',
        startLine: 1,
        endLine: 2,
        text: '[Preset00]\nwarp_1=`ret = uv;\n',
      },
      {
        kind: 'shader',
        stage: 'warp',
        startLine: 3,
        endLine: 4,
        text: '[WARP_SHADER]\nret = uv + 0.1;',
      },
    ]);
    expect(roundTrip(source)).toBe(source);
  });
});
