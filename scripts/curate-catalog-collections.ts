import fs from 'node:fs';
import path from 'node:path';

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

function curateCatalog() {
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
    if (isHallOfFameAuthor || isHallOfFameTitle) {
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

    if (isWebGpuCertified && (isHighFidelity || isHallOfFameAuthor)) {
      if (!preset.tags.includes('collection:webgpu-showcase')) {
        preset.tags.unshift('collection:webgpu-showcase');
      }
      webgpuShowcaseCount++;
    }

    // 3. Audio-Reactive Masterpieces Tagging
    const hasAudioKeywords =
      titleLower.includes('music') ||
      titleLower.includes('beat') ||
      titleLower.includes('pulse') ||
      titleLower.includes('wave') ||
      titleLower.includes('audio') ||
      titleLower.includes('spectrum') ||
      titleLower.includes('bass') ||
      titleLower.includes('glowstick');

    if (hasAudioKeywords || isHallOfFameAuthor) {
      if (!preset.tags.includes('collection:audio-reactive')) {
        preset.tags.push('collection:audio-reactive');
      }
      audioReactiveCount++;
    }
  }

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`[curate] Updated catalog.json with curated collections:`);
  console.log(`  - Hall of Fame: ${hallOfFameCount} presets`);
  console.log(`  - WebGPU Showcase: ${webgpuShowcaseCount} presets`);
  console.log(`  - Audio-Reactive: ${audioReactiveCount} presets`);
}

curateCatalog();
