import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_DIR = path.resolve('tests');
const TEST_FILE_PATTERN = /\.test\.(?:ts|js)$/;
const INTEGRATION_TEST = 'tests/agent-integration.test.ts';

/**
 * Slow tests excluded from the `fast` profile.
 *
 * These are either corpus/certification runs (long I/O), visual-diff captures
 * (require a built dist), or the Playwright-backed agent integration harness.
 * They are still included in the `all` and `unit` profiles.
 */
const SLOW_TESTS = new Set([
  'tests/agent-integration.test.ts',
  'tests/capture-certification-corpus.test.ts',
  'tests/capture-visual-reference-suite.test.ts',
  'tests/certification-corpus.test.ts',
  'tests/certification-corpus-perf-suite.test.ts',
  'tests/certification-corpus-runtime.test.ts',
  'tests/milkdrop-corpus-compat.test.ts',
  'tests/milkdrop-parity.test.ts',
  'tests/milkdrop-projectm-compat.test.ts',
  'tests/run-certification-corpus-perf-suite.test.ts',
  'tests/run-parity-diff-suite.test.ts',
]);

const LEGACY_FRONTEND_TESTS = [
  'tests/flow-timer.test.ts',
  'tests/haptics-controller.test.ts',
  'tests/init-milkdrop-showcase.test.ts',
  'tests/init-quickstart.test.ts',
  'tests/library-dom-cache.test.ts',
  'tests/library-filter-state.test.ts',
  'tests/library-view-render-list.test.ts',
  'tests/library-view-state-controller.test.ts',
  'tests/loader.test.js',
  'tests/router.test.js',
  'tests/session-tracking.test.ts',
  'tests/toy-audio-prompt-controller.test.ts',
  'tests/toy-launch.test.ts',
  'tests/toy-module-loader.test.ts',
  'tests/toy-page-bootstrap.test.ts',
  'tests/toy-view.test.js',
];

const PROFILE_FILE_LISTS: Record<string, string[]> = {
  integration: [INTEGRATION_TEST],
  'legacy-frontend': LEGACY_FRONTEND_TESTS,
  compat: [
    'tests/milkdrop-corpus-compat.test.ts',
    'tests/milkdrop-parity.test.ts',
    'tests/milkdrop-projectm-compat.test.ts',
    'tests/milkdrop-webgpu-optimization-flags.test.ts',
    'tests/milkdrop-webgpu-rollout.test.ts',
    'tests/render-preferences.test.ts',
    'tests/postprocessing.test.ts',
    'tests/party-mode.test.ts',
  ],
  'compat-full': [
    'tests/milkdrop-corpus-compat.test.ts',
    'tests/milkdrop-parity.test.ts',
    'tests/milkdrop-projectm-compat.test.ts',
    'tests/milkdrop-webgpu-optimization-flags.test.ts',
    'tests/milkdrop-webgpu-rollout.test.ts',
    'tests/render-preferences.test.ts',
    'tests/postprocessing.test.ts',
    'tests/party-mode.test.ts',
    ...LEGACY_FRONTEND_TESTS,
  ],
};

async function listTestFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listTestFiles(absolutePath);
      }

      if (!TEST_FILE_PATTERN.test(entry.name)) {
        return [];
      }

      return [path.relative(process.cwd(), absolutePath).replace(/\\/g, '/')];
    }),
  );

  return files.flat().sort((a, b) => a.localeCompare(b));
}

type ParsedArgs = {
  profile: string;
  watch: boolean;
  explicitFiles: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  let profile = 'all';
  let watch = false;
  const explicitFiles: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;

    if (arg === '--watch') {
      watch = true;
      continue;
    }

    if (arg === '--profile') {
      profile = argv[index + 1] ?? profile;
      index += 1;
      continue;
    }

    explicitFiles.push(arg);
  }

  return { profile, watch, explicitFiles };
}

async function resolveProfileFiles(profile: string): Promise<string[]> {
  if (profile === 'all') {
    return listTestFiles(TEST_DIR);
  }

  if (profile === 'unit') {
    const allTests = await listTestFiles(TEST_DIR);
    return allTests.filter((file) => file !== INTEGRATION_TEST);
  }

  if (profile === 'fast') {
    // All tests except slow corpus/certification/integration runs.
    // This is the profile used by `bun run check` so it completes in ~30s.
    const allTests = await listTestFiles(TEST_DIR);
    return allTests.filter((file) => !SLOW_TESTS.has(file));
  }

  const files = PROFILE_FILE_LISTS[profile];
  if (files) {
    return files;
  }

  throw new Error(
    `Unknown test profile "${profile}". Expected one of: all, unit, fast, integration, legacy-frontend, compat, compat-full.`,
  );
}

async function runBunTest({
  files,
  watch,
  maxConcurrency,
}: {
  files: string[];
  watch: boolean;
  maxConcurrency?: number;
}) {
  const cmd = [
    'bun',
    'test',
    '--preload=./tests/setup.ts',
    '--importmap=./tests/importmap.json',
    ...(watch ? ['--watch'] : []),
    ...(typeof maxConcurrency === 'number'
      ? [`--max-concurrency=${maxConcurrency}`]
      : []),
    ...files,
  ];

  const proc = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  return proc.exited;
}

async function main() {
  const { profile, watch, explicitFiles } = parseArgs(process.argv.slice(2));
  const files = explicitFiles.length
    ? explicitFiles
    : await resolveProfileFiles(profile);
  const includesIntegration = files.includes(INTEGRATION_TEST);

  if (!watch && includesIntegration && files.length > 1) {
    const unitFiles = files.filter((file) => file !== INTEGRATION_TEST);
    if (unitFiles.length > 0) {
      const unitExitCode = await runBunTest({ files: unitFiles, watch });
      if (unitExitCode !== 0) {
        process.exit(unitExitCode);
      }
    }

    const integrationExitCode = await runBunTest({
      files: [INTEGRATION_TEST],
      watch,
      maxConcurrency: 1,
    });
    process.exit(integrationExitCode);
  }

  const exitCode = await runBunTest({
    files,
    watch,
    maxConcurrency: includesIntegration ? 1 : undefined,
  });
  process.exit(exitCode);
}

await main();
