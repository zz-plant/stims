import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restartBranch } from '../../scripts/branch-restart.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const tempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'stims-branch-restart-'));
  roots.push(root);
  return root;
};

// The fixture's git commands ignore the developer's git config (signing,
// hooks, identity); restartBranch runs with the real environment.
const fixtureEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

function gitWithInput(cwd: string, input: string, ...args: string[]) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: fixtureEnv,
    input,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

const git = (cwd: string, ...args: string[]) => gitWithInput(cwd, '', ...args);

function commit(cwd: string, file: string, content: string, message: string) {
  mkdirSync(join(cwd, file, '..'), { recursive: true });
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

/**
 * The history origin holds after a squash-merge, as a `git fast-import`
 * stream: feat adds a and b; main gains one commit with feat's tree, which is
 * what leaves feat's own commits unreachable from main, then unrelated work.
 */
const ORIGIN_HISTORY = [
  ['main', 'init', { 'README.md': 'base' }],
  ['feat', 'feat: a', { 'a.txt': 'a' }],
  ['feat', 'feat: b', { 'b.txt': 'b' }],
  ['main', 'feat: a and b (#1)', { 'a.txt': 'a', 'b.txt': 'b' }],
  ['main', 'unrelated main work', { 'later.txt': 'later' }],
] as const;

function fastImportStream() {
  const data = (text: string) => `data <<EOF\n${text}\nEOF`;
  return ORIGIN_HISTORY.map(([branch, message, files], i) =>
    [
      `commit refs/heads/${branch}`,
      `committer T <t@example.com> ${1_700_000_000 + i} +0000`,
      data(message),
      // feat branches from main's first commit, init.
      ...(i === 1 ? ['from refs/heads/main'] : []),
      ...Object.entries(files).flatMap(([file, text]) => [
        `M 644 inline ${file}`,
        data(text),
      ]),
      '',
    ].join('\n'),
  ).join('\n');
}

/**
 * Builds, in `root`, a bare origin holding ORIGIN_HISTORY and a clone `dev`
 * on feat that has not fetched since the merge. Writing the history with one
 * fast-import, rather than committing and pushing it from two clones, takes
 * this from ~20 git processes to 6.
 */
function scenario(root: string) {
  const origin = join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '--template=', '-b', 'main', origin);
  gitWithInput(origin, fastImportStream(), 'fast-import', '--quiet');

  git(root, 'clone', '-q', '--template=', 'origin.git', 'dev');
  const dev = join(root, 'dev');
  // Relative, so each test's copy of the scenario fetches from its own origin.
  git(dev, 'remote', 'set-url', 'origin', '../origin.git');
  git(dev, 'checkout', '-q', 'feat');
  // dev last fetched before the merge, so a restart that skips the fetch
  // resets onto the stale main and fails the first test.
  gitWithInput(
    dev,
    'update refs/remotes/origin/main main~2\nupdate refs/heads/main main~2\n',
    'update-ref',
    '--stdin',
  );
}

// Every test changes its repositories, so each gets a copy of one scenario:
// copying the files costs a fraction of the git processes that build it.
let template: string;
beforeAll(() => {
  template = tempRoot();
  scenario(template);
});

let s: { dev: string; origin: string };
beforeEach(() => {
  const root = tempRoot();
  cpSync(template, root, { recursive: true });
  s = { dev: join(root, 'dev'), origin: join(root, 'origin.git') };
});

describe('branch:restart', () => {
  test('resets to the new base and repoints upstream at the feature branch', () => {
    const result = restartBranch({ base: 'main', dryRun: false }, s.dev);
    expect(result.ok).toBe(true);

    git(s.dev, 'fetch', '-q', 'origin');
    expect(git(s.dev, 'rev-parse', 'HEAD')).toBe(
      git(s.dev, 'rev-parse', 'origin/main'),
    );
    // The bug this exists for: upstream must be the feature branch, not main.
    expect(git(s.dev, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/feat');
    // Merged history no longer shows as unpushed against the upstream.
    expect(existsSync(join(s.dev, 'later.txt'))).toBe(true);

    const text = result.lines.join('\n');
    const remoteSha = git(s.dev, 'rev-parse', '--short', 'origin/feat');
    expect(text).toContain(`--force-with-lease=feat:${remoteSha}`);
    expect(text).toContain('not in origin/main');
  });

  test('never pushes', () => {
    const before = git(s.origin, 'rev-parse', 'feat');
    restartBranch({ base: 'main', dryRun: false }, s.dev);
    expect(git(s.origin, 'rev-parse', 'feat')).toBe(before);
  });

  test('refuses uncommitted changes and leaves the branch alone', () => {
    writeFileSync(join(s.dev, 'wip.txt'), 'wip\n');
    const head = git(s.dev, 'rev-parse', 'HEAD');
    const result = restartBranch({ base: 'main', dryRun: false }, s.dev);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('wip.txt');
    expect(git(s.dev, 'rev-parse', 'HEAD')).toBe(head);
  });

  test('refuses commits that exist nowhere else', () => {
    commit(s.dev, 'unsaved.txt', 'x\n', 'feat: unpushed work');
    const head = git(s.dev, 'rev-parse', 'HEAD');
    const result = restartBranch({ base: 'main', dryRun: false }, s.dev);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('unpushed work');
    expect(git(s.dev, 'rev-parse', 'HEAD')).toBe(head);
  });

  test('--dry-run changes nothing', () => {
    const head = git(s.dev, 'rev-parse', 'HEAD');
    const result = restartBranch({ base: 'main', dryRun: true }, s.dev);
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('dry run');
    expect(git(s.dev, 'rev-parse', 'HEAD')).toBe(head);
  });

  test('refuses to reset the base branch onto itself', () => {
    git(s.dev, 'checkout', '-q', 'main');
    const result = restartBranch({ base: 'main', dryRun: false }, s.dev);
    expect(result.ok).toBe(false);
  });

  test('with no remote branch it resets and prints a plain push', () => {
    git(s.dev, 'checkout', '-q', '-b', 'fresh', 'main');
    const result = restartBranch({ base: 'main', dryRun: false }, s.dev);
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('git push -u origin fresh');
    expect(result.lines.join('\n')).not.toContain('--force-with-lease');
  });
});
