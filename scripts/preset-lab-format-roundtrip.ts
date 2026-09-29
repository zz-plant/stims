/**
 * Preset lab — Format round-trip sweep (no browser).
 *
 * The editor's Format button rewrites a buffer from the compiled IR. Anything
 * the compiler understood but the formatter did not emit is silently lost, and
 * the author only finds out when the preset looks different. This compiles
 * every bundled .milk, formats it, recompiles the result, and reports each
 * field whose value changed — including shader text as written and fields
 * Stims ignores but keeps — grouped by field so one formatter bug shows up as
 * one line with a count rather than thousands of presets.
 *
 *   bun run lab:format-roundtrip                    # whole corpus
 *   bun run lab:format-roundtrip -- --only <substr> # files whose path matches
 *   bun run lab:format-roundtrip -- --json          # machine-readable
 *
 * The same check runs through MilkDrop 2 export (keys prefixed `export:`).
 *
 * Exits 1 when any preset changes, so it can gate a formatter change.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { formatMilkdropPreset } from '../src/js/milkdrop/formatter.ts';
import { exportMilkdrop2Preset } from '../src/js/milkdrop/milkdrop2-export.ts';
import { ensureShaderBody } from '../src/js/milkdrop/shader-source.ts';

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
    // What the author wrote, not just what renders: comments and layout in a
    // shader, and fields Stims ignores but another engine may read.
    'source:warp': ir.shaderSource?.warp ?? null,
    'source:comp': ir.shaderSource?.comp ?? null,
    preserved: ir.preservedFields ?? [],
    comments: [
      ir.programs.init,
      ir.programs.perFrame,
      ir.programs.perPixel,
      ...ir.customWaves.flatMap((wave) => Object.values(wave.programs)),
      ...ir.customShapes.flatMap((shape) => Object.values(shape.programs)),
    ].map((block) => block.comments ?? []),
  };
}

const EXPORT_REWRITTEN_KEYS = [
  'field:milkdrop_preset_version',
  'field:psversion',
  'field:psversion_warp',
  'field:psversion_comp',
];

/**
 * Keys whose value differs after format → recompile, or (`via: 'export'`)
 * after MilkDrop 2 export → recompile: an exported file must come back into
 * Stims as the same preset.
 */
export function roundTripDiff(
  source: string,
  via: 'format' | 'export' = 'format',
): string[] {
  const before = fingerprintPreset(source);
  const compiled = compileMilkdropPresetSource(source, { id: 'roundtrip' });
  const written =
    via === 'export'
      ? exportMilkdrop2Preset(compiled)
      : formatMilkdropPreset(compiled);
  const after = fingerprintPreset(written);
  // Export writes the version header MilkDrop 2 needs (201, and a shader
  // version only for a stage that has a shader); Stims renders from neither.
  // A shader written without `shader_body` (Stims accepts bare statements) is
  // wrapped in one, since MilkDrop 2 splices its header in there.
  if (via === 'export') {
    for (const key of EXPORT_REWRITTEN_KEYS) {
      delete before[key];
      delete after[key];
    }
    for (const key of ['source:warp', 'source:comp']) {
      const text = before[key];
      if (typeof text === 'string') {
        before[key] = ensureShaderBody(text);
      }
    }
  }
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
      const source = readFileSync(file, 'utf8');
      const keys = [
        ...roundTripDiff(source),
        ...roundTripDiff(source, 'export').map((key) => `export:${key}`),
      ];
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
      `${files.length} presets, ${changed} changed by Format or Export, ${errors.length} threw`,
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
