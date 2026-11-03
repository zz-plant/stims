import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktree, parseWorktreeArgs } from '../src/index.ts';

// These tests are bound by the git processes the code under test spawns
// (about a dozen per restart or worktree), and each costs 50-200 ms on macOS
// before load. check:packages runs them in the gate's concurrent lane beside
// typecheck and knip, where bun's 5 s default timed one out with nothing
// wrong. The fixtures are already built once and copied per test.
setDefaultTimeout(20_000);

const parseArgs = (argv: string[]) =>
  parseWorktreeArgs(argv, {
    base: 'main',
    remote: 'origin',
    worktreesDir: 'worktrees',
  });

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const tempRoot = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'stims-worktree-')));
  roots.push(root);
  return root;
};

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function tryGit(cwd: string, ...args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0;
}

/**
 * A bare origin with one commit on main and a clone of it, built once. No
 * template and a hooks path that does not exist keep the machine's hooks out.
 * Each git process here costs 50-200 ms, so building this per test spent
 * most of bun's 5 s default under the gate's load; each test copies it
 * instead.
 */
let template: string;
beforeAll(() => {
  template = tempRoot();
  const origin = join(template, 'origin.git');
  git(template, 'init', '-q', '--bare', '--template=', '-b', 'main', origin);
  const clone = join(template, 'stims');
  git(template, 'clone', '-q', '--template=', origin, clone);
  // Relative, so each test's copy fetches from its own origin.
  git(clone, 'remote', 'set-url', 'origin', '../origin.git');
  git(clone, 'config', 'user.email', 't@example.com');
  git(clone, 'config', 'user.name', 'T');
  git(clone, 'config', 'commit.gpgsign', 'false');
  git(clone, 'config', 'core.hooksPath', 'no-hooks');
  writeFileSync(join(clone, 'README.md'), 'base\n');
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'init');
  git(clone, 'push', '-q', '-u', 'origin', 'main');
});

function scenario() {
  const root = tempRoot();
  cpSync(template, root, { recursive: true });
  return { root, clone: join(root, 'stims') };
}

describe('worktree:new', () => {
  test('creates a new branch off origin/main beside the checkout, without tracking the base', () => {
    const { root, clone } = scenario();

    const result = createWorktree(
      parseArgs(['fix/thing', '--no-install']),
      clone,
    );

    const path = join(root, 'worktrees', 'stims-fix-thing');
    expect(result).toMatchObject({ ok: true, path });
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('fix/thing');
    expect(git(path, 'rev-parse', 'HEAD')).toBe(
      git(clone, 'rev-parse', 'origin/main'),
    );
    // An upstream of origin/main makes every commit look unpushed against
    // the wrong branch.
    expect(
      tryGit(path, 'rev-parse', '--abbrev-ref', 'fix/thing@{upstream}'),
    ).toBe(false);
  });

  test('checks out an existing local branch as it is', () => {
    const { clone } = scenario();
    git(clone, 'checkout', '-q', '-b', 'feat/kept');
    writeFileSync(join(clone, 'kept.txt'), 'kept\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-q', '-m', 'feat: kept');
    const kept = git(clone, 'rev-parse', 'HEAD');
    git(clone, 'checkout', '-q', 'main');

    const result = createWorktree(
      parseArgs(['feat/kept', '--path', '../elsewhere']),
      clone,
    );

    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(clone, '..', 'elsewhere'));
    expect(git(result.path ?? '', 'rev-parse', 'HEAD')).toBe(kept);
  });

  test('refuses a path that already exists, and an invalid branch name', () => {
    const { root, clone } = scenario();
    mkdirSync(join(root, 'worktrees', 'stims-taken'), { recursive: true });

    expect(createWorktree(parseArgs(['taken']), clone).ok).toBe(false);
    expect(createWorktree(parseArgs(['bad..name']), clone).ok).toBe(false);
    expect(createWorktree(parseArgs(['--no-install']), clone).ok).toBe(false);
  });
});
