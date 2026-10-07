import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parsePresetSyntax,
  printPresetSyntax,
} from 'milkdrop-toolchain/src/preset-syntax.ts';

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

const _kinds = (source: string) =>
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
});
