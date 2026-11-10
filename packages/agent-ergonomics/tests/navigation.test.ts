import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectIo,
  findSymbol,
  OUTLINE_DEFAULTS,
  type OutlineEntry,
  outlineSource,
  renderOutline,
  runCli,
} from '../src/index.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-ergonomics-nav-'));
  roots.push(root);
  return root;
};
const write = (root: string, file: string, text: string) => {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), text);
};

// The shebang and the accented comment both sit before every declaration:
// a parser offset that counted from the first token, or in characters rather
// than bytes, would put each line below one or two lines off.
const SOURCE = `#!/usr/bin/env bun
/** Docs with é — and 漢字, so byte offsets run ahead of character offsets. */
import { a } from './a';
import { b } from './b';

export function first(value: number) {
  const inner = () => {
    return value;
  };
  return inner;
}

export class Panel {
  private count = 0;
  render(): string {
    return 'ok';
  }
}

const handler = wrap(() => {
  return 1;
});

interface Shape {
  area(): number;
}

describe('suite', () => {
  test('case', () => {
    expect(a + b).toBe(1);
  });
});
`;

const flat = (entries: OutlineEntry[], depth = 0): string[] =>
  entries.flatMap((entry) => [
    `${'  '.repeat(depth)}${entry.kind} ${entry.name} ${entry.start}-${entry.end}`,
    ...flat(entry.children, depth + 1),
  ]);

test('outline places every declaration on the lines it occupies', async () => {
  // Parsed second on purpose: a parser that kept a running offset across
  // calls would shift this file by the length of the one before it.
  await outlineSource('export const earlier = 1;\n'.repeat(40), 'earlier.ts');
  const outline = await outlineSource(SOURCE, 'sample.ts');

  expect(outline.lines).toBe(32);
  expect(flat(outline.entries)).toEqual([
    'imports  3-4',
    'function first 6-11',
    '  function inner 7-9',
    'class Panel 13-18',
    '  property count 14-14',
    '  method render 15-17',
    'function handler 20-22',
    'interface Shape 24-26',
    '  member area 25-25',
    'test suite 28-32',
    '  test case 29-31',
  ]);
  expect(outline.entries[1]?.label).toBe(
    'export function first(value: number)',
  );
});

test('a file that opens with a comment keeps its declarations on their own lines', async () => {
  // The parser reports the module as starting at its first token, so the
  // comment's length would otherwise be subtracted from every position.
  const outline = await outlineSource(
    '/**\n * Leading docs.\n */\nexport function documented() {\n  return 1;\n}\n',
    'documented.ts',
  );
  expect(flat(outline.entries)).toEqual(['function documented 4-6']);
});

test('outline reads JSX, names effects by their dependencies and marks a long return', async () => {
  const jsx = `export function Dock({ open }: { open: boolean }) {
  useEffect(() => {
    document.title = open ? "Don't close" : 'closed';
  }, [open]);
  return (
    <>
${'      <p>{open}</p>\n'.repeat(20)}    </>
  );
}
`;
  const outline = await outlineSource(jsx, 'Dock.tsx');
  const [dock] = outline.entries;

  expect(dock?.label).toBe('export function Dock({ open }: { open: boolean })');
  expect(
    dock?.children.map(({ label, start, end }) => [label, start, end]),
  ).toEqual([
    ['useEffect(() => …, [open])', 2, 4],
    ['return (…)', 5, 28],
  ]);
});

test('the printed outline hides short nested declarations until they are asked for by name', async () => {
  const outline = await outlineSource(SOURCE, 'sample.ts');

  const shown = renderOutline('sample.ts', outline, OUTLINE_DEFAULTS);
  expect(shown[0]).toBe('sample.ts — 32 lines');
  expect(shown).toContain(' 6-11  export function first(value: number)');
  expect(shown.join('\n')).not.toContain('inner');
  expect(shown.at(-1)).toContain('shorter or deeper declarations not shown');

  const matched = renderOutline('sample.ts', outline, {
    ...OUTLINE_DEFAULTS,
    match: 'inner',
  });
  expect(matched).toEqual([
    'sample.ts — 32 lines',
    '6-11  export function first(value: number)',
    ' 7-9    const inner = () =>',
  ]);
});

test('outline runs without a config file and explains a file it cannot read', async () => {
  const root = fixture();
  write(root, 'src/sample.ts', SOURCE);
  write(root, 'src/broken.ts', 'export function (\n');
  write(root, 'src/style.css', '.a { color: red }\n');

  const ok = collectIo();
  expect(
    await runCli(['outline', 'src/sample.ts'], { cwd: root, io: ok }),
  ).toBe(0);
  expect(ok.logged).toContain('13-18  export class Panel');

  const json = collectIo();
  expect(
    await runCli(['outline', 'src/sample.ts', '--json'], {
      cwd: root,
      io: json,
    }),
  ).toBe(0);
  const [parsed] = JSON.parse(json.logged.join('\n'));
  expect(parsed.file).toBe('src/sample.ts');
  expect(parsed.entries[2].children[1].name).toBe('render');

  const bad = collectIo();
  expect(
    await runCli(['outline', 'src/broken.ts', 'src/style.css'], {
      cwd: root,
      io: bad,
    }),
  ).toBe(1);
  expect(bad.errored[0]).toStartWith('src/broken.ts: ');
  expect(bad.errored[1]).toContain('src/style.css: outline reads .ts');

  expect(await runCli(['outline'], { cwd: root, io: collectIo() })).toBe(2);
  const missing = collectIo();
  expect(
    await runCli(['outline', 'src/sample.ts', '--match', 'nothingHere'], {
      cwd: root,
      io: missing,
    }),
  ).toBe(1);
  expect(missing.errored[0]).toContain(
    'no declaration named like "nothingHere"',
  );
});

function symbolRepo() {
  const root = fixture();
  write(
    root,
    'src/target.ts',
    'export function target(input: string) {\n  return input.length;\n}\nexport const targetExtra = 1;\n',
  );
  write(
    root,
    'src/caller.ts',
    "import { target } from './target';\n\nexport function caller() {\n  const size = target('a');\n  return size;\n}\n",
  );
  write(
    root,
    'tests/target.test.ts',
    "import { target } from '../src/target';\n\ntest('measures', () => {\n  expect(target('ab')).toBe(2);\n});\n",
  );
  write(root, 'ignored/skip.ts', 'target();\n');
  write(root, '.gitignore', 'ignored/\n');
  for (const args of [
    ['init', '-q', '--template='],
    ['add', '-A'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  // Written after `git add`, so it is untracked: work in progress must still be found.
  write(root, 'src/fresh.ts', 'export const alias = target;\n');
  return root;
}

test('where separates the declaration from its uses and names what each use is inside', async () => {
  const root = symbolRepo();
  const report = await findSymbol('target', { cwd: root });

  expect(report.definitions).toEqual([
    {
      file: 'src/target.ts',
      start: 1,
      end: 3,
      label: 'export function target(input: string)',
      within: [],
    },
  ]);
  // `targetExtra` is a different word, and ignored/skip.ts is ignored by git.
  expect(report.files).toEqual([
    {
      file: 'src/caller.ts',
      test: false,
      uses: [
        { line: 1, within: 'import' },
        { line: 4, within: 'caller' },
      ],
    },
    {
      file: 'src/fresh.ts',
      test: false,
      uses: [{ line: 1, within: 'alias' }],
    },
    {
      file: 'tests/target.test.ts',
      test: true,
      uses: [
        { line: 1, within: 'import' },
        { line: 4, within: '"measures"' },
      ],
    },
  ]);
});

test('where prints its three sections, narrows by path and reports a miss as a failure', async () => {
  const root = symbolRepo();

  const all = collectIo();
  expect(await runCli(['where', 'target'], { cwd: root, io: all })).toBe(0);
  expect(all.logged).toEqual([
    'target — 1 definition · 3 uses in 2 files · 2 uses in 1 test file',
    '',
    'defined',
    '  src/target.ts:1-3  export function target(input: string)',
    '',
    'used in',
    '  src/caller.ts  2×  import:1 · caller:4',
    '  src/fresh.ts  1×  alias:1',
    '',
    'tests',
    '  tests/target.test.ts  2×  import:1 · "measures":4',
  ]);

  const narrowed = collectIo();
  expect(
    await runCli(['where', 'target', '--path', 'tests'], {
      cwd: root,
      io: narrowed,
    }),
  ).toBe(0);
  expect(narrowed.logged.join('\n')).not.toContain('src/');

  const miss = collectIo();
  expect(await runCli(['where', 'nothingHere'], { cwd: root, io: miss })).toBe(
    1,
  );
  expect(miss.errored[0]).toContain('nothingHere: no whole-word match');
  expect(await runCli(['where', 'a.b'], { cwd: root, io: collectIo() })).toBe(
    2,
  );
  expect(await runCli(['where'], { cwd: root, io: collectIo() })).toBe(2);
});

test('help narrows the listing to scripts whose name contains a term', async () => {
  const root = fixture();
  write(
    root,
    'package.json',
    JSON.stringify({
      scripts: {
        build: 'bun tools/build.ts',
        'lab:one': 'bun tools/one.ts',
        'lab:two': 'bun tools/two.ts',
        'parity:diff': 'bun tools/diff.ts',
      },
    }),
  );
  for (const name of ['build', 'one', 'two', 'diff']) {
    write(root, `tools/${name}.ts`, `/** Does the ${name} step. */`);
  }
  write(
    root,
    'agent-ergonomics.config.json',
    JSON.stringify({ scriptsDir: 'tools', help: { title: 'Fixture scripts' } }),
  );

  const listed = collectIo();
  expect(await runCli(['help', 'lab'], { cwd: root, io: listed })).toBe(0);
  const text = listed.logged.join('\n');
  expect(text).toContain('Fixture scripts matching "lab" (2)');
  expect(text).toContain('lab:one  Does the one step.');
  expect(text).toContain('lab:two  Does the two step.');
  expect(text).not.toContain('parity:diff');
  expect(text).not.toContain('Top-level');

  const json = collectIo();
  expect(
    await runCli(['help', '--json', 'parity', 'build'], {
      cwd: root,
      io: json,
    }),
  ).toBe(0);
  const index = JSON.parse(json.logged.join('\n'));
  expect(index.bare.map((entry: { name: string }) => entry.name)).toEqual([
    'build',
  ]);
  expect(Object.keys(index.groups)).toEqual(['parity']);

  const none = collectIo();
  expect(await runCli(['help', 'zzz'], { cwd: root, io: none })).toBe(1);
  expect(none.errored[0]).toContain('No script name contains "zzz"');
  expect(none.errored[0]).toContain('--for');
});
