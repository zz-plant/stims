/**
 * Preset lab — remix-pair export: what each remix changed relative to its family's base work, as JSONL.
 *
 * MilkDrop presets were remixed for two decades, and preset-lineage.ts
 * recovers the families from their titles. Each (base work → remix) pair is
 * a human-made edit of a working preset: the kind of example a model that
 * edits presets ("make this more bass-driven", "Kali's take on this") has to
 * learn from, and which no other corpus records.
 *
 *   bun run lab:remix-pairs                          # → output/remix-pairs.jsonl
 *   bun run lab:remix-pairs -- --out pairs.jsonl --sources
 *   bun run lab:remix-pairs -- --min-similarity 0.3  # drop likely-unrelated works
 *   bun run lab:remix-pairs -- --include-identical   # keep pairs with no visible edit
 *
 * One row per pair:
 *   family, baseTitle              the family key and its base work's name
 *   parent, child                  id, title, authors; the child adds mixName,
 *                                  editNote and the hands it added to the credit
 *   scalarChanges                  [{ key, before, after }]: effective setting
 *                                  values as the compiler resolves them, so a
 *                                  default written out on one side and omitted
 *                                  on the other is not an edit
 *   programChanges                 [{ block, before, after }] for equation and
 *                                  shader blocks (per_frame, per_pixel, warp,
 *                                  comp, wave_N_per_point, …), each compared as
 *                                  one program so an inserted line does not
 *                                  renumber everything after it into a "change"
 *   similarity                     unchanged units / all units, in [0, 1]
 *   parentSource, childSource      full .milk text, with --sources
 *
 * Settings of a custom wave or shape that is disabled on both sides are
 * ignored: they cannot change a frame. Pairs with no visible edit (the same
 * preset shipped under two titles or in two libraries) are skipped unless
 * --include-identical.
 *
 * Pairs run from the family's baseline member (its root work when one
 * survives) to every other member. Lineage from titles is evidence, not
 * proof: two unrelated works can share a name, which shows up as a very low
 * similarity. Split any training set by `family`, never by pair.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import {
  buildPresetFamilies,
  type LineageCatalogEntry,
} from '../src/js/milkdrop/preset-lineage.ts';
import { parseMilkdropPreset } from '../src/js/milkdrop/preset-parser.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';

/**
 * Numbered keys that together form one program: `per_frame_3`,
 * `wave_0_per_point12`, `warp_7`, `shape_2_init1`, …
 */
const PROGRAM_KEY =
  /^(per_frame_init|per_frame|per_pixel|warp|comp|(?:wave|shape)_\d+_(?:per_frame|per_point|init))_?(\d+)$/;

/** Keys that describe the file, not the picture. */
const METADATA_KEYS = new Set(['fRating', 'milkdrop_preset_version']);

export type PresetParts = {
  /**
   * Effective setting values, defaults included, as the compiler resolved
   * them. Custom waves and shapes are keyed `wavecode_<n>_<field>` /
   * `shapecode_<n>_<field>` with MilkDrop's 0-based n.
   */
  scalars: Map<string, number>;
  /** Equation and shader blocks as program text, in line order. */
  programs: Map<string, string>;
  /** `wave_<n>` / `shape_<n>` for each enabled custom wave and shape. */
  enabled: Set<string>;
};

export function splitPresetSource(raw: string, id = 'remix-pair'): PresetParts {
  // Scalars come from the compiler rather than the text, because presets
  // disagree about which defaults to write out: one omits bAdditiveWaves,
  // its remix writes bAdditiveWaves=0, and a text diff calls that an edit.
  const { ir } = compileMilkdropPresetSource(raw, { id });
  const scalars = new Map<string, number>();
  for (const [key, value] of Object.entries(ir.numericFields)) {
    if (!METADATA_KEYS.has(key)) scalars.set(key, value);
  }
  const enabled = new Set<string>();
  for (const [kind, list] of [
    ['wave', ir.customWaves],
    ['shape', ir.customShapes],
  ] as const) {
    for (const item of list) {
      const n = item.index - 1; // the IR counts from 1, preset keys from 0
      for (const [field, value] of Object.entries(item.fields)) {
        scalars.set(`${kind}code_${n}_${field}`, value);
      }
      if (item.fields.enabled) enabled.add(`${kind}_${n}`);
    }
  }

  const programLines = new Map<string, Array<[number, string]>>();
  for (const field of parseMilkdropPreset(raw).ast.fields) {
    const match = PROGRAM_KEY.exec(field.key.toLowerCase());
    if (!match) continue;
    const block = match[1] as string;
    const lines = programLines.get(block) ?? [];
    lines.push([Number(match[2]), field.rawValue.trim()]);
    programLines.set(block, lines);
  }
  const programs = new Map<string, string>();
  for (const [block, lines] of programLines) {
    lines.sort((a, b) => a[0] - b[0]);
    const text = lines
      .map(([, line]) => line)
      .join('\n')
      .trim();
    if (text) programs.set(block, text);
  }
  return { scalars, programs, enabled };
}

let defaultScalarCache: Map<string, number> | null = null;

/** Every setting's value in a preset that sets nothing. */
function defaultScalars(): Map<string, number> {
  defaultScalarCache ??= splitPresetSource('[preset00]\n', 'defaults').scalars;
  return defaultScalarCache;
}

/** Whitespace-insensitive program comparison: reformatting is not an edit. */
function normalizeProgram(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * The custom wave/shape a key belongs to (`wave_2`, `shape_0`), or null for
 * the main preset.
 */
function ownerOf(key: string): string | null {
  const match = /^(wave|shape)(?:code)?_(\d+)_/.exec(key);
  return match ? `${match[1]}_${match[2]}` : null;
}

export type PresetDiff = {
  scalarChanges: Array<{
    key: string;
    before: number | null;
    after: number | null;
  }>;
  programChanges: Array<{
    block: string;
    before: string | null;
    after: string | null;
  }>;
  similarity: number;
};

/**
 * What changed from `parentRaw` to `childRaw`. Settings and programs of a
 * custom wave or shape that is disabled on both sides are ignored — they
 * cannot affect a frame — except the `enabled` flag itself.
 */
export function diffPresets(parentRaw: string, childRaw: string): PresetDiff {
  const parent = splitPresetSource(parentRaw);
  const child = splitPresetSource(childRaw);
  const visible = (key: string) => {
    const owner = ownerOf(key);
    return (
      owner === null ||
      key.endsWith('_enabled') ||
      parent.enabled.has(owner) ||
      child.enabled.has(owner)
    );
  };
  const scalarChanges: PresetDiff['scalarChanges'] = [];
  const programChanges: PresetDiff['programChanges'] = [];

  const scalarKeys = [
    ...new Set([...parent.scalars.keys(), ...child.scalars.keys()]),
  ]
    .filter(visible)
    .sort();
  for (const key of scalarKeys) {
    const before = parent.scalars.get(key) ?? null;
    const after = child.scalars.get(key) ?? null;
    if (before === after) continue;
    scalarChanges.push({ key, before, after });
  }

  const blocks = [
    ...new Set([...parent.programs.keys(), ...child.programs.keys()]),
  ]
    .filter(visible)
    .sort();
  for (const block of blocks) {
    const before = parent.programs.get(block) ?? null;
    const after = child.programs.get(block) ?? null;
    if (
      before !== null &&
      after !== null &&
      normalizeProgram(before) === normalizeProgram(after)
    ) {
      continue;
    }
    programChanges.push({ block, before, after });
  }

  // Similarity counts only settings either side actually sets away from the
  // default; the hundreds both leave at their defaults would otherwise make
  // every pair look near-identical.
  const defaults = defaultScalars();
  const touched = scalarKeys.filter(
    (key) =>
      parent.scalars.get(key) !== defaults.get(key) ||
      child.scalars.get(key) !== defaults.get(key),
  ).length;
  const units = touched + blocks.length;
  const changed = scalarChanges.length + programChanges.length;
  return {
    scalarChanges,
    programChanges,
    similarity: units === 0 ? 1 : 1 - changed / units,
  };
}

export type RemixPairMember = {
  id: string;
  title: string;
  authors: string[];
};

export type RemixPair = {
  family: string;
  baseTitle: string;
  parent: RemixPairMember;
  child: RemixPairMember & {
    mixName: string | null;
    editNote: string | null;
    addedAuthors: string[];
  };
};

/**
 * Every (baseline → other member) pair across families with more than one
 * member. Sibling-to-sibling parentage is not asserted, because titles do
 * not encode it reliably (see preset-lineage.ts).
 */
export function listRemixPairs(
  entries: readonly LineageCatalogEntry[],
): RemixPair[] {
  const titles = new Map(entries.map((entry) => [entry.id, entry.title]));
  const pairs: RemixPair[] = [];
  const families = [...buildPresetFamilies(entries).values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  for (const family of families) {
    const [baseline, ...rest] = family.members;
    if (!baseline) continue;
    for (const member of rest) {
      pairs.push({
        family: family.key,
        baseTitle: family.baseTitle,
        parent: {
          id: baseline.id,
          title: titles.get(baseline.id) ?? baseline.label,
          authors: baseline.authors,
        },
        child: {
          id: member.id,
          title: titles.get(member.id) ?? member.label,
          authors: member.authors,
          mixName: member.mixName,
          editNote: member.editNote,
          addedAuthors: member.addedAuthors,
        },
      });
    }
  }
  return pairs;
}

function parseArgs(argv: string[]) {
  const options = {
    out: 'output/remix-pairs.jsonl',
    sources: false,
    includeIdentical: false,
    minSimilarity: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--sources') {
      options.sources = true;
    } else if (arg === '--include-identical') {
      options.includeIdentical = true;
    } else if (arg === '--out' && value) {
      options.out = value;
      index += 1;
    } else if (arg === '--min-similarity' && value) {
      options.minSimilarity = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete flag ${arg}`);
    }
  }
  if (!(options.minSimilarity >= 0 && options.minSimilarity <= 1)) {
    throw new Error('--min-similarity must be between 0 and 1');
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const catalog = loadCatalogEntries(repoRoot);
  const entries = [...catalog.values()].map((entry) => ({
    id: entry.id,
    title: entry.title ?? entry.id,
    author: entry.author,
  }));
  const readSource = (id: string) => {
    const entry = catalog.get(id);
    if (!entry) throw new Error(`Catalog has no preset ${id}`);
    return fs.readFileSync(
      path.join(repoRoot, 'public', entry.file.replace(/^\//, '')),
      'latin1',
    );
  };

  const lines: string[] = [];
  const similarities: number[] = [];
  const keyCounts = new Map<string, number>();
  const skipped = { identical: 0, belowSimilarity: 0, compileError: 0 };
  for (const pair of listRemixPairs(entries)) {
    const parentSource = readSource(pair.parent.id);
    const childSource = readSource(pair.child.id);
    let diff: PresetDiff;
    try {
      diff = diffPresets(parentSource, childSource);
    } catch {
      skipped.compileError += 1;
      continue;
    }
    const identical =
      diff.scalarChanges.length === 0 && diff.programChanges.length === 0;
    if (identical && !options.includeIdentical) {
      skipped.identical += 1;
      continue;
    }
    if (diff.similarity < options.minSimilarity) {
      skipped.belowSimilarity += 1;
      continue;
    }
    similarities.push(diff.similarity);
    for (const change of diff.scalarChanges) {
      keyCounts.set(change.key, (keyCounts.get(change.key) ?? 0) + 1);
    }
    for (const change of diff.programChanges) {
      const key = `<${change.block}>`;
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
    lines.push(
      JSON.stringify({
        ...pair,
        ...diff,
        ...(options.sources ? { parentSource, childSource } : {}),
      }),
    );
  }

  const outPath = path.resolve(options.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.length ? `${lines.join('\n')}\n` : '');

  similarities.sort((a, b) => a - b);
  const median = similarities[Math.floor(similarities.length / 2)] ?? 0;
  const families = new Set(
    lines.map((line) => (JSON.parse(line) as { family: string }).family),
  );
  console.log(
    `Wrote ${lines.length} remix pairs from ${families.size} families to ${outPath}`,
  );
  console.log(`  skipped: ${JSON.stringify(skipped)}`);
  console.log(`  median similarity: ${median.toFixed(2)}`);
  const top = [...keyCounts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, count]) => `${key}×${count}`)
    .join(', ');
  console.log(`  most-edited: ${top}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
