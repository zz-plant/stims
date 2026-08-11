import fs from 'node:fs/promises';
import os from 'node:os';
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
  compat: ['compat', 'corpus'],
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
  maxConcurrency,
}: {
  files: string[];
  watch: boolean;
  changed?: boolean;
  maxConcurrency?: number;
}): string[] {
  return [
    'bun',
    'test',
    '--preload=./tests/setup.ts',
    ...(watch ? ['--watch'] : []),
    ...(changed ? ['--changed'] : []),
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

// Weights are byte-equivalent shard-packing units, refreshed from measured
// per-file wall times (2026-08: codex-session 3.3s, catalog-compiler-smoke
// 1.4s, codex-setup 1.0s; the compiler/shader suites all run under 1s now).
const KNOWN_HEAVY_TESTS: Record<string, number> = {
  'tests/unit/codex-session-script.test.ts': 80000,
  'tests/unit/catalog-compiler-smoke.test.ts': 40000,
  'tests/unit/codex-setup-script.test.ts': 30000,
  'tests/unit/milkdrop-catalog-store.test.ts': 25000,
  'tests/unit/check-toys.test.ts': 25000,
  'tests/unit/agent-api.test.ts': 25000,
  'tests/unit/catalog-store-analysis.test.ts': 25000,
  'tests/unit/mcp-server.test.ts': 25000,
};

/**
 * `bun test` executes files sequentially inside a single process, so the fast
 * suite was pinned to one core. Sharding splits the file list across several
 * processes to use the machine's cores. Override with STIMS_TEST_SHARDS=n
 * (n=1 restores single-process behavior).
 */
function resolveShardCount(fileCount: number): number {
  const requested = Number.parseInt(process.env.STIMS_TEST_SHARDS ?? '', 10);
  const shards =
    Number.isFinite(requested) && requested > 0
      ? requested
      : Math.max(1, Math.min(16, os.cpus().length - 1));
  return Math.min(shards, fileCount);
}

/**
 * A real child-process fork/exec (a spawned shell script, a `sleep`
 * placeholder process, etc.) costs orders of magnitude more wall-clock time
 * than the same number of source bytes of pure JS/TS, so byte size badly
 * underestimates these files and they land on shards by chance rather than
 * by design. Detect the pattern directly instead of relying solely on the
 * hand-maintained `KNOWN_HEAVY_TESTS` override list, which drifts stale as
 * new spawn-based tests get added without anyone remembering to weight them.
 */
const SUBPROCESS_SPAWN_WEIGHT = 8000;

function countSubprocessSpawns(source: string): number {
  if (!/from\s+['"]node:child_process['"]/.test(source)) return 0;
  const matches = source.match(/\b(?:spawnSync|spawn|execSync|exec)\(/g);
  return matches ? matches.length : 0;
}

/**
 * Balance shards by file size, known execution weight, and detected
 * subprocess-spawn cost (largest-first greedy) so one shard doesn't end up
 * with all of the heavyweight compiler/shader/subprocess suites.
 */
async function buildShards(
  files: string[],
  shardCount: number,
): Promise<string[][]> {
  const sized = await Promise.all(
    files.map(async (file) => {
      const statSize = Bun.file(file).size;
      const knownWeight = KNOWN_HEAVY_TESTS[file] ?? 0;
      const source = await Bun.file(file).text();
      const spawnBonus =
        countSubprocessSpawns(source) * SUBPROCESS_SPAWN_WEIGHT;
      const size = Math.max(statSize, knownWeight) + spawnBonus;
      return { file, size };
    }),
  );
  sized.sort((a, b) => b.size - a.size);

  const shards = Array.from({ length: shardCount }, () => ({
    files: [] as string[],
    total: 0,
  }));
  for (const { file, size } of sized) {
    const target = shards.reduce((min, shard) =>
      shard.total < min.total ? shard : min,
    );
    target.files.push(file);
    target.total += size;
  }

  return shards.map((shard) => shard.files).filter((list) => list.length > 0);
}

async function runShardedBunTest(files: string[]): Promise<number> {
  const shardCount = resolveShardCount(files.length);
  if (shardCount <= 1) {
    return runBunTest({ files, watch: false });
  }

  const shards = await buildShards(files, shardCount);
  console.log(
    `Running ${files.length} test files across ${shards.length} shards…`,
  );

  const procs = shards.map((shardFiles) =>
    Bun.spawn({
      cmd: buildBunTestCmd({ files: shardFiles, watch: false }),
      cwd: process.cwd(),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );

  // If we die (Ctrl-C, or the quality gate killing us on a sibling step's
  // failure), the shard child processes must die too — otherwise they keep
  // running detached and invisible, silently burning CPU.
  const killShards = () => {
    for (const proc of procs) proc.kill();
  };
  process.once('SIGINT', killShards);
  process.once('SIGTERM', killShards);

  const runs = procs.map(async (proc, index) => {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { index, shardFiles: shards[index], exitCode, stdout, stderr };
  });

  let worstExitCode = 0;
  const pending = new Map(runs.map((run, index) => [index, run]));
  try {
    while (pending.size > 0) {
      const result = await Promise.race(pending.values());
      pending.delete(result.index);

      console.log(
        `\n==> Shard ${result.index + 1}/${shards.length} ` +
          `(${result.shardFiles.length} files) ` +
          `${result.exitCode === 0 ? 'passed' : `FAILED (exit ${result.exitCode})`}`,
      );
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.error(result.stderr.trim());

      if (result.exitCode !== 0) {
        worstExitCode = worstExitCode || result.exitCode;
      }
    }
  } finally {
    process.off('SIGINT', killShards);
    process.off('SIGTERM', killShards);
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
    const exitCode = await runShardedBunTest(parallelFiles);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  for (const category of serial) {
    const files = await listCategoryFiles(category);
    if (files.length === 0) continue;

    // Run each serial file in its own `bun test` process. Browser-backed e2e
    // suites hold WebGL/SwiftShader contexts and dev-server connections that
    // the runner does not release until the process exits; accumulating them
    // across files in one process starves the 2-core CI runner and hangs
    // later tests. A fresh process per file resets that pressure.
    for (const file of files) {
      const exitCode = await runBunTest({
        files: [file],
        watch,
        maxConcurrency: 1,
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    }
  }

  process.exit(0);
}

await main();
