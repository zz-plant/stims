/**
 * Measures per-preset frame times across the certification corpus against a
 * 16.7ms budget.
 *
 * Perf arm of the certification pipeline: drives each corpus preset through a
 * shared play-toy browser session with perf capture on, then writes a report
 * per preset plus a summary recording frame-time stats, the over-budget delta,
 * the backend actually used, renderer fallbacks and console errors.
 *
 *   bun run perf:certification-corpus -- [--group <group>] [--preset <id>]...
 *
 * `--cpu-throttle <rate>` applies CDP CPU throttling (perf:low-resource is this
 * script at 4x throttle, compatibility renderer and a 1280x720 stage),
 * `--lock-quality-step` pins adaptive quality so deltas are attributable to
 * code, and `--warmup`/`--duration` size the sampling window. `--strict` exits
 * non-zero when any preset misses the budget or errors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';
import {
  type CertificationCorpusEntry,
  type CertificationCorpusGroup,
  loadCertificationCorpusManifest,
} from './certification-corpus.ts';
import {
  ensurePerformanceServer,
  type PerformanceServerMode,
} from './dev-server.ts';
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
const PERF_REPETITIONS = 3;
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
  /** Independent browser runs per preset; median metrics are reported. */
  repetitions?: number;
  /** Production builds are the evidence default; development is for iteration. */
  serverMode?: PerformanceServerMode;
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
  trialCount?: number;
  successfulTrialCount?: number;
  aggregateMetrics?: CertificationPerfAggregateMetrics | null;
  trials?: CertificationPerfTrial[];
};

export type CertificationPerfAggregateMetrics = {
  medianAverageFrameMs: number;
  minAverageFrameMs: number;
  maxAverageFrameMs: number;
  medianFps: number | null;
};

export type CertificationPerfTrial = {
  index: number;
  success: boolean;
  actualBackend: 'webgl' | 'webgpu' | null;
  fallbackOccurred: boolean;
  error: string | null;
  consoleErrors: string[] | null;
  performance: PlayToyPerformanceMetrics | null;
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
  repetitions: number;
  serverMode: PerformanceServerMode;
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

export function resolveCertificationCorpusPerfWindow({
  warmupMs,
  durationMs,
}: Pick<CertificationCorpusPerfSuiteOptions, 'warmupMs' | 'durationMs'>) {
  return {
    warmupMs: warmupMs ?? PERF_WARMUP_MS,
    durationMs: durationMs ?? PERF_DURATION_MS,
  };
}

export function resolvePerfExecutionDefaults({
  repetitions,
  serverMode,
  port,
}: {
  repetitions?: number;
  serverMode?: PerformanceServerMode;
  port?: number;
}) {
  const resolvedServerMode = serverMode ?? 'production';
  return {
    repetitions: Math.max(
      1,
      Math.round(
        typeof repetitions === 'number' && Number.isFinite(repetitions)
          ? repetitions
          : PERF_REPETITIONS,
      ),
    ),
    serverMode: resolvedServerMode,
    port: port ?? (resolvedServerMode === 'production' ? 4173 : 5173),
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined
    ? null
    : (lower + upper) / 2;
}

function isFatalPerformanceRuntimeError(message: string) {
  return (
    message.startsWith('PageError:') ||
    /\bGPUValidationError\b/iu.test(message) ||
    /\bWebGPU\b.*\b(?:uncaptured error|device lost|out of memory)\b/iu.test(
      message,
    ) ||
    /\bGPUDevice\b.*\blost\b/iu.test(message)
  );
}

function isMeasuredTrial(
  result: PlayToyResult,
  expectedBackend: 'webgl' | 'webgpu',
) {
  const performance = result.performance;
  return Boolean(
    result.success &&
      performance &&
      performance.metricsSource === 'sampler' &&
      performance.actualBackend === expectedBackend &&
      !performance.fallbackOccurred &&
      !(result.consoleErrors ?? []).some(isFatalPerformanceRuntimeError) &&
      typeof performance.averageFrameMs === 'number' &&
      Number.isFinite(performance.averageFrameMs),
  );
}

export function aggregateCertificationPerfTrials(
  results: readonly PlayToyResult[],
  expectedBackend: 'webgl' | 'webgpu',
) {
  const measuredResults = results.filter((result) =>
    isMeasuredTrial(result, expectedBackend),
  );
  const orderedResults = [...measuredResults].sort(
    (left, right) =>
      (left.performance?.averageFrameMs ?? Number.POSITIVE_INFINITY) -
      (right.performance?.averageFrameMs ?? Number.POSITIVE_INFINITY),
  );
  const representativeResult =
    orderedResults[Math.floor(orderedResults.length / 2)] ?? null;
  const frameTimes = measuredResults.flatMap((result) =>
    typeof result.performance?.averageFrameMs === 'number'
      ? [result.performance.averageFrameMs]
      : [],
  );
  const fpsValues = measuredResults.flatMap((result) =>
    typeof result.performance?.medianFps === 'number'
      ? [result.performance.medianFps]
      : [],
  );
  const medianAverageFrameMs = median(frameTimes);
  const complete =
    measuredResults.length === results.length && results.length > 0;
  const status: CertificationCorpusPerfReport['status'] = !complete
    ? 'error'
    : (medianAverageFrameMs ?? Number.POSITIVE_INFINITY) <= PERF_TARGET_FRAME_MS
      ? 'pass'
      : 'fail';

  return {
    status,
    successfulTrialCount: measuredResults.length,
    representativePerformance: representativeResult?.performance ?? null,
    metrics:
      medianAverageFrameMs === null
        ? null
        : {
            medianAverageFrameMs,
            minAverageFrameMs: Math.min(...frameTimes),
            maxAverageFrameMs: Math.max(...frameTimes),
            medianFps: median(fpsValues),
          },
  };
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
  const { warmupMs: resolvedWarmupMs, durationMs: resolvedDurationMs } =
    resolveCertificationCorpusPerfWindow({ warmupMs, durationMs });
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
  results,
  reportPath,
}: {
  request: CertificationCorpusPerfRequest;
  results: PlayToyResult[];
  reportPath: string;
}): CertificationCorpusPerfReport {
  const expectedBackend =
    request.playToy.rendererProfile === 'webgpu' ? 'webgpu' : 'webgl';
  const aggregate = aggregateCertificationPerfTrials(results, expectedBackend);
  const performance = aggregate.representativePerformance;
  const actualBackend = performance?.actualBackend ?? null;
  const fallbackOccurred = results.some(
    (result) =>
      result.fallbackOccurred ?? result.performance?.fallbackOccurred ?? false,
  );
  const perfStatus = aggregate.status;

  const overBudgetMs =
    aggregate.metrics?.medianAverageFrameMs !== undefined
      ? aggregate.metrics.medianAverageFrameMs - PERF_TARGET_FRAME_MS
      : null;
  const consoleErrors = results.flatMap((result) => result.consoleErrors ?? []);
  const resultErrors = results.flatMap((result) =>
    result.error ? [result.error] : [],
  );
  const fatalRuntimeErrors = consoleErrors
    .filter(isFatalPerformanceRuntimeError)
    .map((error) => `Browser runtime error: ${error}`);
  const errors = [...resultErrors, ...fatalRuntimeErrors];

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
    consoleErrors:
      consoleErrors.length > 0 ? [...new Set(consoleErrors)] : null,
    error: errors.length > 0 ? [...new Set(errors)].join('; ') : null,
    fallbackOccurred,
    performance,
    playToySuccess: results.every((result) => result.success),
    reportPath,
    trialCount: results.length,
    successfulTrialCount: aggregate.successfulTrialCount,
    aggregateMetrics: aggregate.metrics,
    trials: results.map((result, index) => ({
      index: index + 1,
      success: result.success,
      actualBackend: result.performance?.actualBackend ?? null,
      fallbackOccurred:
        result.fallbackOccurred ??
        result.performance?.fallbackOccurred ??
        false,
      error: result.error ?? null,
      consoleErrors: result.consoleErrors ?? null,
      performance: result.performance ?? null,
    })),
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
  repetitions,
  serverMode,
}: CertificationCorpusPerfSuiteOptions) {
  const execution = resolvePerfExecutionDefaults({
    repetitions,
    serverMode,
    port,
  });
  const evidenceWindow = resolveCertificationCorpusPerfWindow({
    warmupMs,
    durationMs,
  });
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

  const performanceServer = await ensurePerformanceServer({
    mode: execution.serverMode,
    port: execution.port,
    repoRoot,
  });
  const reportDir = path.join(outputDir, PERF_REPORT_DIR);
  fs.mkdirSync(reportDir, { recursive: true });
  const browserSession = await createPlayToyBrowserSession({
    headless,
    rendererProfile,
  });

  const resultsByPreset = new Map<string, PlayToyResult[]>();
  const currentReports: CertificationCorpusPerfReport[] = [];
  try {
    for (
      let trialIndex = 0;
      trialIndex < execution.repetitions;
      trialIndex += 1
    ) {
      // Alternate order so presets at the end of a large corpus are not always
      // measured at the same point in the host's thermal trajectory.
      const trialRequests =
        trialIndex % 2 === 0 ? requests : [...requests].reverse();
      for (const request of trialRequests) {
        const result = await playToy({
          ...request.playToy,
          port: execution.port,
          browserSession,
        });
        const presetResults = resultsByPreset.get(request.id) ?? [];
        presetResults.push(result);
        resultsByPreset.set(request.id, presetResults);
      }
    }

    for (const request of requests) {
      const reportPath = buildPerfReportPath(outputDir, request.id);
      const report = buildPerfReport({
        request,
        results: resultsByPreset.get(request.id) ?? [],
        reportPath,
      });
      currentReports.push(report);
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await closePlayToyBrowserSession(browserSession);
    performanceServer.close();
  }

  const rankedReports = rankCertificationCorpusPerfReports(currentReports);
  const outliers = rankedReports.filter((report) => report.status !== 'pass');
  const summary: CertificationCorpusPerfSummary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    outputDir,
    reportDir,
    targetFrameMs: PERF_TARGET_FRAME_MS,
    warmupMs: evidenceWindow.warmupMs,
    durationMs: evidenceWindow.durationMs,
    repetitions: execution.repetitions,
    serverMode: execution.serverMode,
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
    'Usage: bun scripts/run-certification-corpus-perf-suite.ts [--output <dir>] [--port <number>] [--server production|development] [--repetitions <count>] [--group <group>] [--preset <id>]... [--cpu-throttle <rate>] [--renderer compatibility|webgpu] [--viewport-width <px>] [--viewport-height <px>]',
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

  const serverMode =
    getStringArg('--server', 'production') === 'development'
      ? 'development'
      : 'production';
  const execution = resolvePerfExecutionDefaults({
    repetitions: getNumberArg('--repetitions', PERF_REPETITIONS),
    serverMode,
    port: argv.includes('--port')
      ? getNumberArg('--port', serverMode === 'production' ? 4173 : 5173)
      : undefined,
  });

  return {
    repoRoot: getStringArg('--repo-root', process.cwd()),
    outputDir: getStringArg('--output', './screenshots/certification-perf'),
    port: execution.port,
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
    repetitions: execution.repetitions,
    serverMode: execution.serverMode,
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
