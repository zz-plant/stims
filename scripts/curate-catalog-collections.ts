/**
 * Curate catalog.json's broad collections: hall of fame, WebGPU showcase and
 * audio-reactive.
 *
 *   bun run scripts/curate-catalog-collections.ts                        # all three
 *   bun run scripts/curate-catalog-collections.ts --only audio-reactive  # just one
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
  expectedFidelityClass?: string;
  visualEvidenceTier?: string;
  supports?: { webgl: boolean; webgpu: boolean };
  visualCertification?: {
    status?: string;
    fidelityClass?: string;
    actualBackend?: string;
  };
};

type CatalogDocument = {
  version: number;
  generatedAt: string;
  certification: string;
  corpusTier: string;
  presets: CatalogPresetEntry[];
};

const HALL_OF_FAME_AUTHORS = [
  'geiss',
  'rovastar',
  'zylot',
  'eo.s.',
  'martin',
  'aderrasi',
  'orb',
  'flexi',
  'fishbrain',
  'cope',
  'unchained',
  'suksma',
  'che',
  'fsp',
  'idiot',
  'unbalanced',
  'ning',
  'benski',
  'telek',
  'yad',
  'stahlregen',
];

const HALL_OF_FAME_TITLES = [
  'cerebral demons',
  'light of ages',
  'starburst',
  'neon space',
  'potion of spirits',
  'radiation',
  'crosshair dimension',
  'glowsticks',
  'parallel universe',
  'artifact',
  'dynamic wave',
  'hyperion',
];

const AUDIO_REACTIVE = 'collection:audio-reactive';
const PUBLIC_ROOT = path.join(import.meta.dir, '..', 'public');

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

type Collection = 'hall-of-fame' | 'webgpu-showcase' | 'audio-reactive';

function curateCatalog(only: Collection | undefined) {
  const run = (collection: Collection) => !only || only === collection;
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  const catalog: CatalogDocument = JSON.parse(raw);

  let hallOfFameCount = 0;
  let webgpuShowcaseCount = 0;
  let audioReactiveCount = 0;

  for (const preset of catalog.presets) {
    const authorLower = (preset.author ?? '').toLowerCase();
    const titleLower = preset.title.toLowerCase();

    // 1. Hall of Fame Tagging
    const isHallOfFameAuthor = HALL_OF_FAME_AUTHORS.some((a) =>
      authorLower.includes(a),
    );
    const isHallOfFameTitle = HALL_OF_FAME_TITLES.some((t) =>
      titleLower.includes(t),
    );
    if (run('hall-of-fame') && (isHallOfFameAuthor || isHallOfFameTitle)) {
      if (!preset.tags.includes('collection:hall-of-fame')) {
        preset.tags.unshift('collection:hall-of-fame');
      }
      hallOfFameCount++;
    }

    // 2. WebGPU Showcase Tagging
    const isWebGpuCertified =
      preset.visualCertification?.actualBackend === 'webgpu' ||
      preset.supports?.webgpu === true;
    const isHighFidelity =
      preset.expectedFidelityClass === 'near-exact' ||
      preset.visualCertification?.fidelityClass === 'near-exact';

    if (
      run('webgpu-showcase') &&
      isWebGpuCertified &&
      (isHighFidelity || isHallOfFameAuthor)
    ) {
      if (!preset.tags.includes('collection:webgpu-showcase')) {
        preset.tags.unshift('collection:webgpu-showcase');
      }
      webgpuShowcaseCount++;
    }

    // 3. Audio-reactive: the audio drives what the preset draws, read from
    //    its equations (lab:dataflow's `driven` tier). This replaced a title
    //    keyword and author heuristic that missed 361 driven presets and
    //    tagged 275 whose audio reaches nothing but, at most, the waveform.
    if (!run('audio-reactive')) continue;
    const reactive = audioDriven(preset);
    const tagged = preset.tags.includes(AUDIO_REACTIVE);
    if (reactive && !tagged) preset.tags.push(AUDIO_REACTIVE);
    if (!reactive && tagged)
      preset.tags = preset.tags.filter((tag) => tag !== AUDIO_REACTIVE);
    if (reactive) audioReactiveCount++;
  }

  fs.writeFileSync(
    CATALOG_PATH,
    `${JSON.stringify(catalog, null, 2)}\n`,
    'utf8',
  );
  console.log(`[curate] Updated catalog.json with curated collections:`);
  console.log(`  - Hall of Fame: ${hallOfFameCount} presets`);
  console.log(`  - WebGPU Showcase: ${webgpuShowcaseCount} presets`);
  console.log(`  - Audio-Reactive: ${audioReactiveCount} presets`);
}

const COLLECTIONS: readonly Collection[] = [
  'hall-of-fame',
  'webgpu-showcase',
  'audio-reactive',
];
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
if (only !== undefined && !COLLECTIONS.includes(only as Collection)) {
  console.error(`--only takes one of: ${COLLECTIONS.join(', ')}`);
  process.exit(1);
}
curateCatalog(only as Collection | undefined);
