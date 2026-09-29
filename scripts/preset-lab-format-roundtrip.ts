/**
 * Preset lab — Format round-trip sweep (no browser).
 *
 * The editor's Format button rewrites a buffer from the compiled IR. Anything
 * the compiler understood but the formatter did not emit is silently lost, and
 * the author only finds out when the preset looks different. This compiles
 * every bundled .milk, formats it, recompiles the result, and reports each
 * field whose value changed, grouped by field so one formatter bug shows up as
 * one line with a count rather than thousands of presets.
 *
 *   bun run lab:format-roundtrip                    # whole corpus
 *   bun run lab:format-roundtrip -- --only <substr> # files whose path matches
 *   bun run lab:format-roundtrip -- --json          # machine-readable
 *
 * Exits 1 when any preset changes, so it can gate a formatter change.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { formatMilkdropPreset } from '../src/js/milkdrop/formatter.ts';

const normalizeLines = (lines: readonly string[]) =>
  lines.map((line) => line.replace(/\s+/gu, ' ').trim()).filter(Boolean);

/** Everything that affects rendering, in a shape that diffs field by field. */
export function fingerprintPreset(source: string): Record<string, unknown> {
  const { ir } = compileMilkdropPresetSource(source, { id: 'roundtrip' });
  return {
    ...Object.fromEntries(
      Object.entries(ir.numericFields).map(([k, v]) => [`field:${k}`, v]),
    ),
    'program:init': normalizeLines(ir.programs.init.sourceLines),
    'program:per_frame': normalizeLines(ir.programs.perFrame.sourceLines),
    'program:per_pixel': normalizeLines(ir.programs.perPixel.sourceLines),
    'count:waves': ir.customWaves.length,
    'count:shapes': ir.customShapes.length,
    'shader:warp': ir.shaderText.warp?.trim() ?? null,
    'shader:comp': ir.shaderText.comp?.trim() ?? null,
  };
}

/** Keys whose value differs after format → recompile. */
export function roundTripDiff(source: string): string[] {
  const before = fingerprintPreset(source);
  const formatted = formatMilkdropPreset(
    compileMilkdropPresetSource(source, { id: 'roundtrip' }),
  );
  const after = fingerprintPreset(formatted);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : name.endsWith('.milk')
        ? [full]
        : [];
  });
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
  const json = args.includes('--json');
  const files = walk('public/milkdrop-presets').filter((f) =>
    only ? f.includes(only) : true,
  );

  const byKey = new Map<string, string[]>();
  const errors: Array<{ file: string; error: string }> = [];
  let changed = 0;
  for (const file of files) {
    try {
      const keys = roundTripDiff(readFileSync(file, 'utf8'));
      if (keys.length > 0) changed += 1;
      for (const key of keys) {
        const list = byKey.get(key) ?? [];
        list.push(file);
        byKey.set(key, list);
      }
    } catch (error) {
      errors.push({ file, error: String(error) });
    }
  }

  const groups = [...byKey.entries()]
    .map(([key, list]) => ({ key, count: list.length, example: list[0] }))
    .sort((a, b) => b.count - a.count);

  if (json) {
    console.log(
      JSON.stringify({ files: files.length, changed, groups, errors }, null, 2),
    );
  } else {
    console.log(
      `${files.length} presets, ${changed} changed by Format, ${errors.length} threw`,
    );
    for (const g of groups.slice(0, 40)) {
      console.log(
        `  ${String(g.count).padStart(5)}  ${g.key}  e.g. ${g.example}`,
      );
    }
    if (groups.length > 40)
      console.log(`  … ${groups.length - 40} more fields`);
    for (const e of errors.slice(0, 10))
      console.log(`  threw: ${e.file}: ${e.error}`);
  }
  process.exit(changed > 0 || errors.length > 0 ? 1 : 0);
}

if (import.meta.main) main();
