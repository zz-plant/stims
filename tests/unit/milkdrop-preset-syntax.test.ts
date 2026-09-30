import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parsePresetSyntax,
  printPresetSyntax,
} from '../../src/js/milkdrop/preset-syntax.ts';

/**
 * The preset's line-level syntax tree is the one reading of `.milk` structure
 * the parser, shader-source recovery, knob edits and editor diagnostics all
 * share, so it has to lose nothing: printing it gives back the exact bytes.
 */
const dirs = ['public/milkdrop-presets', 'docs/authoring/examples'];
const files = dirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.milk'))
    .map((name) => join(dir, name)),
);

const kinds = (source: string) =>
  parsePresetSyntax(source).lines.map((line) => line.kind);

describe('preset syntax tree', () => {
  test('prints every bundled preset back byte for byte', () => {
    expect(files.length).toBeGreaterThan(10);
    const changed = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return printPresetSyntax(parsePresetSyntax(source)) !== source;
    });
    expect(changed).toEqual([]);
  });

  test.each([
    ['CRLF', 'zoom=1\r\n[warp_shader]\r\nret=1;\r\n'],
    ['no final newline', 'zoom=1\ndecay=0.9'],
    ['a lone CR inside a line', 'title=a\rb\nzoom=1\n'],
    ['empty', ''],
    ['only newlines', '\n\n'],
  ])('prints %s back exactly', (_name, source) => {
    const tree = parsePresetSyntax(source);
    expect(printPresetSyntax(tree)).toBe(source);
    expect(tree.lines.length).toBe(source.split(/\r?\n/u).length);
  });

  test('classifies each line and tracks its section', () => {
    const tree = parsePresetSyntax(
      [
        '// header comment',
        '[preset00]',
        'zoom = 1.0 // base',
        'noise',
        '',
        '[warp_shader]',
        '#define X 1',
        'ret = 1; // tint',
        '[preset00]',
        '; old comment',
        'decay=0.9',
      ].join('\n'),
    );
    expect(tree.lines.map((line) => [line.kind, line.section])).toEqual([
      ['comment', null],
      ['section', 'preset00'],
      ['assignment', 'preset00'],
      ['text', 'preset00'],
      ['blank', 'preset00'],
      ['section', 'warp_shader'],
      ['shader', 'warp_shader'],
      ['shader', 'warp_shader'],
      ['section', 'preset00'],
      ['comment', 'preset00'],
      ['assignment', 'preset00'],
    ]);
    const zoom = tree.lines[2];
    expect([zoom.key, zoom.value, zoom.rawValue, zoom.comment]).toEqual([
      'zoom',
      '1.0',
      ' 1.0 // base',
      '// base',
    ]);
    expect(tree.lines[7].value).toBe('ret = 1;');
  });

  test('a `//` inside quotes is not a comment', () => {
    const [line] = parsePresetSyntax('title="a // b" // real\n').lines;
    expect([line.value, line.comment]).toEqual(['"a // b"', '// real']);
  });

  test('`#` and `;` are comments outside a shader and text inside one', () => {
    expect(kinds('#x\n;y\n[comp_shader]\n#x\n;\n')).toEqual([
      'comment',
      'comment',
      'section',
      'shader',
      'shader',
      'blank',
    ]);
  });
});
