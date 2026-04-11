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

export type MeasuredVisualResultsValidationIssue = {
  presetId: string;
  sourceReport: string | null;
  reason:
    | 'missing-source-report'
    | 'missing-source-report-file'
    | 'report-preset-mismatch'
    | 'report-status-mismatch'
    | 'report-backend-mismatch'
    | 'report-fidelity-mismatch';
  message: string;
};

export type MeasuredVisualResultsValidation = {
  ok: boolean;
  issues: MeasuredVisualResultsValidationIssue[];
  issueCount: number;
  missingSourceReportCount: number;
  mismatchedSourceReportCount: number;
};

function resolveSourceReportPath(
  repoRoot: string,
  sourceReport: string | null | undefined,
) {
  if (!sourceReport?.trim()) {
    return null;
  }
  return path.isAbsolute(sourceReport)
    ? sourceReport
    : path.join(repoRoot, sourceReport);
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

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

export function validateMeasuredVisualResultsManifest(
  repoRoot: string,
  manifest = loadMeasuredVisualResultsManifest(repoRoot),
): MeasuredVisualResultsValidation {
  const issues: MeasuredVisualResultsValidationIssue[] = [];
  const seenIds = new Set<string>();

  for (const preset of manifest.presets) {
    if (seenIds.has(preset.id)) {
      issues.push({
        presetId: preset.id,
        sourceReport: preset.sourceReport ?? null,
        reason: 'report-preset-mismatch',
        message: `Duplicate measured visual result id "${preset.id}".`,
      });
      continue;
    }
    seenIds.add(preset.id);

    const sourceReportPath = resolveSourceReportPath(
      repoRoot,
      preset.sourceReport,
    );
    if (!sourceReportPath) {
      issues.push({
        presetId: preset.id,
        sourceReport: null,
        reason: 'missing-source-report',
        message: `Measured visual result "${preset.id}" is missing its source report path.`,
      });
      continue;
    }

    if (!fs.existsSync(sourceReportPath)) {
      issues.push({
        presetId: preset.id,
        sourceReport: preset.sourceReport ?? null,
        reason: 'missing-source-report-file',
        message: `Measured visual result "${preset.id}" points to a missing source report: ${sourceReportPath}.`,
      });
      continue;
    }

    const report = JSON.parse(fs.readFileSync(sourceReportPath, 'utf8')) as {
      presetId?: string;
      title?: string;
      requiredBackend?: string;
      actualBackend?: string | null;
      sourceFamily?: string;
      strata?: string[];
      toleranceProfile?: string;
      mismatchRatio?: number;
      threshold?: number;
      failThreshold?: number;
      status?: string;
    };

    const reportIssues: string[] = [];
    if (report.presetId !== preset.id) {
      reportIssues.push(
        `preset id ${report.presetId ?? '(missing)'} does not match manifest id ${preset.id}`,
      );
    }
    if (report.title !== preset.title) {
      reportIssues.push(
        `title ${report.title ?? '(missing)'} does not match manifest title ${preset.title}`,
      );
    }
    if (report.requiredBackend !== preset.requiredBackend) {
      reportIssues.push(
        `required backend ${report.requiredBackend ?? '(missing)'} does not match manifest backend ${preset.requiredBackend}`,
      );
    }
    if (report.actualBackend !== preset.actualBackend) {
      reportIssues.push(
        `actual backend ${report.actualBackend ?? '(missing)'} does not match manifest backend ${preset.actualBackend ?? '(missing)'}`,
      );
    }
    if (report.sourceFamily !== preset.sourceFamily) {
      reportIssues.push(
        `source family ${report.sourceFamily ?? '(missing)'} does not match manifest source family ${preset.sourceFamily}`,
      );
    }
    if (!arraysEqual(report.strata ?? [], preset.strata ?? [])) {
      reportIssues.push(
        `strata ${JSON.stringify(report.strata ?? [])} does not match manifest strata ${JSON.stringify(preset.strata ?? [])}`,
      );
    }
    if (report.toleranceProfile !== preset.toleranceProfile) {
      reportIssues.push(
        `tolerance profile ${report.toleranceProfile ?? '(missing)'} does not match manifest profile ${preset.toleranceProfile}`,
      );
    }
    if (report.threshold !== preset.threshold) {
      reportIssues.push(
        `threshold ${report.threshold ?? '(missing)'} does not match manifest threshold ${preset.threshold}`,
      );
    }
    if (report.failThreshold !== preset.failThreshold) {
      reportIssues.push(
        `fail threshold ${report.failThreshold ?? '(missing)'} does not match manifest fail threshold ${preset.failThreshold}`,
      );
    }
    if (report.status !== preset.suiteStatus) {
      reportIssues.push(
        `status ${report.status ?? '(missing)'} does not match manifest suite status ${preset.suiteStatus}`,
      );
    }
    if (
      typeof report.mismatchRatio === 'number' &&
      report.mismatchRatio !== preset.mismatchRatio
    ) {
      reportIssues.push(
        `mismatch ratio ${report.mismatchRatio} does not match manifest mismatch ratio ${preset.mismatchRatio}`,
      );
    }

    if (reportIssues.length > 0) {
      issues.push({
        presetId: preset.id,
        sourceReport: preset.sourceReport ?? null,
        reason: 'report-fidelity-mismatch',
        message: [
          `Measured visual result "${preset.id}" source report does not match the checked-in manifest.`,
          ...reportIssues.map((issue) => `- ${issue}`),
        ].join('\n'),
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    issueCount: issues.length,
    missingSourceReportCount: issues.filter(
      (issue) =>
        issue.reason === 'missing-source-report' ||
        issue.reason === 'missing-source-report-file',
    ).length,
    mismatchedSourceReportCount: issues.filter(
      (issue) => issue.reason === 'report-fidelity-mismatch',
    ).length,
  };
}
