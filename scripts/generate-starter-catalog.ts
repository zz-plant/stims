/**
 * Rebuild the starter catalog from the bundled catalog.
 *
 * starter-catalog.json is the small set the shell fetches first so browse has
 * something to show before the full 1787-entry catalog arrives. It had no
 * generator and no drift check, so it was a hand-maintained copy that
 * silently fell behind: by the time this script was written it was missing
 * every field added to catalog.json since it was last touched, including the
 * quality scores and sensory profiles the browse row now reads.
 *
 * That mattered more than it sounds. The presets with measured reactivity are
 * almost exactly the starter set — so the one path that serves them was also
 * the one path that dropped the measurement, and the reactivity chip rendered
 * for nothing.
 *
 * The membership list is preserved from the existing file: which presets make
 * a good first impression is an editorial decision, not something to derive.
 * Only the per-entry fields are refreshed.
 *
 * Usage:
 *   bun run scripts/generate-starter-catalog.ts
 *   bun run scripts/generate-starter-catalog.ts --check
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRESETS_DIR = join(import.meta.dir, '..', 'public', 'milkdrop-presets');
const CATALOG_PATH = join(PRESETS_DIR, 'catalog.json');
const STARTER_PATH = join(PRESETS_DIR, 'starter-catalog.json');

/**
 * Fields the starter entries carry. A subset of the full entry: the starter
 * payload is on the critical path for first paint, so it stays small and
 * omits anything browse does not read before the full catalog lands.
 */
const STARTER_FIELDS = [
  'id',
  'title',
  'author',
  'authorUrl',
  'file',
  'tags',
  'preview',
  'supports',
  'expectedFidelityClass',
  'visualCertification',
  'quality',
  'sensoryProfile',
] as const;

type Entry = Record<string, unknown> & { id: string };

function project(entry: Entry): Entry {
  const out: Record<string, unknown> = {};
  for (const field of STARTER_FIELDS) {
    if (entry[field] !== undefined) out[field] = entry[field];
  }
  return out as Entry;
}

function main() {
  const check = process.argv.includes('--check');

  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as {
    presets: Entry[];
  };
  const existingRaw = readFileSync(STARTER_PATH, 'utf8');
  const existing = JSON.parse(existingRaw) as { presets: Entry[] };

  const byId = new Map(catalog.presets.map((entry) => [entry.id, entry]));

  const missing: string[] = [];
  const presets: Entry[] = [];
  for (const entry of existing.presets) {
    const source = byId.get(entry.id);
    if (!source) {
      // Keep it rather than dropping it: a starter entry that has fallen out
      // of the catalog is a curation problem to report, not to silently fix.
      missing.push(entry.id);
      presets.push(entry);
      continue;
    }
    presets.push(project(source));
  }

  const next = `${JSON.stringify({ ...existing, presets }, null, 2)}\n`;

  const measured = presets.filter((p) => {
    const q = p.quality as
      | { components?: { measuredReactivity?: number | null } }
      | undefined;
    return typeof q?.components?.measuredReactivity === 'number';
  }).length;
  const summary =
    `${presets.length} starter presets, ${measured} with measured reactivity, ` +
    `${presets.filter((p) => p.sensoryProfile).length} with a sensory profile.`;

  if (missing.length > 0) {
    console.warn(
      `Starter presets no longer in the catalog (kept as-is): ${missing.join(', ')}`,
    );
  }

  if (check) {
    if (next !== existingRaw) {
      console.error(
        `starter-catalog.json is stale. ${summary}\n` +
          'Run: bun run generate:starter-catalog',
      );
      process.exit(1);
    }
    console.log(`starter-catalog.json is current. ${summary}`);
    return;
  }

  writeFileSync(STARTER_PATH, next);
  console.log(`Wrote starter-catalog.json. ${summary}`);
}

main();
