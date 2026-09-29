import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
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

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function commit(cwd: string, file: string, content: string, message: string) {
  mkdirSync(join(cwd, file, '..'), { recursive: true });
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

/**
 * A bare origin plus two clones. `dev` works on a feature branch; `other`
 * squash-merges it into main, which is what leaves the branch's own commits
 * unreachable from main.
 */
function scenario() {
  const root = mkdtempSync(join(tmpdir(), 'stims-branch-restart-'));
  roots.push(root);
  const origin = join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const clone = (name: string) => {
    const dir = join(root, name);
    git(root, 'clone', '-q', origin, dir);
    git(dir, 'config', 'user.email', 't@example.com');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'config', 'commit.gpgsign', 'false');
    return dir;
  };
  const dev = clone('dev');
  commit(dev, 'README.md', 'base\n', 'init');
  git(dev, 'push', '-q', '-u', 'origin', 'main');
  git(dev, 'checkout', '-q', '-b', 'feat');
  commit(dev, 'a.txt', 'a\n', 'feat: a');
  commit(dev, 'b.txt', 'b\n', 'feat: b');
  git(dev, 'push', '-q', '-u', 'origin', 'feat');

  // Squash-merge feat into main from another clone: one new commit, same tree.
  const other = clone('other');
  git(other, 'merge', '-q', '--squash', 'origin/feat');
  git(other, 'commit', '-q', '-m', 'feat: a and b (#1)');
  commit(other, 'later.txt', 'later\n', 'unrelated main work');
  git(other, 'push', '-q', 'origin', 'main');
  return { dev, other, origin };
}

let s: ReturnType<typeof scenario>;
beforeEach(() => {
  s = scenario();
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
