import fs from 'node:fs';
import path from 'node:path';
import {
  type CertificationCorpusEntry,
  type CertificationCorpusGroup,
  loadCertificationCorpusManifest,
} from './certification-corpus.ts';
import {
  type PlayToyOptions,
  type PlayToyPerformanceMetrics,
  type PlayToyResult,
  playToy,
} from './play-toy.ts';

const PERF_TARGET_FRAME_MS = 16.7;
const PERF_DURATION_MS = 4500;
const PERF_WARMUP_MS = 1000;
const PERF_REPORT_DIR = 'reports';
const PERF_SUMMARY_FILE = 'summary.json';
const CERTIFICATION_GROUP_ORDER: readonly CertificationCorpusGroup[] = [
  'bundled-shipped',
  'local-custom-shape',
  'parity-corpus',
  'projectm-upstream',
];

export type CertificationCorpusPerfSuiteOptions = {
  repoRoot: string;
  outputDir: string;
  port: number;
  headless: boolean;
  strict?: boolean;
  presetIds?: string[];
  corpusGroup?: CertificationCorpusGroup;
};

type CertificationCorpusPerfRequest = CertificationCorpusEntry & {
  playToy: Required<
    Pick<
      PlayToyOptions,
      | 'slug'
      | 'presetId'
      | 'port'
      | 'duration'
      | 'viewportWidth'
      | 'viewportHeight'
      | 'headless'
      | 'vibeMode'
      | 'rendererProfile'
      | 'catalogMode'
      | 'perfCapture'
    >
  >;
};

export type CertificationCorpusPerfReport = {
  version: 1;
  presetId: string;
  title: string;
  corpusGroup: CertificationCorpusGroup;
  strata: string[];
  sourceFamily: CertificationCorpusEntry['sourceFamily'];
  requiredBackend: CertificationCorpusEntry['requiredBackend'];
  actualBackend: 'webgl' | 'webgpu' | null;
  status: 'pass' | 'fail' | 'error';
  targetFrameMs: number;
  overBudgetMs: number | null;
  consoleErrors: string[] | null;
  error: string | null;
  fallbackOccurred: boolean;
  performance: PlayToyPerformanceMetrics | null;
  playToySuccess: boolean;
  reportPath: string;
};

export type CertificationCorpusPerfSummary = {
  version: 1;
  generatedAt: string;
  outputDir: string;
  reportDir: string;
  targetFrameMs: number;
  warmupMs: number;
  durationMs: number;
  presetCount: number;
  passCount: number;
  failCount: number;
  errorCount: number;
  outlierGroups: Record<string, number>;
  outlierStrata: Record<string, number>;
  reports: CertificationCorpusPerfReport[];
};

function sanitizeArtifactSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildPerfReportFileName(presetId: string) {
  return `${sanitizeArtifactSegment(presetId) || 'preset'}.json`;
}

function buildPerfReportPath(outputDir: string, presetId: string) {
  return path.join(
    outputDir,
    PERF_REPORT_DIR,
    buildPerfReportFileName(presetId),
  );
}

function loadPerfReports(reportDir: string) {
  if (!fs.existsSync(reportDir)) {
    return [] as CertificationCorpusPerfReport[];
  }

  return fs
    .readdirSync(reportDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map(
      (fileName) =>
        JSON.parse(
          fs.readFileSync(path.join(reportDir, fileName), 'utf8'),
        ) as CertificationCorpusPerfReport,
    );
}

function groupRank(group: CertificationCorpusGroup) {
  const index = CERTIFICATION_GROUP_ORDER.indexOf(group);
  return index === -1 ? CERTIFICATION_GROUP_ORDER.length : index;
}

function statusRank(status: CertificationCorpusPerfReport['status']) {
  switch (status) {
    case 'error':
      return 0;
    case 'fail':
      return 1;
    case 'pass':
      return 2;
  }
}

function comparePerfReports(
  left: CertificationCorpusPerfReport,
  right: CertificationCorpusPerfReport,
) {
  const statusDelta = statusRank(left.status) - statusRank(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const leftOverBudget = left.overBudgetMs ?? Number.NEGATIVE_INFINITY;
  const rightOverBudget = right.overBudgetMs ?? Number.NEGATIVE_INFINITY;
  if (left.status === 'fail' && right.status === 'fail') {
    const overBudgetDelta = rightOverBudget - leftOverBudget;
    if (overBudgetDelta !== 0) {
      return overBudgetDelta;
    }
  }

  const groupDelta = groupRank(left.corpusGroup) - groupRank(right.corpusGroup);
  if (groupDelta !== 0) {
    return groupDelta;
  }

  const strataDelta = left.strata
    .join('|')
    .localeCompare(right.strata.join('|'));
  if (strataDelta !== 0) {
    return strataDelta;
  }

  return left.presetId.localeCompare(right.presetId);
}

function parsePresetIds(argv: string[]) {
  return argv.flatMap((arg, index) =>
    arg === '--preset' && argv[index + 1] ? [argv[index + 1] ?? ''] : [],
  );
}

function countBy(values: Iterable<string>) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function selectCertificationCorpusEntries({
  repoRoot,
  presetIds,
  corpusGroup,
}: {
  repoRoot: string;
  presetIds?: string[];
  corpusGroup?: CertificationCorpusGroup;
}) {
  const manifest = loadCertificationCorpusManifest(repoRoot);
  const presetFilter = presetIds?.length ? new Set(presetIds) : null;

  return manifest.presets.filter((preset) => {
    if (corpusGroup && preset.corpusGroup !== corpusGroup) {
      return false;
    }
    if (presetFilter && !presetFilter.has(preset.id)) {
      return false;
    }
    return true;
  });
}

export function buildCertificationCorpusPerfRequests({
  repoRoot,
  outputDir,
  port,
  headless,
  presetIds,
  corpusGroup,
}: CertificationCorpusPerfSuiteOptions): CertificationCorpusPerfRequest[] {
  return selectCertificationCorpusEntries({
    repoRoot,
    presetIds,
    corpusGroup,
  }).map((preset) => ({
    ...preset,
    playToy: {
      slug: 'milkdrop',
      presetId: preset.id,
      port,
      duration: PERF_DURATION_MS,
      viewportWidth: 1280,
      viewportHeight: 720,
      headless,
      vibeMode: false,
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
      recordParityArtifact: false,
      outputDir,
      perfCapture: {
        warmupMs: PERF_WARMUP_MS,
      },
    },
  }));
}

function buildPerfReport({
  request,
  result,
  reportPath,
}: {
  request: CertificationCorpusPerfRequest;
  result: PlayToyResult;
  reportPath: string;
}): CertificationCorpusPerfReport {
  const performance = result.performance ?? null;
  const actualBackend = performance?.actualBackend ?? null;
  const fallbackOccurred =
    result.fallbackOccurred ?? performance?.fallbackOccurred ?? false;
  const perfStatus =
    result.success &&
    performance &&
    actualBackend === 'webgpu' &&
    !fallbackOccurred &&
    typeof performance.averageFrameMs === 'number' &&
    performance.averageFrameMs <= PERF_TARGET_FRAME_MS
      ? 'pass'
      : result.success &&
          performance &&
          actualBackend === 'webgpu' &&
          !fallbackOccurred &&
          typeof performance.averageFrameMs === 'number'
        ? 'fail'
        : 'error';

  const overBudgetMs =
    performance?.averageFrameMs !== null &&
    performance?.averageFrameMs !== undefined &&
    Number.isFinite(performance.averageFrameMs)
      ? performance.averageFrameMs - PERF_TARGET_FRAME_MS
      : null;

  return {
    version: 1,
    presetId: request.id,
    title: request.title,
    corpusGroup: request.corpusGroup,
    strata: request.strata,
    sourceFamily: request.sourceFamily,
    requiredBackend: request.requiredBackend,
    actualBackend,
    status: perfStatus,
    targetFrameMs: PERF_TARGET_FRAME_MS,
    overBudgetMs:
      perfStatus === 'pass' || perfStatus === 'fail' ? overBudgetMs : null,
    consoleErrors: result.consoleErrors ?? null,
    error: result.error ?? null,
    fallbackOccurred,
    performance,
    playToySuccess: result.success,
    reportPath,
  };
}

export function rankCertificationCorpusPerfReports(
  reports: readonly CertificationCorpusPerfReport[],
) {
  return [...reports].sort(comparePerfReports);
}

export async function runCertificationCorpusPerfSuite({
  repoRoot,
  outputDir,
  port,
  headless,
  strict = false,
  presetIds,
  corpusGroup,
}: CertificationCorpusPerfSuiteOptions) {
  const requests = buildCertificationCorpusPerfRequests({
    repoRoot,
    outputDir,
    port,
    headless,
    presetIds,
    corpusGroup,
  });

  if (requests.length === 0) {
    throw new Error(
      'No certification-corpus presets matched the requested filters.',
    );
  }

  const reportDir = path.join(outputDir, PERF_REPORT_DIR);
  fs.mkdirSync(reportDir, { recursive: true });

  for (const request of requests) {
    const result = await playToy(request.playToy);
    const reportPath = buildPerfReportPath(outputDir, request.id);
    const report = buildPerfReport({
      request,
      result,
      reportPath,
    });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  const rankedReports = rankCertificationCorpusPerfReports(
    loadPerfReports(reportDir),
  );
  const outliers = rankedReports.filter((report) => report.status !== 'pass');
  const summary: CertificationCorpusPerfSummary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    outputDir,
    reportDir,
    targetFrameMs: PERF_TARGET_FRAME_MS,
    warmupMs: PERF_WARMUP_MS,
    durationMs: PERF_DURATION_MS,
    presetCount: rankedReports.length,
    passCount: rankedReports.filter((report) => report.status === 'pass')
      .length,
    failCount: rankedReports.filter((report) => report.status === 'fail')
      .length,
    errorCount: rankedReports.filter((report) => report.status === 'error')
      .length,
    outlierGroups: countBy(outliers.map((report) => report.corpusGroup)),
    outlierStrata: countBy(outliers.flatMap((report) => report.strata)),
    reports: rankedReports,
  };

  const summaryPath = path.join(outputDir, PERF_SUMMARY_FILE);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  return {
    summary,
    summaryPath,
    reportDir,
    strictExitCode:
      strict && summary.failCount + summary.errorCount > 0 ? 1 : 0,
  };
}

function usage() {
  console.error(
    'Usage: bun scripts/run-certification-corpus-perf-suite.ts [--output <dir>] [--port <number>] [--group <group>] [--preset <id>]...',
  );
}

function parseArgs(argv: string[]): CertificationCorpusPerfSuiteOptions {
  const getStringArg = (name: string, fallback: string) => {
    const idx = argv.indexOf(name);
    if (idx !== -1 && idx + 1 < argv.length) {
      return argv[idx + 1] ?? fallback;
    }
    return fallback;
  };

  const getNumberArg = (name: string, fallback: number) => {
    const idx = argv.indexOf(name);
    if (idx !== -1 && idx + 1 < argv.length) {
      return parseInt(argv[idx + 1] ?? `${fallback}`, 10);
    }
    return fallback;
  };

  const groupArg = getStringArg('--group', '');
  const corpusGroup = groupArg.trim()
    ? (groupArg as CertificationCorpusGroup)
    : undefined;

  return {
    repoRoot: getStringArg('--repo-root', process.cwd()),
    outputDir: getStringArg('--output', './screenshots/certification-perf'),
    port: getNumberArg('--port', 5173),
    headless: !argv.includes('--no-headless'),
    strict: argv.includes('--strict'),
    presetIds: parsePresetIds(argv),
    corpusGroup,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    usage();
    process.exit(0);
  }

  const options = parseArgs(args);
  const result = await runCertificationCorpusPerfSuite(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.strictExitCode) {
    process.exitCode = result.strictExitCode;
  }
}
