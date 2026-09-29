import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { formatMilkdropPreset } from '../../src/js/milkdrop/formatter.ts';

/**
 * The Format button rewrites an author's buffer from the compiled IR. If that
 * rewrite drops or alters anything the compiler understood, "tidy up" silently
 * changes the preset. This runs every bundled preset and authoring example
 * through compile → format → compile and requires the second IR to match the
 * first on everything that affects rendering.
 */
const dirs = ['public/milkdrop-presets', 'docs/authoring/examples'];
const files = dirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.milk'))
    .map((name) => join(dir, name)),
);

const normalizeLines = (lines: readonly string[]) =>
  lines.map((line) => line.replace(/\s+/gu, ' ').trim()).filter(Boolean);

const fingerprint = (source: string) => {
  const { ir } = compileMilkdropPresetSource(source, { id: 'roundtrip' });
  return {
    numericFields: ir.numericFields,
    init: normalizeLines(ir.programs.init.sourceLines),
    perFrame: normalizeLines(ir.programs.perFrame.sourceLines),
    perPixel: normalizeLines(ir.programs.perPixel.sourceLines),
    waves: ir.customWaves.length,
    shapes: ir.customShapes.length,
    warp: ir.shaderText.warp?.trim() ?? null,
    comp: ir.shaderText.comp?.trim() ?? null,
  };
};

describe('formatter round-trip', () => {
  test('corpus is not empty', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    test(`${file} survives format → recompile`, () => {
      const source = readFileSync(file, 'utf8');
      const before = fingerprint(source);
      const formatted = formatMilkdropPreset(
        compileMilkdropPresetSource(source, { id: 'roundtrip' }),
      );
      expect(fingerprint(formatted)).toEqual(before);
    });
  }

  test('detects a dropped equation (mutation check)', () => {
    const source = 'title=T\nper_frame_1=zoom=1.1;\nper_frame_2=rot=0.2;\n';
    const formatted = formatMilkdropPreset(
      compileMilkdropPresetSource(source, { id: 'roundtrip' }),
    ).replace(/^per_frame_2=.*\n/mu, '');
    expect(fingerprint(formatted)).not.toEqual(fingerprint(source));
  });
});
