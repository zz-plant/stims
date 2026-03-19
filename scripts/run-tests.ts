import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_DIR = path.resolve('tests');
const TEST_FILE_PATTERN = /\.test\.(?:ts|js)$/;
const INTEGRATION_TEST = 'tests/agent-integration.test.ts';

const PROFILE_FILE_LISTS: Record<string, string[]> = {
  integration: [INTEGRATION_TEST],
  compat: [
    'tests/milkdrop-parity.test.ts',
    'tests/render-preferences.test.ts',
    'tests/postprocessing.test.ts',
    'tests/party-mode.test.ts',
  ],
  'compat-full': [
    'tests/milkdrop-parity.test.ts',
    'tests/loader.test.js',
    'tests/toy-view.test.js',
    'tests/render-preferences.test.ts',
    'tests/postprocessing.test.ts',
    'tests/party-mode.test.ts',
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

  const files = PROFILE_FILE_LISTS[profile];
  if (files) {
    return files;
  }

  throw new Error(
    `Unknown test profile "${profile}". Expected one of: all, unit, integration, compat, compat-full.`,
  );
}

async function main() {
  const { profile, watch, explicitFiles } = parseArgs(process.argv.slice(2));
  const files = explicitFiles.length
    ? explicitFiles
    : await resolveProfileFiles(profile);

  const cmd = [
    'bun',
    'test',
    '--preload=./tests/setup.ts',
    '--importmap=./tests/importmap.json',
    ...(watch ? ['--watch'] : []),
    ...files,
  ];

  const proc = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

await main();
