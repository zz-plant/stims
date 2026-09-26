/**
 * Warms the edge cache for the most-shared preset cards.
 *
 * A cold card render costs ~850ms of resvg work; a warm one is ~100ms. More
 * importantly, the crawler's *first* fetch is the one that can fail — and a
 * failed render serves the generic card, which unfurlers then cache for that
 * URL indefinitely. Warming removes that window for the presets most likely
 * to be shared.
 *
 * Ranked by the catalog's curated `order` field (1 = most prominent); there
 * is no view or share telemetry to rank by.
 *
 * GETs only. Usage:
 *   bun run scripts/warm-og-cards.ts [--limit 150] [--concurrency 8] [--offset 0]
 * Env: SITE_BASE (default https://toil.fyi), CATALOG_URL
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag: string, fallback: number) => {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : fallback;
};

const limit = argOf('--limit', 150);
const offset = argOf('--offset', 0);
const concurrency = argOf('--concurrency', 8);
const base = (process.env.SITE_BASE || 'https://toil.fyi').replace(/\/$/, '');

const catalogSources = [
  process.env.CATALOG_URL,
  join('public', 'milkdrop-presets', 'catalog.json'),
  `${base}/milkdrop-presets/catalog.json`,
].filter((v): v is string => Boolean(v));

type Catalog = { presets: Array<{ id: string; order: number }> };

const loadCatalog = async (): Promise<Catalog | null> => {
  for (const source of catalogSources) {
    try {
      const text = source.startsWith('http')
        ? await fetch(source).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          })
        : readFileSync(source, 'utf8');
      const parsed = JSON.parse(text) as Catalog;
      console.log(`catalog: ${source} (${parsed.presets.length} presets)`);
      return parsed;
    } catch {
      // A missing or unreadable source is not fatal — try the next one.
    }
  }
  return null;
};

const catalog = await loadCatalog();
if (!catalog) {
  console.error('Could not load the preset catalog from any source.');
  process.exit(1);
}

const targets = catalog.presets
  .slice()
  .sort((a, b) => a.order - b.order)
  .slice(offset, offset + limit)
  .map((p) => p.id);

console.log(
  `Warming ${targets.length} cards from rank ${offset + 1} (concurrency ${concurrency})\n`,
);

let done = 0;
let cursor = 0;
let warmed = 0;
let failed = 0;
/** Cards that answered 200 but came back too small to be a real render. */
const suspicious: string[] = [];

const worker = async () => {
  while (cursor < targets.length) {
    const id = targets[cursor++];
    const url = `${base}/api/og-preset?id=${encodeURIComponent(id)}`;
    try {
      const res = await fetch(url);
      const bytes = (await res.arrayBuffer()).byteLength;
      if (res.status !== 200 || bytes === 0) {
        failed++;
        console.log(`  FAIL ${res.status} ${bytes}b ${id}`);
      } else {
        warmed++;
        // A card that fails mid-render falls back to the static PNG, which
        // still returns 200 — body size is the only tell from outside.
        if (bytes < 20_000) suspicious.push(`${id} (${bytes}b)`);
      }
    } catch (err) {
      failed++;
      console.log(`  ERR  ${id}: ${err}`);
    }
    done++;
    if (done % 25 === 0) console.log(`  … ${done}/${targets.length}`);
  }
};

const wallStart = Date.now();
await Promise.all(
  Array.from({ length: Math.min(concurrency, targets.length) }, worker),
);

console.log(
  `\nwarmed=${warmed} failed=${failed} in ${(
    (Date.now() - wallStart) / 1000
  ).toFixed(1)}s`,
);
if (suspicious.length > 0) {
  console.log(
    `\n${suspicious.length} card(s) returned a suspiciously small body — these may have fallen back to the generic card:`,
  );
  for (const s of suspicious.slice(0, 20)) console.log(`  ${s}`);
}
