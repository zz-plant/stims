/**
 * Shader-block highlighting in the preset editor language — the token
 * stream inside `[warp_shader]`/`[comp_shader]` must read as the GLSL dialect
 * the engine compiles (types, stage variables, `sampler_*` references,
 * intrinsics, `#` directives), while everything outside the blocks keeps the
 * EEL2 highlighting the editor has always had. The parser's own semantics
 * decide where blocks end: a bare `[...]` line is a section header even
 * inside a shader body.
 */
import { describe, expect, test } from 'bun:test';
import { StringStream } from '@codemirror/language';
import { milkdropParser } from '../../src/js/milkdrop/overlay/editor-language.ts';

type Token = { text: string; type: string | null };

/**
 * Tokenizes each line of a source with the parser's own state carried
 * across lines, the way StreamLanguage does — a header line has to move the
 * following lines into (and out of) shader mode.
 */
function tokenizeLines(source: string): Token[][] {
  const state = milkdropParser.startState
    ? milkdropParser.startState(0)
    : { afterEquals: false, section: null };
  return source.split('\n').map((line) => {
    const stream = new StringStream(line, 2, 0);
    const tokens: Token[] = [];
    while (!stream.eol()) {
      const pos = stream.pos;
      // StreamLanguage's readToken resets the token start before every
      // call — current() is only meaningful with that reset.
      stream.start = pos;
      const type = milkdropParser.token(stream, state);
      if (stream.pos === pos) {
        stream.next();
      }
      tokens.push({ text: line.slice(pos, stream.pos), type });
    }
    // StreamLanguage resets nothing between lines; the section persists.
    return tokens;
  });
}

/** Pairs of [lineIndex, text] for the tokens a line produced. */
function tokenTypesFor(lines: Token[][], lineIndex: number) {
  return (lines[lineIndex] ?? [])
    .filter((token) => token.text.trim() !== '')
    .map((token) => [token.text.trim(), token.type] as const);
}

describe('shader block highlighting', () => {
  test('shader bodies highlight types, stage variables, samplers, and intrinsics', () => {
    const lines = tokenizeLines(
      [
        '[comp_shader]',
        'float3 color = tex2D(sampler_main, uv).xyz;',
        'half3 tint = GetBlur1(uv) * 0.5;',
        'ret = color * tint;',
      ].join('\n'),
    );

    expect(tokenTypesFor(lines, 1)).toEqual(
      expect.arrayContaining([
        ['float3', 'type'],
        ['tex2D', 'keyword'],
        ['sampler_main', 'builtin'],
        ['uv', 'atom'],
        ['color', null],
      ]),
    );
    expect(tokenTypesFor(lines, 2)).toEqual(
      expect.arrayContaining([
        ['half3', 'type'],
        ['GetBlur1', 'keyword'],
        ['0.5', 'number'],
      ]),
    );
    expect(tokenTypesFor(lines, 3)).toEqual(
      expect.arrayContaining([
        ['ret', 'atom'],
        ['color', null],
      ]),
    );
  });

  test('shader words match case-insensitively, like the emitter', () => {
    const lines = tokenizeLines(
      ['[warp_shader]', 'Float3 c = TEX2D(sampler_blur1, uv_orig);'].join('\n'),
    );
    expect(tokenTypesFor(lines, 1)).toEqual(
      expect.arrayContaining([
        ['Float3', 'type'],
        ['TEX2D', 'keyword'],
        ['sampler_blur1', 'builtin'],
        ['uv_orig', 'atom'],
      ]),
    );
  });

  test('float literals keep their EEL2 token shape inside shaders', () => {
    const lines = tokenizeLines(
      ['[warp_shader]', 'ret = uv * .5 + 1e-4 * q1;'].join('\n'),
    );
    expect(tokenTypesFor(lines, 1)).toEqual(
      expect.arrayContaining([
        ['.5', 'number'],
        ['1e-4', 'number'],
        ['q1', 'variableName'],
        ['*', 'operator'],
      ]),
    );
  });

  test('# directives highlight as preprocessor, not comments, inside shaders', () => {
    const shaderLines = tokenizeLines(
      [
        '[warp_shader]',
        '#define TAU 6.283185',
        '// but // still comments',
      ].join('\n'),
    );
    expect(tokenTypesFor(shaderLines, 1)).toContainEqual(['#define', 'meta']);
    expect(tokenTypesFor(shaderLines, 1)).toContainEqual([
      '6.283185',
      'number',
    ]);
    expect(tokenTypesFor(shaderLines, 2)).toContainEqual([
      '// but // still comments',
      'comment',
    ]);

    // Outside a shader section `#` is still a comment, as before.
    const eelLines = tokenizeLines('zoom=1\n# hash comment');
    expect(tokenTypesFor(eelLines, 1)).toContainEqual([
      '# hash comment',
      'comment',
    ]);
  });

  test('shader keywords and booleans get their own classes', () => {
    const lines = tokenizeLines(
      [
        '[comp_shader]',
        'shader_body {',
        '  const bool done = saturate(1.0) > 0.5;',
        '  if (done) { ret = vec3(1.0); } else { return; }',
        '}',
      ].join('\n'),
    );
    expect(tokenTypesFor(lines, 1)).toContainEqual(['shader_body', 'keyword']);
    expect(tokenTypesFor(lines, 2)).toEqual(
      expect.arrayContaining([
        ['const', 'keyword'],
        ['bool', 'type'],
        ['done', null],
        ['saturate', 'keyword'],
      ]),
    );
    expect(tokenTypesFor(lines, 3)).toEqual(
      expect.arrayContaining([
        ['if', 'keyword'],
        ['else', 'keyword'],
        ['return', 'keyword'],
        ['vec3', 'type'],
      ]),
    );
  });

  test('shader booleans are atoms', () => {
    const lines = tokenizeLines(
      '[comp_shader]\nbool flat = true;\nret = flat ? vec3(0.5) : vec3(1.0);',
    );
    expect(tokenTypesFor(lines, 1)).toEqual(
      expect.arrayContaining([
        ['bool', 'type'],
        ['flat', null],
        ['true', 'atom'],
      ]),
    );
  });

  test('unknown identifiers inside shaders stay unstyled, not EEL keywords', () => {
    // `bass` is an EEL signal (atom) outside the block; a shader local with
    // that name is just a local — the shader vocabularies own the block.
    const lines = tokenizeLines(
      ['[warp_shader]', 'bass = uv.x * lum(ret);'].join('\n'),
    );
    expect(tokenTypesFor(lines, 1)).toContainEqual(['bass', null]);
    expect(tokenTypesFor(lines, 1)).toContainEqual(['lum', 'keyword']);
  });

  test('a section header inside a shader body switches back to EEL', () => {
    const lines = tokenizeLines(
      [
        '[warp_shader]',
        'ret = uv;',
        '[preset00]',
        'zoom=1.0',
        'per_frame_1=bass = bass * 0.5;',
      ].join('\n'),
    );
    expect(tokenTypesFor(lines, 1)).toContainEqual(['ret', 'atom']);
    // The header line itself is a heading even inside the block.
    expect(tokenTypesFor(lines, 2)).toContainEqual(['[preset00]', 'heading']);
    // Equations after it highlight as EEL2 again.
    expect(tokenTypesFor(lines, 3)).toEqual(
      expect.arrayContaining([
        ['zoom', 'propertyName'],
        ['=', 'operator'],
        ['1.0', 'number'],
      ]),
    );
    expect(tokenTypesFor(lines, 4)).toContainEqual(['bass', 'atom']);
  });

  test('the comp section highlights too, and both stages share the vocabulary', () => {
    for (const header of ['[comp_shader]', '[COMP_SHADER]']) {
      const lines = tokenizeLines(
        [header, 'vec3 c = texture2D(sampler_main, uv).rgb;'].join('\n'),
      );
      expect(tokenTypesFor(lines, 0)).toContainEqual([header, 'heading']);
      expect(tokenTypesFor(lines, 1)).toEqual(
        expect.arrayContaining([
          ['vec3', 'type'],
          ['texture2D', 'keyword'],
          ['sampler_main', 'builtin'],
        ]),
      );
    }
  });
});
