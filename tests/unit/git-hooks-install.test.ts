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

/** A checkout with one commit whose hooks directory is explicit, so the
 * machine's git config cannot leak in. */
function scenario() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'stims-hooks-')));
  roots.push(root);
  const clone = join(root, 'stims');
  git(root, 'init', '-q', '-b', 'main', clone);
  git(clone, 'config', 'user.email', 't@example.com');
  git(clone, 'config', 'user.name', 'T');
  git(clone, 'config', 'commit.gpgsign', 'false');
  const hooksDir = join(root, 'hooks');
  mkdirSync(hooksDir);
  git(clone, 'config', 'core.hooksPath', hooksDir);
  writeFileSync(join(clone, 'README.md'), 'base\n');
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'init');
  return { root, clone, hooksDir };
}

describe('postinstall hook plan', () => {
  test('installs in the main checkout, and a worktree reuses installed hooks', () => {
    const { root, clone, hooksDir } = scenario();
    // lefthook refuses a custom core.hooksPath without --force; plain
    // `install` here failed every `bun install` on a clone carrying one.
    expect(planHookInstall(clone)).toEqual({
      action: 'install-force',
      hooksDir,
    });
    const defaultHooksDir = join(clone, '.git', 'hooks');
    git(clone, 'config', 'core.hooksPath', defaultHooksDir);
    expect(planHookInstall(clone)).toEqual({
      action: 'install',
      hooksDir: defaultHooksDir,
    });
    git(clone, 'config', 'core.hooksPath', hooksDir);

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
