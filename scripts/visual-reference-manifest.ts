import fs from 'node:fs';
import path from 'node:path';

export const VISUAL_REFERENCE_MANIFEST_PATH =
  'assets/data/milkdrop-parity/visual-reference-manifest.json';
export const VISUAL_REFERENCE_FIXTURE_ROOT =
  'tests/fixtures/milkdrop/projectm-reference';

export type VisualReferencePresetEntry = {
  id: string;
  title: string;
  image: string;
  metadata?: string | null;
  strata: string[];
  tolerance: {
    threshold: number;
    failThreshold: number;
  };
  capture: {
    renderer: 'projectm';
    width: number;
    height: number;
  };
  provenance: {
    label: string;
    importedAt: string;
    sourceArtifactId?: string | null;
  };
};

export type VisualReferenceManifest = {
  version: 1;
  parityTarget: 'projectm-visual-reference';
  fixtureRoot: string;
  minimumPresetCount: number;
  presetCount: number;
  defaults: {
    renderer: 'projectm';
    width: number;
    height: number;
    threshold: number;
    failThreshold: number;
  };
  presets: VisualReferencePresetEntry[];
};

export function createDefaultVisualReferenceManifest(): VisualReferenceManifest {
  return {
    version: 1,
    parityTarget: 'projectm-visual-reference',
    fixtureRoot: VISUAL_REFERENCE_FIXTURE_ROOT,
    minimumPresetCount: 0,
    presetCount: 0,
    defaults: {
      renderer: 'projectm',
      width: 1280,
      height: 720,
      threshold: 16,
      failThreshold: 0.02,
    },
    presets: [],
  };
}

export function loadVisualReferenceManifest(
  repoRoot: string,
): VisualReferenceManifest {
  const manifestPath = path.join(repoRoot, VISUAL_REFERENCE_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) {
    return createDefaultVisualReferenceManifest();
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<VisualReferenceManifest>;

  return {
    ...createDefaultVisualReferenceManifest(),
    ...parsed,
    presets: Array.isArray(parsed.presets) ? parsed.presets : [],
    presetCount: Array.isArray(parsed.presets)
      ? parsed.presets.length
      : (parsed.presetCount ?? 0),
  };
}

export function saveVisualReferenceManifest(
  repoRoot: string,
  manifest: VisualReferenceManifest,
) {
  const manifestPath = path.join(repoRoot, VISUAL_REFERENCE_MANIFEST_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const normalized: VisualReferenceManifest = {
    ...manifest,
    presetCount: manifest.presets.length,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return manifestPath;
}

export function upsertVisualReferencePreset(
  repoRoot: string,
  entry: VisualReferencePresetEntry,
) {
  const manifest = loadVisualReferenceManifest(repoRoot);
  const nextPresets = manifest.presets.filter(
    (preset) => preset.id !== entry.id,
  );
  nextPresets.push(entry);
  nextPresets.sort((left, right) => left.id.localeCompare(right.id));
  const nextManifest: VisualReferenceManifest = {
    ...manifest,
    presets: nextPresets,
    presetCount: nextPresets.length,
  };
  const manifestPath = saveVisualReferenceManifest(repoRoot, nextManifest);
  return {
    manifest: nextManifest,
    manifestPath,
  };
}
