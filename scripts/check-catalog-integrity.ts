/**
 * Validates the bundled MilkDrop catalog: every entry's required fields, the
 * preset file on disk, and its preview image.
 *
 * Each preset must carry id/title/file/tags, a `supports` object with boolean
 * webgl and webgpu, and a known expectedFidelityClass; presets marked
 * `preview: true` must have a PNG present and must not appear in
 * preview-failures.json (advisory only while that file has uncommitted changes
 * from an in-flight preview batch). Exits non-zero on any error.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const CATALOG_PATH = path.join(
  REPO_ROOT,
  'public/milkdrop-presets/catalog.json',
);
const PREVIEWS_DIR = path.join(REPO_ROOT, 'public/milkdrop-presets/previews');
const PREVIEW_FAILURES_PATH = path.join(
  REPO_ROOT,
  'public/milkdrop-presets/preview-failures.json',
);

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

function logWarning(msg: string) {
  console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`);
}

export function checkCatalogIntegrity(): boolean {
  const previewsAvailable = fs.existsSync(PREVIEWS_DIR);
  if (!previewsAvailable) {
    logInfo(
      'Previews directory absent (generated artifacts live in R2); skipping preview-file validation.',
    );
  }
  const catalogFile = Bun.file(CATALOG_PATH);
  if (catalogFile.size === 0) {
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

  // Ids key React lists, Object.fromEntries maps, and the SEO preset map; a
  // duplicate silently drops one of the pair instead of failing loudly.
  const idFirstSeen = new Map<string, string>();
  for (const preset of catalog.presets) {
    if (!preset.id) continue;
    const previousTitle = idFirstSeen.get(preset.id);
    if (previousTitle !== undefined) {
      logError(
        `Duplicate preset id "${preset.id}" (first used by "${previousTitle}", reused by "${preset.title}"). Ids must be unique across the catalog.`,
      );
      errorsCount += 1;
      continue;
    }
    idFirstSeen.set(preset.id, preset.title);
  }

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
      if (Bun.file(filePath).size === 0) {
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

    const supports = preset.supports as
      | { webgl?: unknown; webgpu?: unknown }
      | undefined;
    if (
      !supports ||
      typeof supports.webgl !== 'boolean' ||
      typeof supports.webgpu !== 'boolean'
    ) {
      logError(
        `${presetDesc} is missing a "supports" object with boolean "webgl" and "webgpu" fields.`,
      );
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

    // Verify preview file exists (only for core/bundled presets, not
    // butterchurn ones). Previews live in R2, not git, so a checkout without
    // the generated directory (CI, fresh clone) skips this validation.
    if (
      previewsAvailable &&
      preset.preview === true &&
      !preset.file.includes('/butterchurn/')
    ) {
      const previewFile = path.join(PREVIEWS_DIR, `${preset.id}.png`);
      if (Bun.file(previewFile).size === 0) {
        logError(
          `${presetDesc} has preview=true but missing preview image at: ${previewFile}`,
        );
        errorsCount += 1;
      }
    }
  }

  // The thumbnail pipeline records presets whose renders came back black or
  // otherwise unusable. A preset on that list must not advertise a preview —
  // otherwise a known-broken render ships indistinguishable from a working
  // one.
  if (fs.existsSync(PREVIEW_FAILURES_PATH)) {
    // A preview-generation batch rewrites this file continuously while it
    // runs, and its interim contents describe the batch's captures, not the
    // shipped catalog. While the file has uncommitted changes, the mismatch
    // is in-flight work: report it as a warning so unrelated commits are not
    // blocked for the duration of a batch. Once the file is committed (the
    // only state CI ever sees), the check is strict again.
    let failuresFileDirty = false;
    try {
      failuresFileDirty =
        execSync(`git status --porcelain -- ${PREVIEW_FAILURES_PATH}`, {
          encoding: 'utf8',
        }).trim().length > 0;
    } catch {
      // Not a git checkout (CI tarball, etc.) — treat as clean and strict.
    }
    const report = failuresFileDirty
      ? (message: string) => logWarning(message)
      : (message: string) => {
          logError(message);
          errorsCount += 1;
        };
    if (failuresFileDirty) {
      logWarning(
        'preview-failures.json has uncommitted changes (a preview batch is in flight); preview-flag mismatches below are advisory until the batch is reconciled and committed.',
      );
    }
    try {
      const failures = JSON.parse(
        fs.readFileSync(PREVIEW_FAILURES_PATH, 'utf8'),
      ) as Array<{ presetId: string; reason?: string }>;
      const presetsById = new Map(catalog.presets.map((p) => [p.id, p]));
      for (const failure of failures) {
        const entry = presetsById.get(failure.presetId);
        if (entry && entry.preview === true) {
          report(
            `Preset "${failure.presetId}" is listed in preview-failures.json (${failure.reason ?? 'render failure'}) but still has preview=true in the catalog. Set preview=false or fix and re-render the preview.`,
          );
        }
      }
    } catch (error) {
      logError(
        `Failed to parse preview-failures.json: ${(error as Error).message}`,
      );
      errorsCount += 1;
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
