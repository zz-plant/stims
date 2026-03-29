import fs from 'node:fs';
import path from 'node:path';
import type { MilkdropFidelityClass } from '../assets/js/milkdrop/common-types.ts';
import {
  type MeasuredVisualPresetResult,
  upsertMeasuredVisualPresetResult,
} from './measured-visual-results.ts';

type PromoteParitySuiteResultOptions = {
  repoRoot: string;
  outputDir: string;
  presetId: string;
};

type SuitePresetReport = {
  presetId: string;
  title: string;
  threshold: number;
  failThreshold: number;
  metrics: {
    mismatchRatio: number;
  };
  status: 'pass' | 'fail';
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
  if (report.status === 'fail') {
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
    mismatchRatio: report.metrics.mismatchRatio,
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
