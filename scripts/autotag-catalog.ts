/**
 * Assign taxonomy category tags to catalog presets using the local model
 * stack (model-batch + constrained JSON schema via Ollama).
 *
 * Three phases, so the model run is inspectable before anything is written:
 *   --emit   write scratch/autotag/items.jsonl + schema.json for presets
 *            that have no category:* tag yet
 *   (run model-batch yourself; see the command printed by --emit)
 *   --apply=<results.jsonl>  merge category tags back into catalog.json
 *
 * Categories mirror the cream-of-the-crop corpus taxonomy so bundled and
 * library presets share one vocabulary.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(import.meta.dir, '..');
const CATALOG_PATH = path.join(
  REPO_ROOT,
  'public',
  'milkdrop-presets',
  'catalog.json',
);
const OUT_DIR = path.join(REPO_ROOT, 'scratch', 'autotag');

export const CATEGORIES = [
  'dancer',
  'drawing',
  'fractal',
  'geometric',
  'hypnotic',
  'particles',
  'reaction',
  'sparkle',
  'supernova',
  'waveform',
] as const;

const SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      enum: [...CATEGORIES],
      description:
        'Primary visual style. dancer: figure/character-like shapes moving to music. drawing: hand-drawn/painterly line work. fractal: self-similar recursive structures. geometric: hard-edged shapes, grids, polygons. hypnotic: slow tunnel/spiral/flow fields. particles: many small moving points/sprites. reaction: reaction-diffusion, organic liquid textures. sparkle: glittering point flashes. supernova: bright radial bursts and explosions. waveform: the audio waveform itself is the main visual.',
    },
    secondary: {
      type: 'string',
      enum: [...CATEGORIES, 'none'],
      description: 'Secondary style if clearly present, else "none".',
    },
  },
  required: ['category', 'secondary'],
} as const;

type CatalogEntry = { id: string; title: string; file: string; tags: string[] };
type CatalogDocument = { presets: CatalogEntry[] };

/** Compact, model-friendly digest of a preset source: structural counts and
 * the equation lines that most determine look (waves, shapes, warp/comp). */
function digestSource(raw: string): string {
  const lines = raw.split('\n');
  const counts = {
    waves: new Set(
      lines.map((l) => l.match(/^wavecode_(\d+)_/u)?.[1]).filter(Boolean),
    ).size,
    shapes: new Set(
      lines.map((l) => l.match(/^shapecode_(\d+)_/u)?.[1]).filter(Boolean),
    ).size,
    hasWarpShader: /\[warp_shader\]/u.test(raw),
    hasCompShader: /\[comp_shader\]/u.test(raw),
  };
  const interesting = lines
    .filter((l) =>
      /^(per_frame_\d|per_pixel_\d|nmotionvectors|fdecay|zoom|rot|warp)=?/iu.test(
        l,
      ),
    )
    .slice(0, 40)
    .join('\n');
  return `waves=${counts.waves} shapes=${counts.shapes} warpShader=${counts.hasWarpShader} compShader=${counts.hasCompShader}\n${interesting}`.slice(
    0,
    2400,
  );
}

function emit() {
  const catalog: CatalogDocument = JSON.parse(
    fs.readFileSync(CATALOG_PATH, 'utf8'),
  );
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const items = [];
  for (const entry of catalog.presets) {
    if (entry.tags.some((t) => t.startsWith('category:'))) continue;
    const sourcePath = path.join(REPO_ROOT, 'public', entry.file);
    if (!fs.existsSync(sourcePath)) continue;
    const digest = digestSource(fs.readFileSync(sourcePath, 'utf8'));
    items.push({ id: entry.id, title: entry.title, digest });
  }
  const itemsPath = path.join(OUT_DIR, 'items.jsonl');
  const schemaPath = path.join(OUT_DIR, 'schema.json');
  fs.writeFileSync(
    itemsPath,
    items.map((i) => JSON.stringify(i)).join('\n'),
    'utf8',
  );
  fs.writeFileSync(schemaPath, JSON.stringify(SCHEMA, null, 2), 'utf8');
  console.log(`[autotag] ${items.length} untagged presets -> ${itemsPath}`);
  console.log('[autotag] run:');
  console.log(
    `  model-batch --schema ${schemaPath} --prompt "Classify this MilkDrop music-visualizer preset into its primary visual style category. Title: {{title}}. Source digest:\\n{{digest}}" ${itemsPath} > ${path.join(OUT_DIR, 'results.jsonl')}`,
  );
  console.log(
    `  bun run scripts/autotag-catalog.ts --apply=${path.join(OUT_DIR, 'results.jsonl')}`,
  );
}

function apply(resultsPath: string) {
  const catalog: CatalogDocument = JSON.parse(
    fs.readFileSync(CATALOG_PATH, 'utf8'),
  );
  const items = fs
    .readFileSync(path.join(OUT_DIR, 'items.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const results = fs
    .readFileSync(resultsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  // model-batch emits in completion order; realign by .index.
  const byId = new Map(catalog.presets.map((e) => [e.id, e]));
  let applied = 0;
  const distribution = new Map<string, number>();
  for (const result of results) {
    const item = items[result.index];
    if (!item) continue;
    const output = result.output ?? result.result ?? result;
    const category = output.category;
    if (!CATEGORIES.includes(category)) continue;
    const entry = byId.get(item.id);
    if (!entry) continue;
    const tag = `category:${category}`;
    if (!entry.tags.includes(tag)) entry.tags.push(tag);
    if (output.secondary && output.secondary !== 'none') {
      const secondaryTag = `category:${output.secondary}`;
      if (!entry.tags.includes(secondaryTag)) entry.tags.push(secondaryTag);
    }
    distribution.set(category, (distribution.get(category) ?? 0) + 1);
    applied++;
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`[autotag] applied categories to ${applied} presets`);
  console.log(
    '[autotag] distribution:',
    Object.fromEntries([...distribution.entries()].sort((a, b) => b[1] - a[1])),
  );
  if (distribution.size <= 2 && applied > 50) {
    console.warn(
      '[autotag] WARNING: near-uniform output distribution — inspect results before trusting (constrained decoding can classify garbage input confidently)',
    );
  }
}

if (import.meta.main) {
  const applyArg = process.argv.find((a) => a.startsWith('--apply='));
  if (applyArg) apply(applyArg.split('=')[1]);
  else emit();
}
