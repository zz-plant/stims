import fs from 'node:fs';
import path from 'node:path';

const COLLECTION_TAG_PREFIX = 'collection:';
const COLLECTION_LABELS: Record<string, string> = {
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:cream-of-the-crop': 'Cream of the Crop',
  'collection:feedback-lab': 'Feedback Lab',
  'collection:low-motion': 'Low Motion',
  'collection:rovastar-and-collaborators': 'Rovastar and collaborators',
  'collection:touch-friendly': 'Touch Friendly',
};
const CLASSIC_MILKDROP_TAGS = new Set([
  'collection:classic-milkdrop',
  'collection:cream-of-the-crop',
  'original-pack',
]);
const CLASSIC_AUTHOR_MARKERS = ['rovastar', 'eo.s.', 'krash', 'phat', 'geiss'];

type CatalogPresetEntry = {
  id: string;
  title: string;
  author?: string;
  tags: string[];
  searchTerms?: string[];
};

type CatalogDocument = {
  presets?: CatalogPresetEntry[];
};

function normalizeBrowseSearchValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function collectionLabel(tag: string) {
  if (!tag) return '';
  return (
    COLLECTION_LABELS[tag] ??
    tag.slice(COLLECTION_TAG_PREFIX.length).replace(/-/gu, ' ')
  );
}

function hasClassicMilkdropLineage(preset: CatalogPresetEntry) {
  if (preset.tags.some((tag) => CLASSIC_MILKDROP_TAGS.has(tag))) {
    return true;
  }
  const author = preset.author?.toLowerCase() ?? '';
  return CLASSIC_AUTHOR_MARKERS.some((marker) => author.includes(marker));
}

function isRovastarPreset(preset: CatalogPresetEntry) {
  const searchable = [preset.title, preset.author ?? '', ...preset.tags].join(
    ' ',
  );
  return normalizeBrowseSearchValue(searchable).includes('rovastar');
}

function getBrowseSearchTerms(preset: CatalogPresetEntry) {
  const terms = new Set<string>([
    preset.title,
    preset.author ?? '',
    ...preset.tags,
    ...(preset.searchTerms ?? []),
    ...preset.tags
      .filter((tag) => tag.startsWith(COLLECTION_TAG_PREFIX))
      .map((tag) => collectionLabel(tag)),
  ]);

  if (isRovastarPreset(preset)) {
    terms.add('rovastar');
    terms.add('rovastar classics');
  }

  if (hasClassicMilkdropLineage(preset)) {
    terms.add('classic milkdrop');
    terms.add('milkdrop classics');
    terms.add('winamp milkdrop');
    terms.add('geiss');
    terms.add('ryan geiss');
  }

  return [...terms]
    .map((value) => normalizeBrowseSearchValue(value))
    .filter(Boolean);
}

export async function generateCatalogSearchIndex(repoRoot = process.cwd()) {
  const catalogPath = path.join(
    repoRoot,
    'public/milkdrop-presets/catalog.json',
  );
  const outputPath = path.join(
    repoRoot,
    'public/milkdrop-presets/search-index.json',
  );

  if (!fs.existsSync(catalogPath)) {
    console.error(`Catalog not found: ${catalogPath}`);
    return;
  }

  // Skip regeneration if the search index is already up to date.
  if (fs.existsSync(outputPath)) {
    const catalogMtime = fs.statSync(catalogPath).mtimeMs;
    const indexMtime = fs.statSync(outputPath).mtimeMs;
    if (indexMtime >= catalogMtime) {
      console.log(
        `[INFO] Search index is up to date (catalog mtime ${new Date(catalogMtime).toISOString()}, index mtime ${new Date(indexMtime).toISOString()}). Skipping.`,
      );
      return;
    }
  }

  let doc: CatalogDocument;
  if (typeof Bun !== 'undefined') {
    doc = (await Bun.file(catalogPath).json()) as CatalogDocument;
  } else {
    const raw = fs.readFileSync(catalogPath, 'utf8');
    doc = JSON.parse(raw) as CatalogDocument;
  }

  const presets = doc.presets ?? [];

  const searchIndex: Record<
    string,
    { terms: string[]; combinedTerms: string }
  > = {};

  for (const preset of presets) {
    const terms = getBrowseSearchTerms(preset);
    searchIndex[preset.id] = {
      terms,
      combinedTerms: terms.join(' '),
    };
  }

  const outputContent = JSON.stringify(searchIndex, null, 2);
  if (typeof Bun !== 'undefined') {
    await Bun.write(outputPath, outputContent);
  } else {
    fs.writeFileSync(outputPath, outputContent, 'utf8');
  }

  console.log(
    `[INFO] Precompiled search index for ${Object.keys(searchIndex).length} presets -> ${outputPath}`,
  );
}

if (import.meta.main) {
  generateCatalogSearchIndex();
}
