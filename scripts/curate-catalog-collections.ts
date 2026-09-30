/**
 * Curate catalog.json's collections: the hand-picked hall of fame and the
 * audio-reactive set read from each preset's equations.
 *
 *   bun run scripts/curate-catalog-collections.ts                        # both
 *   bun run scripts/curate-catalog-collections.ts --only hall-of-fame    # just one
 *
 * `--only` repeats. Each collection is derived from its rule alone: a preset
 * that stops matching loses the tag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { labelPresetAudio } from './preset-lab-dataflow.ts';

const CATALOG_PATH = path.join(
  import.meta.dir,
  '..',
  'public',
  'milkdrop-presets',
  'catalog.json',
);

type CatalogPresetEntry = {
  id: string;
  title: string;
  author?: string;
  file: string;
  tags: string[];
};

type CatalogDocument = {
  version: number;
  generatedAt: string;
  certification: string;
  corpusTier: string;
  presets: CatalogPresetEntry[];
};

/**
 * The classics, one preset each, and the only members of the hall of fame.
 * An author or title rule tagged 1,400 presets (78% of the catalog) as the
 * hall of fame, so the collection filtered almost nothing. The first twelve
 * are the hand-picked Classic MilkDrop set; the last four are the original of
 * each famous title that set did not already cover.
 */
export const HALL_OF_FAME = [
  'eos-glowsticks-v2-03-music',
  'rovastar-parallel-universe',
  'eos-phat-cubetrace-v2',
  'krash-rovastar-cerebral-demons-stars',
  'aderrasi-potion-of-spirits',
  'geiss-casino',
  'shifter-snakeskin',
  'shifter-swarm',
  'shifter-curlique',
  'rovastar-harlequins-liquid-dragon',
  'eos-heater-core-c',
  'orb-radiation',
  'zylot-crosshair-dimension-light-of-ages',
  'martin-neon-space-ps3',
  // the original the Filament, beat-dots and rad8 mixes build on
  'geiss-spiral-artifact',
  // the Starburst that AdamFX's "Starburst 5" mashup remixes
  'eos-starburst-05-phasing',
] as const;

const HALL_OF_FAME_TAG = 'collection:hall-of-fame';
const AUDIO_REACTIVE = 'collection:audio-reactive';
const PUBLIC_ROOT = path.join(import.meta.dir, '..', 'public');

function setTag(preset: CatalogPresetEntry, tag: string, member: boolean) {
  const tagged = preset.tags.includes(tag);
  if (member && !tagged) preset.tags.unshift(tag);
  if (!member && tagged) preset.tags = preset.tags.filter((t) => t !== tag);
}

/**
 * Tag exactly the HALL_OF_FAME presets. A listed id missing from the catalog
 * throws: a renamed or removed classic has to be replaced on purpose, not
 * dropped from the collection without anyone noticing.
 */
export function curateHallOfFame(presets: CatalogPresetEntry[]) {
  const present = new Set(presets.map((preset) => preset.id));
  const missing = HALL_OF_FAME.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new Error(
      `hall-of-fame ids not in the catalog: ${missing.join(', ')}`,
    );
  }
  const members = new Set<string>(HALL_OF_FAME);
  for (const preset of presets) {
    setTag(preset, HALL_OF_FAME_TAG, members.has(preset.id));
  }
  return members.size;
}

function audioDriven(preset: CatalogPresetEntry) {
  const file = path.join(PUBLIC_ROOT, preset.file.replace(/^\//, ''));
  if (!fs.existsSync(file)) return false;
  try {
    const { ir } = compileMilkdropPresetSource(
      fs.readFileSync(file, 'latin1'),
      { id: preset.id },
    );
    return labelPresetAudio(ir).tier === 'driven';
  } catch {
    return false;
  }
}

type Collection = 'hall-of-fame' | 'audio-reactive';

function curateCatalog(only: readonly Collection[]) {
  const run = (collection: Collection) =>
    only.length === 0 || only.includes(collection);
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  const catalog: CatalogDocument = JSON.parse(raw);

  const hallOfFameCount = run('hall-of-fame')
    ? curateHallOfFame(catalog.presets)
    : 0;

  // Audio-reactive: the audio drives what the preset draws, read from its
  // equations (lab:dataflow's `driven` tier). This replaced a title keyword
  // and author heuristic that missed 361 driven presets and tagged 275 whose
  // audio reaches nothing but, at most, the waveform.
  let audioReactiveCount = 0;
  if (run('audio-reactive')) {
    for (const preset of catalog.presets) {
      const reactive = audioDriven(preset);
      const tagged = preset.tags.includes(AUDIO_REACTIVE);
      if (reactive && !tagged) preset.tags.push(AUDIO_REACTIVE);
      if (!reactive && tagged)
        preset.tags = preset.tags.filter((tag) => tag !== AUDIO_REACTIVE);
      if (reactive) audioReactiveCount++;
    }
  }

  fs.writeFileSync(
    CATALOG_PATH,
    `${JSON.stringify(catalog, null, 2)}\n`,
    'utf8',
  );
  console.log(`[curate] Updated catalog.json with curated collections:`);
  console.log(`  - Hall of Fame: ${hallOfFameCount} presets`);
  console.log(`  - Audio-Reactive: ${audioReactiveCount} presets`);
}

const COLLECTIONS: readonly Collection[] = ['hall-of-fame', 'audio-reactive'];
if (import.meta.main) {
  // a bare `--only` (say, from an empty shell variable) must fail, not run all
  const only = process.argv.flatMap((arg, i, argv) =>
    arg === '--only' ? [argv[i + 1] ?? ''] : [],
  );
  const unknown = only.filter(
    (name) => !COLLECTIONS.includes(name as Collection),
  );
  if (unknown.length > 0) {
    console.error(`--only takes one of: ${COLLECTIONS.join(', ')}`);
    process.exit(1);
  }
  curateCatalog(only as Collection[]);
}
