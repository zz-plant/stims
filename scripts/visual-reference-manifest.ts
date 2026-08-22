import fs from 'node:fs';
import path from 'node:path';
import type {
  MilkdropParitySourceFamily,
  MilkdropParityToleranceProfile,
  MilkdropRenderBackend,
} from '../src/js/milkdrop/common-types.ts';

export const VISUAL_REFERENCE_MANIFEST_PATH =
  'src/data/milkdrop-parity/visual-reference-manifest.json';
export const VISUAL_REFERENCE_FIXTURE_ROOT =
  'tests/fixtures/milkdrop/projectm-reference';

export type VisualReferencePresetEntry = {
  id: string;
  title: string;
  image: string;
  metadata?: string | null;
  sourceFamily: MilkdropParitySourceFamily;
  strata: string[];
  tolerance: {
    profile: MilkdropParityToleranceProfile;
    threshold: number;
    failThreshold: number;
  };
  capture: {
    renderer: 'projectm' | 'stims';
    requiredBackend: MilkdropRenderBackend;
    width: number;
    height: number;
    warmupMs: number;
    captureOffsetMs: number;
    /**
     * Simulation frames to render before capturing, which is what actually
     * has to match: `warmupMs` describes how long native projectM ran, and
     * projectM renders that warmup as fast as it can rather than at 60fps.
     * Reproducing its frame — not its wall clock — is what makes a Stims
     * capture comparable, and it is the only figure that means the same
     * thing on a 1.7ms/frame WebGPU device and a 105ms/frame software
     * WebGL one.
     */
    warmupFrames: number;
  };
  provenance: {
    label: string;
    importedAt: string;
    sourceArtifactId?: string | null;
  };
};

/**
 * Calibrated against the checked-in projectM references, not derived: at 300
 * frames (5000ms at 60fps) captures land far short of the reference state —
 * 250-wavecode scored 88% mismatch there and 0.50% at 900 — so 900 is where
 * our render of the warmup reproduces projectM's.
 */
export const DEFAULT_WARMUP_FRAMES = 900;

export type VisualReferenceManifest = {
  version: 1;
  parityTarget: 'projectm-visual-reference';
  fixtureRoot: string;
  minimumPresetCount: number;
  presetCount: number;
  defaults: {
    renderer: 'projectm';
    requiredBackend: MilkdropRenderBackend;
    width: number;
    height: number;
    warmupMs: number;
    captureOffsetMs: number;
    warmupFrames: number;
    toleranceProfile: MilkdropParityToleranceProfile;
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
      requiredBackend: 'webgpu',
      width: 1280,
      height: 720,
      warmupMs: 5000,
      captureOffsetMs: 0,
      warmupFrames: DEFAULT_WARMUP_FRAMES,
      toleranceProfile: 'default',
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
    presets: Array.isArray(parsed.presets)
      ? parsed.presets.map((preset) => {
          const normalizedPreset = { ...preset };
          return {
            ...normalizedPreset,
            sourceFamily: normalizedPreset.sourceFamily ?? 'projectm-fixture',
            tolerance: {
              profile:
                normalizedPreset.tolerance?.profile ??
                parsed.defaults?.toleranceProfile ??
                'default',
              threshold:
                normalizedPreset.tolerance?.threshold ??
                parsed.defaults?.threshold ??
                16,
              failThreshold:
                normalizedPreset.tolerance?.failThreshold ??
                parsed.defaults?.failThreshold ??
                0.02,
            },
            capture: {
              renderer:
                normalizedPreset.capture?.renderer ??
                parsed.defaults?.renderer ??
                'projectm',
              requiredBackend:
                normalizedPreset.capture?.requiredBackend ??
                parsed.defaults?.requiredBackend ??
                'webgpu',
              width:
                normalizedPreset.capture?.width ??
                parsed.defaults?.width ??
                1280,
              height:
                normalizedPreset.capture?.height ??
                parsed.defaults?.height ??
                720,
              warmupMs:
                normalizedPreset.capture?.warmupMs ??
                parsed.defaults?.warmupMs ??
                5000,
              captureOffsetMs:
                normalizedPreset.capture?.captureOffsetMs ??
                parsed.defaults?.captureOffsetMs ??
                0,
              warmupFrames:
                normalizedPreset.capture?.warmupFrames ??
                parsed.defaults?.warmupFrames ??
                DEFAULT_WARMUP_FRAMES,
            },
            provenance: normalizedPreset.provenance ?? {
              label: 'checked-in Stims reference capture',
              importedAt: 'unknown',
              sourceArtifactId: null,
            },
          };
        })
      : [],
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
