import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
    url?: string | null;
    durationMs?: number | null;
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

export function appendParityArtifactEntry(
  outputDir: string,
  entryInput: ParityArtifactEntryInput,
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

  const manifest = loadParityArtifactManifest(outputDir);
  manifest.artifacts.push(entry);
  const manifestPath = saveParityArtifactManifest(outputDir, manifest);
  return { entry, manifestPath };
}

export function hashFileSha256(filePath: string) {
  const digest = createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}
