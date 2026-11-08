import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
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
import {
  analyzeWorktrees,
  removeWorktree,
  selectWorktrees,
} from '../../scripts/worktree-prune.ts';

const root = mkdtempSync(join(tmpdir(), 'stims-prune-'));
const repo = join(root, 'repo');

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

function commit(message: string) {
  writeFileSync(join(repo, 'file.txt'), message);
  git('add', 'file.txt');
  git('commit', '-m', message);
}

function worktree(name: string): string {
  const path = join(root, name);
  git('worktree', 'add', '-b', `feat/${name}`, path, 'main');
  writeFileSync(join(path, 'work.txt'), name);
  execFileSync('git', ['add', 'work.txt'], { cwd: path });
  execFileSync('git', ['commit', '-m', `work on ${name}`], { cwd: path });
  return path;
}

mkdirSync(repo, { recursive: true });
git('init', '-b', 'main');
git('config', 'user.email', 'test@example.test');
git('config', 'user.name', 'Test');
commit('base');

const mergedPath = worktree('merged');
git('merge', '--no-ff', '-m', 'merge merged', 'feat/merged');
git('update-ref', 'refs/remotes/origin/main', 'main');

const unmergedPath = worktree('unmerged');
const dirtyPath = worktree('dirty');
git('merge', '--no-ff', '-m', 'merge dirty', 'feat/dirty');
git('update-ref', 'refs/remotes/origin/main', 'main');
writeFileSync(join(dirtyPath, 'uncommitted.txt'), 'dirty');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test('classifies merged, unmerged, and dirty worktrees', () => {
  const entries = analyzeWorktrees(repo, { base: 'main', remote: 'origin' });
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  // git reports the resolved path; macOS's temp dir is a symlink.
  expect(byPath.get(realpathSync(mergedPath))).toMatchObject({
    branch: 'feat/merged',
    dirty: false,
    merged: true,
  });
  expect(byPath.get(realpathSync(unmergedPath))).toMatchObject({
    branch: 'feat/unmerged',
    dirty: false,
    merged: false,
  });
  expect(byPath.get(realpathSync(dirtyPath))).toMatchObject({
    branch: 'feat/dirty',
    dirty: true,
    merged: true,
  });
});

test('never includes the main checkout it runs from', () => {
  const entries = analyzeWorktrees(repo, { base: 'main', remote: 'origin' });

  expect(entries.map((entry) => entry.path)).not.toContain(repo);
});

test('the default selection is clean and merged only', () => {
  const entries = analyzeWorktrees(repo, { base: 'main', remote: 'origin' });
  const selection = selectWorktrees(entries, { all: false, force: false });

  expect(selection.candidates.map((entry) => entry.branch)).toEqual([
    'feat/merged',
  ]);
  expect(selection.kept.map(({ entry }) => entry.branch).sort()).toEqual([
    'feat/dirty',
    'feat/unmerged',
  ]);
});

test('--all and --force widen the selection', () => {
  const entries = analyzeWorktrees(repo, { base: 'main', remote: 'origin' });

  expect(
    selectWorktrees(entries, { all: true, force: false })
      .candidates.map((entry) => entry.branch)
      .sort(),
  ).toEqual(['feat/merged', 'feat/unmerged']);
  expect(
    selectWorktrees(entries, { all: false, force: true })
      .candidates.map((entry) => entry.branch)
      .sort(),
  ).toEqual(['feat/dirty', 'feat/merged']);
  expect(
    selectWorktrees(entries, { all: true, force: true }).candidates,
  ).toHaveLength(3);
});

test('removing a clean worktree deletes its checkout', () => {
  const entries = analyzeWorktrees(repo, { base: 'main', remote: 'origin' });
  const merged = entries.find(
    (entry) => entry.path === realpathSync(mergedPath),
  );

  expect(merged).toBeDefined();
  expect(removeWorktree(repo, merged!, false)).toBeNull();
  expect(existsSync(mergedPath)).toBe(false);
});
