import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';
import {
  type CertificationCorpusEntry,
  type CertificationCorpusGroup,
  loadCertificationCorpusManifest,
} from './certification-corpus.ts';
import { ensureDevServer } from './dev-server.ts';
import {
  closePlayToyBrowserSession,
  createPlayToyBrowserSession,
  type PlayToyOptions,
  type PlayToyPerformanceMetrics,
  type PlayToyRendererProfile,
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
  /** CDP CPU throttle multiplier; 1 (default) profiles at full host speed. */
  cpuThrottleRate?: number;
  /** Pins adaptive quality so frame-time deltas are attributable to code. */
  lockedQualityStep?: number | null;
  /**
   * Warmup before sampling starts. The 1s default is too short once the CPU is
   * throttled: preset compilation still lands inside the sample window and
   * skews cadence.
   */
  warmupMs?: number;
  /** Sampling duration. Must exceed `warmupMs` or no samples are collected. */
  durationMs?: number;
  /** Renderer profile to certify. Low-resource runs use `compatibility`. */
  rendererProfile?: PlayToyRendererProfile;
  /** Viewport override; low-resource runs use a smaller stage. */
  viewportWidth?: number;
  viewportHeight?: number;
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
      | 'cpuThrottleRate'
      | 'lockedQualityStep'
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
  cpuThrottleRate: number;
  rendererProfile: PlayToyRendererProfile;
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
  cpuThrottleRate = 1,
  lockedQualityStep = null,
  warmupMs,
  durationMs,
  rendererProfile = 'webgpu',
  viewportWidth = DEFAULT_VIEWPORT.width,
  viewportHeight = DEFAULT_VIEWPORT.height,
}: CertificationCorpusPerfSuiteOptions): CertificationCorpusPerfRequest[] {
  const resolvedWarmupMs = warmupMs ?? PERF_WARMUP_MS;
  const resolvedDurationMs = durationMs ?? PERF_DURATION_MS;
  // A warmup that swallows the whole capture yields zero samples, and playToy
  // then silently falls back to debug-snapshot metrics whose cadence comes from
  // the adaptive controller rather than presented frames. That fallback reads
  // as a normal result, so refuse the configuration instead of reporting it.
  if (resolvedWarmupMs >= resolvedDurationMs) {
    throw new Error(
      `Perf warmup (${resolvedWarmupMs}ms) must be shorter than the capture duration (${resolvedDurationMs}ms); otherwise no frames are sampled.`,
    );
  }

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
      duration: resolvedDurationMs,
      viewportWidth,
      viewportHeight,
      headless,
      vibeMode: false,
      rendererProfile,
      cpuThrottleRate,
      lockedQualityStep,
      catalogMode: 'certification',
      recordParityArtifact: false,
      outputDir,
      perfCapture: {
        warmupMs: resolvedWarmupMs,
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
  // A compatibility (SwiftShader) run legitimately certifies on WebGL, so the
  // expected backend follows the requested renderer profile rather than always
  // demanding WebGPU.
  const expectedBackend =
    request.playToy.rendererProfile === 'webgpu' ? 'webgpu' : 'webgl';
  const measured =
    result.success &&
    performance &&
    actualBackend === expectedBackend &&
    !fallbackOccurred &&
    typeof performance.averageFrameMs === 'number';
  const perfStatus = measured
    ? (performance.averageFrameMs as number) <= PERF_TARGET_FRAME_MS
      ? 'pass'
      : 'fail'
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
    cpuThrottleRate: request.playToy.cpuThrottleRate,
    rendererProfile: request.playToy.rendererProfile,
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
  cpuThrottleRate = 1,
  lockedQualityStep = null,
  warmupMs,
  durationMs,
  rendererProfile = 'webgpu',
  viewportWidth,
  viewportHeight,
}: CertificationCorpusPerfSuiteOptions) {
  const requests = buildCertificationCorpusPerfRequests({
    repoRoot,
    outputDir,
    port,
    headless,
    presetIds,
    corpusGroup,
    cpuThrottleRate,
    lockedQualityStep,
    warmupMs,
    durationMs,
    rendererProfile,
    viewportWidth,
    viewportHeight,
  });

  if (requests.length === 0) {
    throw new Error(
      'No certification-corpus presets matched the requested filters.',
    );
  }

  const devServer = await ensureDevServer(port, repoRoot);
  const reportDir = path.join(outputDir, PERF_REPORT_DIR);
  fs.mkdirSync(reportDir, { recursive: true });
  const browserSession = await createPlayToyBrowserSession({
    headless,
    rendererProfile,
  });

  try {
    for (const request of requests) {
      const result = await playToy({
        ...request.playToy,
        browserSession,
      });
      const reportPath = buildPerfReportPath(outputDir, request.id);
      const report = buildPerfReport({
        request,
        result,
        reportPath,
      });
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await closePlayToyBrowserSession(browserSession);
    devServer.close();
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
    'Usage: bun scripts/run-certification-corpus-perf-suite.ts [--output <dir>] [--port <number>] [--group <group>] [--preset <id>]... [--cpu-throttle <rate>] [--renderer compatibility|webgpu] [--viewport-width <px>] [--viewport-height <px>]',
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
    cpuThrottleRate: getNumberArg('--cpu-throttle', 1),
    warmupMs: getNumberArg('--warmup', PERF_WARMUP_MS),
    durationMs: getNumberArg('--duration', PERF_DURATION_MS),
    lockedQualityStep: argv.includes('--lock-quality-step')
      ? getNumberArg('--lock-quality-step', 0)
      : null,
    rendererProfile:
      getStringArg('--renderer', 'webgpu') === 'compatibility'
        ? 'compatibility'
        : 'webgpu',
    viewportWidth: getNumberArg('--viewport-width', DEFAULT_VIEWPORT.width),
    viewportHeight: getNumberArg('--viewport-height', DEFAULT_VIEWPORT.height),
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
