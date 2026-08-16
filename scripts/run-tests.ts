import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_DIR = path.resolve('tests');
const TEST_FILE_PATTERN = /\.test\.(?:ts|js)$/;

/**
 * Test categories are defined by the folder a test lives in, not by a
 * hand-maintained allowlist. Adding a test file puts it in a category
 * automatically, so a new browser or corpus test can no longer land in the
 * fast gate — or get silently quarantined out of every gate — by omission.
 *
 * - `slow`   excluded from the `fast` profile that `bun run check` runs.
 * - `serial` runs in its own pass with `--max-concurrency=1`. Browser-backed
 *   tests contend for GPU and port resources, and time out when interleaved
 *   with the rest of the suite.
 */
const CATEGORY_TRAITS = {
  unit: { slow: false, serial: false },
  compat: { slow: false, serial: false },
  corpus: { slow: true, serial: false },
  e2e: { slow: true, serial: true },
} as const;

type Category = keyof typeof CATEGORY_TRAITS;

const CATEGORIES = Object.keys(CATEGORY_TRAITS) as Category[];

const INTEGRATION_TEST = 'tests/e2e/agent-integration.test.ts';

/** Profiles are compositions of categories. */
const PROFILES: Record<string, Category[]> = {
  all: ['unit', 'compat', 'corpus', 'e2e'],
  fast: ['unit', 'compat'],
  unit: ['unit'],
  compat: ['compat'],
  corpus: ['corpus'],
  e2e: ['e2e'],
};

async function listTestFiles(dir: string): Promise<string[]> {
  try {
    const glob = new Bun.Glob('**/*.test.{ts,js}');
    const files: string[] = [];
    const relDir = path.relative(process.cwd(), dir);
    for await (const file of glob.scan({ cwd: dir })) {
      files.push(path.join(relDir, file).replace(/\\/g, '/'));
    }
    return files.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function listCategoryFiles(category: Category): Promise<string[]> {
  const dir = path.join(TEST_DIR, category);
  return listTestFiles(dir);
}

/**
 * Guard against the failure mode this layout exists to prevent: a test file
 * dropped straight into `tests/` belongs to no category, so no profile would
 * ever select it and it would never run.
 */
async function assertNoUncategorizedTests(): Promise<void> {
  const entries = await fs.readdir(TEST_DIR, { withFileTypes: true });
  const stray = entries
    .filter((entry) => entry.isFile() && TEST_FILE_PATTERN.test(entry.name))
    .map((entry) => `tests/${entry.name}`);

  if (stray.length > 0) {
    throw new Error(
      `Test files must live in a category folder (${CATEGORIES.join(', ')}), ` +
        `otherwise no profile will run them. Uncategorized:\n` +
        stray.map((file) => `  - ${file}`).join('\n'),
    );
  }
}

type ParsedArgs = {
  profile: string;
  watch: boolean;
  changed: boolean;
  explicitFiles: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  let profile: string | undefined;
  let watch = false;
  let changed = false;
  const explicitFiles: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;

    if (arg === '--watch') {
      watch = true;
      continue;
    }

    if (arg === '--changed') {
      changed = true;
      continue;
    }

    if (arg === '--profile') {
      profile = argv[index + 1] ?? profile;
      index += 1;
      continue;
    }

    explicitFiles.push(arg);
  }

  // `--changed` is an inner-loop filter, so it defaults to the fast profile
  // rather than `all`: affected e2e files need their own serial browser pass,
  // which defeats the point of a sub-second feedback loop.
  return {
    profile: profile ?? (changed ? 'fast' : 'all'),
    watch,
    changed,
    explicitFiles,
  };
}

function resolveProfileCategories(profile: string): Category[] {
  const categories = PROFILES[profile];
  if (categories) {
    return categories;
  }

  throw new Error(
    `Unknown test profile "${profile}". Expected one of: ${Object.keys(PROFILES)
      .concat('integration')
      .join(', ')}.`,
  );
}

function buildBunTestCmd({
  files,
  watch,
  changed,
  parallel,
  maxConcurrency,
}: {
  files: string[];
  watch: boolean;
  changed?: boolean;
  parallel?: number | true;
  maxConcurrency?: number;
}): string[] {
  return [
    'bun',
    'test',
    '--preload=./tests/setup.ts',
    ...(watch ? ['--watch'] : []),
    ...(changed ? ['--changed'] : []),
    ...(parallel === true
      ? ['--parallel']
      : typeof parallel === 'number'
        ? [`--parallel=${parallel}`]
        : []),
    ...(typeof maxConcurrency === 'number'
      ? [`--max-concurrency=${maxConcurrency}`]
      : []),
    ...files,
  ];
}

async function runBunTest(options: {
  files: string[];
  watch: boolean;
  changed?: boolean;
  parallel?: number | true;
  maxConcurrency?: number;
}) {
  const proc = Bun.spawn({
    cmd: buildBunTestCmd(options),
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  return proc.exited;
}

/**
 * `bun test` executes files sequentially inside a single process, so the fast
 * suite would otherwise pin to one core. `--parallel` (Bun 1.3.13+) fans test
 * files out across worker processes with work stealing and per-file atomic
 * output — replacing the byte-weighted shard packer and its hand-maintained
 * per-file weight table that this script used to carry. Override the worker
 * count with STIMS_TEST_SHARDS=n (n=1 restores single-process behavior);
 * unset, bun sizes the pool to the machine's CPU count.
 */
function resolveParallelism(): number | true {
  const requested = Number.parseInt(process.env.STIMS_TEST_SHARDS ?? '', 10);
  if (Number.isFinite(requested) && requested > 0) return requested;
  return true;
}

/**
 * Browser-backed categories run each file in its own `bun test` process:
 * these suites hold WebGL contexts and dev-server connections that the
 * runner does not release until the process exits, and accumulating them in
 * one process starves small machines and hangs later tests.
 *
 * On CI's 2-core runner the files must also run one at a time or they starve
 * each other. A developer machine has the CPU and GPU to overlap a few — and
 * every e2e file owns a unique dev-server port, so they don't collide.
 * Default is 2, not more: these suites carry 5–45s timeout budgets that
 * start flaking when the machine is also running other sessions' browser
 * work. STIMS_E2E_CONCURRENCY overrides (1 restores strictly serial runs).
 */
const SERIAL_FILE_CONCURRENCY = process.env.CI
  ? 1
  : Math.max(
      1,
      Number.parseInt(process.env.STIMS_E2E_CONCURRENCY ?? '', 10) || 2,
    );

async function runSerialCategory(files: string[]): Promise<number> {
  const concurrency = Math.min(SERIAL_FILE_CONCURRENCY, files.length);

  if (concurrency <= 1) {
    for (const file of files) {
      const exitCode = await runBunTest({
        files: [file],
        watch: false,
        maxConcurrency: 1,
      });
      if (exitCode !== 0) return exitCode;
    }
    return 0;
  }

  const queue = [...files];
  const active = new Set<ReturnType<typeof Bun.spawn>>();
  // If we die (Ctrl-C, or the quality gate killing us on a sibling step's
  // failure), the child processes must die too — otherwise they keep running
  // detached and invisible, silently burning CPU.
  const killActive = () => {
    for (const proc of active) proc.kill();
  };
  process.once('SIGINT', killActive);
  process.once('SIGTERM', killActive);

  let worstExitCode = 0;
  try {
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (;;) {
          const file = queue.shift();
          if (!file) return;

          const proc = Bun.spawn({
            cmd: buildBunTestCmd({
              files: [file],
              watch: false,
              maxConcurrency: 1,
            }),
            cwd: process.cwd(),
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
          });
          active.add(proc);
          const [exitCode, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ]);
          active.delete(proc);

          console.log(
            `\n==> ${file} ${exitCode === 0 ? 'passed' : `FAILED (exit ${exitCode})`}`,
          );
          if (stdout.trim()) console.log(stdout.trim());
          if (stderr.trim()) console.error(stderr.trim());
          if (exitCode !== 0) {
            worstExitCode = worstExitCode || exitCode;
          }
        }
      }),
    );
  } finally {
    process.off('SIGINT', killActive);
    process.off('SIGTERM', killActive);
  }

  return worstExitCode;
}

async function main() {
  const { profile, watch, changed, explicitFiles } = parseArgs(
    process.argv.slice(2),
  );

  if (explicitFiles.length > 0) {
    process.exit(await runBunTest({ files: explicitFiles, watch, changed }));
  }

  await assertNoUncategorizedTests();

  // `--changed` hands the profile's file list to a single `bun test --changed`
  // pass, which builds the import graph and keeps only files transitively
  // affected by uncommitted git changes. Sharding is skipped: the affected
  // subset is expected to be small, and pre-splitting the list would defeat
  // bun's own filtering.
  if (changed) {
    const categories = resolveProfileCategories(profile);
    const files = (await Promise.all(categories.map(listCategoryFiles))).flat();
    process.exit(await runBunTest({ files, watch, changed }));
  }

  // `integration` stays a single-file profile: CI runs it as its own job.
  if (profile === 'integration') {
    process.exit(
      await runBunTest({
        files: [INTEGRATION_TEST],
        watch,
        maxConcurrency: 1,
      }),
    );
  }

  const categories = resolveProfileCategories(profile);

  const parallel = categories.filter((c) => !CATEGORY_TRAITS[c].serial);
  const serial = categories.filter((c) => CATEGORY_TRAITS[c].serial);

  const parallelFiles = (
    await Promise.all(parallel.map(listCategoryFiles))
  ).flat();

  // Watch mode can only drive one bun process, so keep it to a single pass.
  if (watch) {
    const files = (await Promise.all(categories.map(listCategoryFiles))).flat();
    process.exit(await runBunTest({ files, watch, maxConcurrency: 1 }));
  }

  if (parallelFiles.length > 0) {
    const parallel = resolveParallelism();
    const exitCode = await runBunTest({
      files: parallelFiles,
      watch: false,
      // n=1 keeps the documented escape hatch: a plain in-process run with
      // unbuffered output, no worker pool.
      ...(parallel === 1 ? {} : { parallel }),
    });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  for (const category of serial) {
    const files = await listCategoryFiles(category);
    if (files.length === 0) continue;

    const exitCode = await runSerialCategory(files);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  process.exit(0);
}

await main();
