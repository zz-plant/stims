import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const CATALOG_PATH = path.join(
  REPO_ROOT,
  'public/milkdrop-presets/catalog.json',
);
const PREVIEWS_DIR = path.join(REPO_ROOT, 'public/milkdrop-presets/previews');

type PresetEntry = {
  id: string;
  title: string;
  file: string;
  tags: string[];
  preview?: boolean | string;
  expectedFidelityClass?: string;
  [key: string]: unknown;
};

type CatalogDocument = {
  version: number;
  presets: PresetEntry[];
  [key: string]: unknown;
};

function logError(msg: string) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

function logInfo(msg: string) {
  console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`);
}

export function checkCatalogIntegrity(): boolean {
  if (!fs.existsSync(CATALOG_PATH)) {
    logError(`Catalog file not found at: ${CATALOG_PATH}`);
    return false;
  }

  let catalog: CatalogDocument;
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    catalog = JSON.parse(raw) as CatalogDocument;
  } catch (error) {
    logError(`Failed to parse catalog JSON: ${(error as Error).message}`);
    return false;
  }

  if (!catalog.presets || !Array.isArray(catalog.presets)) {
    logError("Catalog 'presets' field is missing or not an array.");
    return false;
  }

  logInfo(`Checking integrity of ${catalog.presets.length} catalog presets...`);

  let errorsCount = 0;
  const validFidelityClasses = new Set([
    'exact',
    'near-exact',
    'good',
    'partial',
    'unsupported',
  ]);

  for (const preset of catalog.presets) {
    const presetDesc = `Preset "${preset.id || 'unknown'}"`;

    if (!preset.id) {
      logError(`${presetDesc} is missing the "id" field.`);
      errorsCount += 1;
      continue;
    }

    if (!preset.title) {
      logError(`${presetDesc} is missing the "title" field.`);
      errorsCount += 1;
    }

    if (!preset.file) {
      logError(`${presetDesc} is missing the "file" field.`);
      errorsCount += 1;
    } else {
      // Resolve path on disk relative to 'public' folder
      const rawFile = preset.file.startsWith('/')
        ? preset.file.slice(1)
        : preset.file;
      const filePath = path.join(REPO_ROOT, 'public', rawFile);
      if (!fs.existsSync(filePath)) {
        logError(
          `${presetDesc} references file that does not exist on disk: ${filePath}`,
        );
        errorsCount += 1;
      }
    }

    if (!preset.tags || !Array.isArray(preset.tags)) {
      logError(`${presetDesc} is missing "tags" array.`);
      errorsCount += 1;
    }

    if (
      preset.expectedFidelityClass &&
      !validFidelityClasses.has(preset.expectedFidelityClass)
    ) {
      logError(
        `${presetDesc} has invalid expectedFidelityClass: "${preset.expectedFidelityClass}". Valid options: ${[...validFidelityClasses].join(', ')}`,
      );
      errorsCount += 1;
    }

    // Verify preview file exists (only for core/bundled presets, not butterchurn ones)
    if (preset.preview === true && !preset.file.includes('/butterchurn/')) {
      const previewFile = path.join(PREVIEWS_DIR, `${preset.id}.png`);
      if (!fs.existsSync(previewFile)) {
        logError(
          `${presetDesc} has preview=true but missing preview image at: ${previewFile}`,
        );
        errorsCount += 1;
      }
    }
  }

  if (errorsCount > 0) {
    logError(`Catalog integrity checks failed with ${errorsCount} errors.`);
    return false;
  }

  logInfo('Preset catalog integrity checks passed successfully.');
  return true;
}

if (import.meta.main) {
  const ok = checkCatalogIntegrity();
  if (!ok) {
    process.exit(1);
  }
}
