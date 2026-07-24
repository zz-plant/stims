import fs from 'node:fs';
import path from 'node:path';
import type {
  MilkdropFidelityClass,
  MilkdropParitySourceFamily,
  MilkdropParityToleranceProfile,
  MilkdropRenderBackend,
} from '../src/js/milkdrop/common-types.ts';
import {
  type MeasuredVisualPresetResult,
  upsertMeasuredVisualPresetResult,
} from './measured-visual-results.ts';
import { loadValidatedNativeProjectMReference } from './native-projectm-reference.ts';
import type { SuiteReferenceIdentity } from './run-parity-diff-suite.ts';
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

type PromoteParitySuiteResultOptions = {
  repoRoot: string;
  outputDir: string;
  presetId: string;
};

type SuitePresetReport = {
  presetId: string;
  title: string;
  requiredBackend: MilkdropRenderBackend;
  actualBackend: MilkdropRenderBackend | null;
  sourceFamily: MilkdropParitySourceFamily;
  strata: string[];
  toleranceProfile: MilkdropParityToleranceProfile;
  threshold: number;
  failThreshold: number;
  projectmReference?: SuiteReferenceIdentity;
  metrics: {
    mismatchRatio: number | null;
  };
  status: 'pass' | 'fail' | 'backend-mismatch';
  error?: string;
};

function usage() {
  console.error(
    'Usage: bun scripts/promote-parity-suite-result.ts --preset <id> [--output <dir>]',
  );
}

function parseArgs(argv: string[]): PromoteParitySuiteResultOptions | null {
  const getArg = (name: string, fallback?: string) => {
    const index = argv.indexOf(name);
    if (index === -1 || index + 1 >= argv.length) {
      return fallback;
    }
    return argv[index + 1];
  };

  const presetId = getArg('--preset');
  if (!presetId) {
    return null;
  }

  return {
    repoRoot: process.cwd(),
    outputDir:
      getArg('--output', './screenshots/parity') ?? './screenshots/parity',
    presetId,
  };
}

function loadSuitePresetReport({
  outputDir,
  presetId,
}: {
  outputDir: string;
  presetId: string;
}) {
  const reportPath = path.join(outputDir, 'suite', `${presetId}.json`);
  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `Suite report not found for preset "${presetId}" at ${reportPath}.`,
    );
  }

  return {
    reportPath,
    report: JSON.parse(
      fs.readFileSync(reportPath, 'utf8'),
    ) as SuitePresetReport,
  };
}

export function fidelityClassFromSuiteReport(
  report: SuitePresetReport,
): MilkdropFidelityClass {
  if (report.status !== 'pass' || report.metrics.mismatchRatio === null) {
    return 'fallback';
  }
  if (report.metrics.mismatchRatio === 0) {
    return 'exact';
  }
  return 'near-exact';
}

export function measuredResultFromSuiteReport({
  report,
  reportPath,
}: {
  report: SuitePresetReport;
  reportPath: string;
}): MeasuredVisualPresetResult {
  return {
    id: report.presetId,
    title: report.title,
    fidelityClass: fidelityClassFromSuiteReport(report),
    visualEvidenceTier: 'visual',
    suiteStatus: report.status,
    certificationStatus:
      report.status === 'pass' &&
      report.actualBackend === report.requiredBackend
        ? 'certified'
        : 'uncertified',
    certificationReason:
      report.status === 'pass' &&
      report.actualBackend === report.requiredBackend
        ? null
        : (report.error ??
          'Measured visual parity did not pass the WebGPU certification gate.'),
    requiredBackend: report.requiredBackend,
    actualBackend: report.actualBackend,
    sourceFamily: report.sourceFamily,
    strata: report.strata,
    toleranceProfile: report.toleranceProfile,
    mismatchRatio: report.metrics.mismatchRatio ?? 1,
    threshold: report.threshold,
    failThreshold: report.failThreshold,
    updatedAt: new Date().toISOString(),
    sourceReport: reportPath,
  };
}

export function promoteParitySuiteResult(
  options: PromoteParitySuiteResultOptions,
) {
  const { report, reportPath } = loadSuitePresetReport(options);
  const referenceEntry = loadVisualReferenceManifest(
    options.repoRoot,
  ).presets.find(
    (preset) =>
      preset.id === options.presetId && preset.capture.renderer === 'projectm',
  );
  if (!referenceEntry) {
    throw new Error(
      `Preset "${options.presetId}" does not have a projectM reference and cannot be promoted as measured parity evidence.`,
    );
  }
  if (report.presetId !== options.presetId) {
    throw new Error(
      `Suite report preset id "${report.presetId}" does not match requested preset "${options.presetId}".`,
    );
  }
  const referenceManifest = loadVisualReferenceManifest(options.repoRoot);
  const currentReference = loadValidatedNativeProjectMReference({
    repoRoot: options.repoRoot,
    fixtureRoot: referenceManifest.fixtureRoot,
    entry: referenceEntry,
  });
  const expectedReference: SuiteReferenceIdentity = {
    imagePath: currentReference.imagePath,
    imageSha256: currentReference.imageSha256,
    metadataPath: currentReference.metadataPath,
    metadataSha256: currentReference.metadataSha256,
  };
  const reportReference = report.projectmReference;
  if (
    !reportReference ||
    Object.entries(expectedReference).some(
      ([key, value]) =>
        reportReference[key as keyof SuiteReferenceIdentity] !== value,
    )
  ) {
    throw new Error(
      `Suite report for preset "${options.presetId}" does not match the current native projectM reference identity. Re-run the parity diff suite before promotion.`,
    );
  }
  const manifestMismatch =
    report.title !== referenceEntry.title ||
    report.requiredBackend !== referenceEntry.capture.requiredBackend ||
    report.sourceFamily !== referenceEntry.sourceFamily ||
    JSON.stringify(report.strata) !== JSON.stringify(referenceEntry.strata) ||
    report.toleranceProfile !== referenceEntry.tolerance.profile ||
    report.threshold !== referenceEntry.tolerance.threshold ||
    report.failThreshold !== referenceEntry.tolerance.failThreshold;
  if (manifestMismatch) {
    throw new Error(
      `Suite report for preset "${options.presetId}" does not match the current reference backend, tolerance, or catalog metadata. Re-run the parity diff suite before promotion.`,
    );
  }
  if (
    report.status === 'pass' &&
    report.actualBackend !== referenceEntry.capture.requiredBackend
  ) {
    throw new Error(
      `Passing suite report for preset "${options.presetId}" used the wrong backend.`,
    );
  }
  const entry = measuredResultFromSuiteReport({ report, reportPath });
  const manifestWrite = upsertMeasuredVisualPresetResult(
    options.repoRoot,
    entry,
  );
  return {
    entry,
    manifestPath: manifestWrite.manifestPath,
  };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    usage();
    process.exit(1);
  }

  try {
    const result = promoteParitySuiteResult(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Promotion failed for preset "${options.presetId}": ${rawMessage}\n` +
        `Ensure parity suite reports exist at "${options.outputDir}/suite/". ` +
        `If missing, first run: bun run scripts/run-parity-diff-suite.ts --preset "${options.presetId}"`,
    );
    process.exit(1);
  }
}
