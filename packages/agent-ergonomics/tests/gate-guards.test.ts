import { afterEach, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildGatePlan,
  checkModuleDocs,
  collectIo,
  findDanglingReferences,
  findSourceGreps,
  resolveConfig,
  runGate,
} from '../src/index.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-ergonomics-guards-'));
  roots.push(root);
  return root;
};

test('gate selects configured modes and environment commands, and skips only postflight tests', () => {
  const gate = resolveConfig({
    gate: {
      preflight: [{ label: 'pre', cmd: ['true'] }],
      concurrent: [
        {
          label: 'quick',
          cmd: ['true'],
          modes: ['quick'],
          envCmd: { name: 'STAGED', value: '1', cmd: ['staged'] },
        },
      ],
      postflight: { full: [{ label: 'tests', cmd: ['tests'] }] },
    },
  }).gate;
  expect(
    buildGatePlan(gate, 'quick', 'parallel', false, { STAGED: '1' })
      .concurrent[0]?.cmd,
  ).toEqual(['staged']);
  const full = buildGatePlan(gate, 'full', 'serial');
  expect(full.concurrent).toHaveLength(0);
  expect(full.postflight).toHaveLength(1);
  const noTests = buildGatePlan(gate, 'full', 'serial', true);
  expect(noTests.preflight).toEqual(full.preflight);
  expect(noTests.postflight).toHaveLength(0);
});

test('gate runs configured steps, hides green detail and keeps failure output without running postflight', async () => {
  const root = fixture();
  const io = collectIo();
  const pass = {
    label: 'pass',
    cmd: ['bun', '-e', 'console.log("green detail")'],
  };
  const fail = {
    label: 'fail',
    cmd: ['bun', '-e', 'console.error("failure evidence");process.exit(7)'],
  };
  const post = {
    label: 'post',
    cmd: ['bun', '-e', 'await Bun.write("post-ran", "yes")'],
  };
  expect(
    await runGate(
      {
        mode: 'full',
        executionMode: 'serial',
        preflight: [pass],
        concurrent: [fail],
        postflight: [post],
      },
      'quiet',
      { cwd: root, io },
    ),
  ).toBe(7);
  expect(io.logged.join('\n')).not.toContain('green detail');
  expect(io.errored.join('\n')).toContain('failure evidence');
  expect(existsSync(join(root, 'post-ran'))).toBe(false);
  expect(
    await runGate(
      {
        mode: 'full',
        executionMode: 'parallel',
        preflight: [],
        concurrent: [pass],
        postflight: [post],
      },
      'quiet',
      { cwd: root, io },
    ),
  ).toBe(0);
  expect(existsSync(join(root, 'post-ran'))).toBe(true);
});

test('guards scan the configured directories and honor only the configured exemptions', () => {
  const root = fixture();
  for (const dir of ['manual', 'lib', 'spec']) mkdirSync(join(root, dir));
  writeFileSync(
    join(root, 'manual/live.md'),
    'Run `npm run missing`. Read `lib/missing.ts`.',
  );
  writeFileSync(join(root, 'manual/OLD.md'), 'Run `npm run archived`.');
  writeFileSync(
    join(root, 'lib/large.ts'),
    'export const value = 1;\n'.repeat(3),
  );
  writeFileSync(
    join(root, 'spec/source.test.ts'),
    'const text = readFileSync("../lib/large.ts", "utf8");',
  );
  const config = resolveConfig({
    runner: 'npm run',
    docRefs: {
      roots: ['manual'],
      extraFiles: [],
      pathPrefixes: ['lib'],
      historicalRecord: /^OLD/,
    },
    moduleDocs: { include: 'lib/*.ts', minLines: 2 },
    testSourceGreps: { testsDir: 'spec', sourceDirs: ['lib'] },
  });
  const missing = findDanglingReferences(config, {}, root);
  expect(missing.map((item) => item.problem)).toEqual([
    'missing path lib/missing.ts',
    'unknown script npm run missing',
  ]);
  expect(checkModuleDocs(config.moduleDocs, root).failures).toHaveLength(1);
  expect(findSourceGreps(config.testSourceGreps, root)).toEqual([
    'spec/source.test.ts',
  ]);
  config.testSourceGreps.allowed['spec/source.test.ts'] =
    'The built source is the delivered artifact in this fixture.';
  expect(findSourceGreps(config.testSourceGreps, root)).toEqual([]);
  writeFileSync(
    join(root, 'lib/large.ts'),
    '/** Owns the configured fixture and validates its input before use. */\n' +
      'export const value = 1;\n'.repeat(3),
  );
  config.moduleDocs.backlog = ['lib/large.ts'];
  expect(checkModuleDocs(config.moduleDocs, root).readyToRetire).toEqual([
    'lib/large.ts',
  ]);
});
