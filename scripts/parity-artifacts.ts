import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MilkdropRenderBackend } from '../src/js/milkdrop/common-types.ts';

export const PARITY_ARTIFACT_MANIFEST_FILE = 'parity-artifacts.manifest.json';

export type ParityArtifactKind =
  | 'stims-capture'
  | 'projectm-reference'
  | 'parity-diff';

export type ParityArtifactEntry = {
  id: string;
  kind: ParityArtifactKind;
  slug: string;
  presetId: string | null;
  title?: string | null;
  createdAt: string;
  files: {
    image?: string | null;
    debugSnapshot?: string | null;
    metadata?: string | null;
  };
  capture?: {
    backend?: MilkdropRenderBackend | null;
    url?: string | null;
    durationMs?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
    audioMode?: 'demo' | 'microphone' | 'none' | null;
    vibeMode?: boolean | null;
  };
  provenance?: {
    label?: string | null;
    importedFrom?: string | null;
    imageSha256?: string | null;
    metadataSha256?: string | null;
  };
};

export type ParityArtifactManifest = {
  version: 1;
  artifacts: ParityArtifactEntry[];
};

export type ParityArtifactEntryInput = Omit<
  ParityArtifactEntry,
  'id' | 'createdAt' | 'files'
> & {
  id?: string;
  createdAt?: string;
  files?: {
    image?: string | null;
    debugSnapshot?: string | null;
    metadata?: string | null;
  };
};

function sanitizeArtifactSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureOutputDir(outputDir: string) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function toManifestPath(
  outputDir: string,
  filePath: string | null | undefined,
) {
  if (!filePath) {
    return null;
  }

  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedFilePath = path.resolve(filePath);
  const relativePath = path.relative(resolvedOutputDir, resolvedFilePath);
  if (!relativePath || relativePath.startsWith('..')) {
    return resolvedFilePath;
  }
  return relativePath.replace(/\\/g, '/');
}

export function buildParityArtifactStem({
  kind,
  slug,
  presetId,
}: {
  kind: ParityArtifactKind;
  slug: string;
  presetId?: string | null;
}) {
  const parts = [sanitizeArtifactSegment(kind), sanitizeArtifactSegment(slug)];
  if (presetId?.trim()) {
    parts.push('preset', sanitizeArtifactSegment(presetId));
  }
  return parts.filter(Boolean).join('--');
}

export function buildParityArtifactId({
  kind,
  slug,
  presetId,
  createdAt,
}: {
  kind: ParityArtifactKind;
  slug: string;
  presetId?: string | null;
  createdAt: string;
}) {
  const stem = buildParityArtifactStem({ kind, slug, presetId });
  const timeSegment = createdAt.replace(/[^0-9]/g, '').slice(0, 14) || '0';
  return `${stem}--${timeSegment}`;
}

export function createDefaultParityArtifactManifest(): ParityArtifactManifest {
  return {
    version: 1,
    artifacts: [],
  };
}

export function getParityArtifactManifestPath(outputDir: string) {
  return path.join(outputDir, PARITY_ARTIFACT_MANIFEST_FILE);
}

export function loadParityArtifactManifest(
  outputDir: string,
): ParityArtifactManifest {
  const manifestPath = getParityArtifactManifestPath(outputDir);
  if (!fs.existsSync(manifestPath)) {
    return createDefaultParityArtifactManifest();
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ParityArtifactManifest>;
  return {
    version: 1,
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
  };
}

export function saveParityArtifactManifest(
  outputDir: string,
  manifest: ParityArtifactManifest,
) {
  ensureOutputDir(outputDir);
  const manifestPath = getParityArtifactManifestPath(outputDir);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

/**
 * How many captures to retain per (kind, slug, preset) group. Captures are
 * regenerable via scripts/capture-*.ts, so the manifest only needs enough
 * history to compare a change against its immediate predecessor. Override with
 * STIMS_PARITY_KEEP_PER_PRESET=n.
 */
export const DEFAULT_KEEP_PER_PRESET = 3;

function resolveKeepPerPreset(explicit?: number) {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.max(1, Math.floor(explicit));
  }
  const fromEnv = Number.parseInt(
    process.env.STIMS_PARITY_KEEP_PER_PRESET ?? '',
    10,
  );
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : DEFAULT_KEEP_PER_PRESET;
}

function artifactGroupKey(entry: ParityArtifactEntry) {
  return `${entry.kind}|${entry.slug}|${entry.presetId ?? ''}`;
}

function entryFilePaths(outputDir: string, entry: ParityArtifactEntry) {
  return [entry.files.image, entry.files.debugSnapshot, entry.files.metadata]
    .filter((value): value is string => Boolean(value))
    .map((value) =>
      path.isAbsolute(value) ? value : path.join(outputDir, value),
    );
}

/**
 * Drop manifest entries whose files no longer exist on disk. Captures get
 * cleaned up outside this script (git, manual deletion), which otherwise
 * leaves the manifest pointing at nothing.
 */
export function reconcileParityArtifactManifest(
  outputDir: string,
  manifest: ParityArtifactManifest,
): { manifest: ParityArtifactManifest; dropped: ParityArtifactEntry[] } {
  const kept: ParityArtifactEntry[] = [];
  const dropped: ParityArtifactEntry[] = [];
  for (const entry of manifest.artifacts) {
    const files = entryFilePaths(outputDir, entry);
    // An entry with no files at all is metadata-only; keep it. Otherwise it
    // survives only while at least one of its files is still on disk.
    if (files.length === 0 || files.some((file) => fs.existsSync(file))) {
      kept.push(entry);
    } else {
      dropped.push(entry);
    }
  }
  return { manifest: { version: 1, artifacts: kept }, dropped };
}

/**
 * Absolute paths of captures cited as evidence by shipped data files. These are
 * load-bearing (the certification report links to them), so prune must never
 * delete them regardless of age.
 */
export function readProtectedCapturePaths(
  repoRoot: string = path.resolve(import.meta.dir, '..'),
): Set<string> {
  const protectedPaths = new Set<string>();
  const evidenceFiles = [
    'src/data/milkdrop-parity/webgpu-certification-report.json',
    'src/data/milkdrop-parity/measured-results.json',
  ];
  for (const relative of evidenceFiles) {
    const file = path.join(repoRoot, relative);
    if (!fs.existsSync(file)) {
      continue;
    }
    const raw = fs.readFileSync(file, 'utf8');
    for (const match of raw.matchAll(
      /"(?:capturePath|referencePath|imagePath)"\s*:\s*"([^"]+)"/g,
    )) {
      const captured = match[1];
      if (!captured) {
        continue;
      }
      protectedPaths.add(
        path.isAbsolute(captured) ? captured : path.join(repoRoot, captured),
      );
    }
  }
  return protectedPaths;
}

/**
 * Retain only the newest `keepPerPreset` captures per (kind, slug, preset),
 * deleting the superseded files from disk. Without this the manifest and the
 * capture directory grow without bound across every sweep. Captures cited as
 * evidence are always retained — see `readProtectedCapturePaths`.
 */
export function pruneParityArtifacts(
  outputDir: string,
  manifest: ParityArtifactManifest,
  options: {
    keepPerPreset?: number;
    dryRun?: boolean;
    keepFiles?: Set<string>;
  } = {},
): {
  manifest: ParityArtifactManifest;
  pruned: ParityArtifactEntry[];
  removedFiles: string[];
} {
  const keepPerPreset = resolveKeepPerPreset(options.keepPerPreset);
  const groups = new Map<string, ParityArtifactEntry[]>();
  for (const entry of manifest.artifacts) {
    const key = artifactGroupKey(entry);
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const protectedFiles = options.keepFiles ?? readProtectedCapturePaths();

  const keepIds = new Set<string>();
  const pruned: ParityArtifactEntry[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    for (const [index, entry] of ordered.entries()) {
      const isCitedEvidence = entryFilePaths(outputDir, entry).some((file) =>
        protectedFiles.has(path.resolve(file)),
      );
      if (index < keepPerPreset || isCitedEvidence) {
        keepIds.add(entry.id);
      } else {
        pruned.push(entry);
      }
    }
  }

  // Never delete a file another retained entry still references.
  const retainedFiles = new Set(
    manifest.artifacts
      .filter((entry) => keepIds.has(entry.id))
      .flatMap((entry) => entryFilePaths(outputDir, entry)),
  );

  const removedFiles: string[] = [];
  for (const entry of pruned) {
    for (const file of entryFilePaths(outputDir, entry)) {
      if (retainedFiles.has(file) || !fs.existsSync(file)) {
        continue;
      }
      if (!options.dryRun) {
        fs.rmSync(file, { force: true });
      }
      removedFiles.push(file);
    }
  }

  return {
    manifest: {
      version: 1,
      artifacts: manifest.artifacts.filter((entry) => keepIds.has(entry.id)),
    },
    pruned,
    removedFiles,
  };
}

export function appendParityArtifactEntry(
  outputDir: string,
  entryInput: ParityArtifactEntryInput,
  options: { keepPerPreset?: number } = {},
) {
  const createdAt = entryInput.createdAt ?? new Date().toISOString();
  const entry: ParityArtifactEntry = {
    id:
      entryInput.id ??
      buildParityArtifactId({
        kind: entryInput.kind,
        slug: entryInput.slug,
        presetId: entryInput.presetId,
        createdAt,
      }),
    kind: entryInput.kind,
    slug: entryInput.slug,
    presetId: entryInput.presetId ?? null,
    title: entryInput.title ?? null,
    createdAt,
    files: {
      image: toManifestPath(outputDir, entryInput.files?.image),
      debugSnapshot: toManifestPath(outputDir, entryInput.files?.debugSnapshot),
      metadata: toManifestPath(outputDir, entryInput.files?.metadata),
    },
    capture: entryInput.capture,
    provenance: entryInput.provenance,
  };

  const loaded = loadParityArtifactManifest(outputDir);
  loaded.artifacts.push(entry);

  // Reconcile before pruning so entries whose files were already removed
  // elsewhere don't count against this preset's retention budget.
  const { manifest: reconciled } = reconcileParityArtifactManifest(
    outputDir,
    loaded,
  );
  const { manifest, pruned, removedFiles } = pruneParityArtifacts(
    outputDir,
    reconciled,
    { keepPerPreset: options.keepPerPreset },
  );

  const manifestPath = saveParityArtifactManifest(outputDir, manifest);
  return { entry, manifestPath, pruned, removedFiles };
}

/**
 * The newest Stims capture recorded for a preset in an artifact directory.
 *
 * Three tools need "the frame the capture just produced" — the suite checks
 * its backend, the noise tool diffs it, the promote flow inspects it — and
 * each had grown its own filter-and-take-last over the manifest. One accessor
 * keeps "latest" meaning the same thing everywhere: last manifest entry of
 * kind stims-capture for the id, with the image path resolved absolute.
 */
export function latestStimsCapture(outputDir: string, presetId: string) {
  const artifacts = loadParityArtifactManifest(outputDir).artifacts.filter(
    (entry) => entry.kind === 'stims-capture' && entry.presetId === presetId,
  );
  const artifact = artifacts[artifacts.length - 1] ?? null;
  if (!artifact) {
    return null;
  }
  const image = artifact.files.image
    ? path.isAbsolute(artifact.files.image)
      ? artifact.files.image
      : path.join(outputDir, artifact.files.image)
    : null;
  return {
    artifact,
    imagePath: image,
    backend: artifact.capture?.backend ?? null,
  };
}

export function hashFileSha256(filePath: string) {
  const digest = createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}
