import fs from 'node:fs';
import path from 'node:path';
import type {
  MilkdropFidelityClass,
  MilkdropParitySourceFamily,
  MilkdropParityToleranceProfile,
  MilkdropRenderBackend,
  MilkdropVisualEvidenceTier,
} from '../assets/js/milkdrop/common-types.ts';

export const MEASURED_VISUAL_RESULTS_PATH =
  'assets/data/milkdrop-parity/measured-results.json';

export type MeasuredVisualPresetResult = {
  id: string;
  title: string;
  fidelityClass: MilkdropFidelityClass;
  visualEvidenceTier: Extract<MilkdropVisualEvidenceTier, 'visual'>;
  suiteStatus: 'pass' | 'fail' | 'backend-mismatch';
  certificationStatus: 'certified' | 'uncertified';
  certificationReason: string | null;
  requiredBackend: MilkdropRenderBackend;
  actualBackend: MilkdropRenderBackend | null;
  sourceFamily: MilkdropParitySourceFamily;
  strata: string[];
  toleranceProfile: MilkdropParityToleranceProfile;
  mismatchRatio: number;
  threshold: number;
  failThreshold: number;
  updatedAt: string;
  sourceReport?: string | null;
};

export type MeasuredVisualResultsManifest = {
  version: 1;
  updatedAt: string | null;
  presets: MeasuredVisualPresetResult[];
};

export function createDefaultMeasuredVisualResultsManifest(): MeasuredVisualResultsManifest {
  return {
    version: 1,
    updatedAt: null,
    presets: [],
  };
}

export function loadMeasuredVisualResultsManifest(
  repoRoot: string,
): MeasuredVisualResultsManifest {
  const manifestPath = path.join(repoRoot, MEASURED_VISUAL_RESULTS_PATH);
  if (!fs.existsSync(manifestPath)) {
    return createDefaultMeasuredVisualResultsManifest();
  }

  const parsed = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8'),
  ) as Partial<MeasuredVisualResultsManifest>;
  return {
    ...createDefaultMeasuredVisualResultsManifest(),
    ...parsed,
    presets: Array.isArray(parsed.presets)
      ? parsed.presets.map((preset) => {
          const normalizedPreset = { ...preset };
          return {
            ...normalizedPreset,
            certificationStatus:
              normalizedPreset.certificationStatus ??
              (normalizedPreset.suiteStatus === 'pass'
                ? 'certified'
                : 'uncertified'),
            certificationReason:
              normalizedPreset.certificationReason ??
              (normalizedPreset.suiteStatus === 'pass'
                ? null
                : 'Measured visual parity did not pass the certification gate.'),
            requiredBackend: normalizedPreset.requiredBackend ?? 'webgpu',
            actualBackend: normalizedPreset.actualBackend ?? null,
            sourceFamily: normalizedPreset.sourceFamily ?? 'ad-hoc',
            strata: Array.isArray(normalizedPreset.strata)
              ? normalizedPreset.strata
              : [],
            toleranceProfile: normalizedPreset.toleranceProfile ?? 'default',
          };
        })
      : [],
  };
}

export function saveMeasuredVisualResultsManifest(
  repoRoot: string,
  manifest: MeasuredVisualResultsManifest,
) {
  const manifestPath = path.join(repoRoot, MEASURED_VISUAL_RESULTS_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const normalized: MeasuredVisualResultsManifest = {
    ...manifest,
    updatedAt: manifest.updatedAt ?? new Date().toISOString(),
    presets: [...manifest.presets].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return manifestPath;
}

export function upsertMeasuredVisualPresetResult(
  repoRoot: string,
  entry: MeasuredVisualPresetResult,
) {
  const manifest = loadMeasuredVisualResultsManifest(repoRoot);
  const presets = manifest.presets.filter((preset) => preset.id !== entry.id);
  presets.push(entry);
  const nextManifest: MeasuredVisualResultsManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    presets,
  };
  const manifestPath = saveMeasuredVisualResultsManifest(
    repoRoot,
    nextManifest,
  );
  return {
    manifestPath,
    manifest: nextManifest,
  };
}
