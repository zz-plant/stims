/**
 * Generates the text the catalog is embedded from, in the same vocabulary the
 * search queries use.
 *
 * Presets used to be embedded as `Preset titled "X", by Y` — a name and an
 * author — while queries described palette, edge structure and motion. The
 * two sides shared no vocabulary, so cosine matching fell back to whichever
 * preset happened to have evocative words in its filename. Measured against
 * production: a real query scored 0.742, and deliberate gibberish
 * ("purple accountancy spreadsheet tax return quarterly filing") scored
 * 0.628 — an 0.11 spread, with `martin-purple-pulsator` in the gibberish
 * results because it has "purple" in its name.
 *
 * Palette and edges come from the rendered preview PNG through the very same
 * `computeFrameStats`/`describeFrame` the query side runs, so the two
 * descriptions are drawn from one vocabulary by construction. Motion is the
 * one axis a still cannot carry, so it is estimated from the compiled preset.
 *
 * Usage: bun run scripts/build-preset-descriptions.ts [--out <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  computeFrameStats,
  describeFrameParts,
} from '../src/js/core/services/visual-embedding.ts';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { estimatePresetMotion } from '../src/js/milkdrop/preset-motion-estimate.ts';

const repoRoot = new URL('..', import.meta.url).pathname;
const CATALOG = path.join(repoRoot, 'public/milkdrop-presets/catalog.json');
const PREVIEWS = path.join(repoRoot, 'public/milkdrop-presets/previews');
const DEFAULT_OUT = path.join(
  repoRoot,
  'public/milkdrop-presets/preset-descriptions.json',
);
const SAMPLE = 64;

type CatalogEntry = {
  id: string;
  title: string;
  author?: string;
  file?: string;
};

function readCatalog(): CatalogEntry[] {
  const doc = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  return Array.isArray(doc) ? doc : (doc.presets ?? []);
}

async function paletteAndEdges(previewPath: string) {
  const { data, info } = await sharp(previewPath)
    .resize(SAMPLE, SAMPLE, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return computeFrameStats(data, info.width, info.height, null);
}

function loadCompiled(entry: CatalogEntry) {
  if (!entry.file) return null;
  const sourcePath = path.join(repoRoot, 'public', entry.file);
  if (!fs.existsSync(sourcePath)) return null;
  try {
    return compileMilkdropPresetSource(fs.readFileSync(sourcePath, 'utf8'), {
      id: entry.id,
    });
  } catch {
    return null;
  }
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex > -1 ? process.argv[outIndex + 1] : DEFAULT_OUT;

  const entries = readCatalog();
  const descriptions: Record<string, string> = {};
  let described = 0;
  let missingPreview = 0;
  let missingSource = 0;

  for (const entry of entries) {
    const previewPath = path.join(PREVIEWS, `${entry.id}.png`);
    if (!fs.existsSync(previewPath)) {
      missingPreview += 1;
      continue;
    }

    const compiled = loadCompiled(entry);
    if (!compiled) missingSource += 1;

    const stats = await paletteAndEdges(previewPath);
    const motion = compiled ? estimatePresetMotion(compiled) : 0;
    descriptions[entry.id] = describeFrameParts({
      histogram: stats.histogram,
      edgeDensity: stats.edgeDensity,
      motionEstimate: motion,
    });
    described += 1;
  }

  fs.writeFileSync(
    outPath,
    `${JSON.stringify({ version: 1, descriptions }, null, 2)}\n`,
  );

  const distinct = new Set(Object.values(descriptions)).size;
  console.log(
    `[descriptions] ${described} described, ${distinct} distinct phrasings`,
  );
  console.log(
    `[descriptions] skipped: ${missingPreview} without a preview, ${missingSource} without compilable source (motion defaulted)`,
  );
  console.log(`[descriptions] wrote ${path.relative(repoRoot, outPath)}`);
}

await main();
