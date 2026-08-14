import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(import.meta.dir, '..');
const CATALOG_PATH = path.join(
  REPO_ROOT,
  'public',
  'milkdrop-presets',
  'catalog.json',
);
const COMMUNITY_PRESETS_DIR = path.join(
  REPO_ROOT,
  'public',
  'milkdrop-presets',
  'community',
);

type CatalogPresetEntry = {
  id: string;
  title: string;
  author?: string;
  order: number;
  file: string;
  preview: boolean;
  tags: string[];
  expectedFidelityClass: string;
  visualEvidenceTier: string;
  supports: { webgl: boolean; webgpu: boolean };
};

type CatalogDocument = {
  version: number;
  generatedAt: string;
  certification: string;
  corpusTier: string;
  presets: CatalogPresetEntry[];
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function ingestMilkPresets(sourceDir?: string) {
  const targetSourceDir = sourceDir ?? COMMUNITY_PRESETS_DIR;
  if (!fs.existsSync(targetSourceDir)) {
    fs.mkdirSync(targetSourceDir, { recursive: true });
    console.log(
      `[ingest] Created directory ${targetSourceDir}. Place .milk files here to ingest.`,
    );
    return;
  }

  const files = fs
    .readdirSync(targetSourceDir)
    .filter((f) => f.endsWith('.milk'));
  if (files.length === 0) {
    console.log(`[ingest] No .milk files found in ${targetSourceDir}.`);
    return;
  }

  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  const catalog: CatalogDocument = JSON.parse(raw);
  const existingIds = new Set(catalog.presets.map((p) => p.id));
  let addedCount = 0;

  for (const file of files) {
    const basename = path.basename(file, '.milk');
    const id = slugify(`community-${basename}`);

    if (existingIds.has(id)) {
      continue;
    }

    const titleParts = basename.split(' - ');
    const author =
      titleParts.length > 1 ? titleParts[0].trim() : 'Community Author';
    const title =
      titleParts.length > 1 ? titleParts.slice(1).join(' - ').trim() : basename;

    const relativeFile = `/milkdrop-presets/community/${file}`;

    const newEntry: CatalogPresetEntry = {
      id,
      title: `${author} - ${title}`,
      author,
      order: catalog.presets.length + 1,
      file: relativeFile,
      preview: true,
      tags: [
        'collection:community',
        'collection:hall-of-fame',
        'community-preset',
        'milkdrop',
      ],
      expectedFidelityClass: 'compiles',
      visualEvidenceTier: 'runtime',
      supports: {
        webgl: true,
        webgpu: true,
      },
    };

    catalog.presets.push(newEntry);
    existingIds.add(id);
    addedCount++;
  }

  if (addedCount > 0) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
    console.log(
      `[ingest] Ingested ${addedCount} new community .milk presets into catalog.json.`,
    );
  } else {
    console.log(
      `[ingest] All ${files.length} .milk files are already indexed in catalog.json.`,
    );
  }
}

if (import.meta.main) {
  const customDir = process.argv[2];
  ingestMilkPresets(customDir);
}
