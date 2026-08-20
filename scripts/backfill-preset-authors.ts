/**
 * Backfill `author` for catalog presets that were ingested without one.
 *
 * The ingest path splits a filename on " - " to separate author from title, so
 * presets whose filenames used a different separator ("Eo.S.+Phat -Eater_v2",
 * "Flexi + Phat fractal Star_Child_Restless") or none at all ("_Mig_004")
 * landed with `author: "Unknown"`. The credit is still there — it is just in
 * the title.
 *
 * This recovers it conservatively: an author is only written when every handle
 * in the leading chain is one the registry already knows from elsewhere in the
 * catalog. Titles are never rewritten, and a preset whose leading token is
 * unrecognized ("BrainStain-Blackwidow") is left Unknown and reported, so a
 * human can confirm the handle and add it to the registry rather than having a
 * guess written into the catalog.
 *
 *   bun run scripts/backfill-preset-authors.ts --dry-run
 *   bun run scripts/backfill-preset-authors.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseLeadingHandles } from '../src/js/milkdrop/preset-handles.ts';

const CATALOG_PATH = path.join(
  process.cwd(),
  'public/milkdrop-presets/catalog.json',
);

type CatalogPreset = { id: string; title: string; author?: string };
type CatalogDocument = { presets: CatalogPreset[] };

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  const catalog: CatalogDocument = JSON.parse(raw);

  const attributed: string[] = [];
  const unresolved: string[] = [];

  for (const preset of catalog.presets) {
    if ((preset.author ?? '').trim() !== 'Unknown') continue;
    const parsed = parseLeadingHandles(preset.title);
    if (!parsed) {
      unresolved.push(preset.title);
      continue;
    }
    const author = parsed.handles.join(' + ');
    attributed.push(`${author.padEnd(28)} | ${preset.title}`);
    preset.author = author;
  }

  for (const line of attributed) console.log(`  ${line}`);
  console.log(
    `\n[backfill] attributed ${attributed.length}, left unresolved ${unresolved.length}`,
  );
  if (unresolved.length > 0) {
    console.log(
      '[backfill] unresolved titles keep author "Unknown". Confirm the handle',
    );
    console.log(
      '[backfill] against a primary source, add it to preset-handles.ts, re-run:',
    );
    for (const title of unresolved) console.log(`    ${title}`);
  }

  if (dryRun) {
    console.log('\n[backfill] --dry-run: catalog not written.');
    return;
  }
  if (attributed.length === 0) {
    console.log('[backfill] nothing to write.');
    return;
  }
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`[backfill] wrote ${CATALOG_PATH}`);
}

main();
