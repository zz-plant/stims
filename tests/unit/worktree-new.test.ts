import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planHookInstall } from '../../scripts/git-hooks-install.ts';
import { createWorktree, parseArgs } from '../../scripts/worktree-new.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

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

/** A bare origin with one commit on main, and a clone of it whose own hooks
 * directory is explicit, so the machine's git config cannot leak in. */
function scenario() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'stims-worktree-')));
  roots.push(root);
  const origin = join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const clone = join(root, 'stims');
  git(root, 'clone', '-q', origin, clone);
  git(clone, 'config', 'user.email', 't@example.com');
  git(clone, 'config', 'user.name', 'T');
  git(clone, 'config', 'commit.gpgsign', 'false');
  const hooksDir = join(root, 'hooks');
  mkdirSync(hooksDir);
  git(clone, 'config', 'core.hooksPath', hooksDir);
  writeFileSync(join(clone, 'README.md'), 'base\n');
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'init');
  git(clone, 'push', '-q', '-u', 'origin', 'main');
  return { root, clone, hooksDir };
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

describe('postinstall hook plan', () => {
  test('installs in the main checkout, and a worktree reuses installed hooks', () => {
    const { root, clone, hooksDir } = scenario();
    expect(planHookInstall(clone)).toEqual({ action: 'install', hooksDir });

    const worktree = join(root, 'wt');
    git(clone, 'worktree', 'add', '-q', '--detach', worktree);
    // No hooks installed yet: lefthook must be told to write into a hooks
    // path outside the worktree.
    expect(planHookInstall(worktree)).toEqual({
      action: 'install-force',
      hooksDir,
    });

    writeFileSync(join(hooksDir, 'pre-commit'), '#!/bin/sh\n');
    expect(planHookInstall(worktree)).toEqual({ action: 'reuse', hooksDir });
  });

  test('skips outside a git checkout', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'stims-no-git-')));
    roots.push(dir);
    expect(existsSync(join(dir, '.git'))).toBe(false);
    expect(planHookInstall(dir).action).toBe('skip');
  });
});
