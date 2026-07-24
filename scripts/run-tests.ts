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
  compat: ['compat', 'corpus'],
  e2e: ['e2e'],
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

async function listCategoryFiles(category: Category): Promise<string[]> {
  const dir = path.join(TEST_DIR, category);
  try {
    return await listTestFiles(dir);
  } catch {
    return [];
  }
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

  if (explicitFiles.length > 0) {
    process.exit(await runBunTest({ files: explicitFiles, watch }));
  }

  await assertNoUncategorizedTests();

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
    const exitCode = await runBunTest({ files: parallelFiles, watch });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  for (const category of serial) {
    const files = await listCategoryFiles(category);
    if (files.length === 0) continue;

    const exitCode = await runBunTest({ files, watch, maxConcurrency: 1 });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  process.exit(0);
}

await main();
