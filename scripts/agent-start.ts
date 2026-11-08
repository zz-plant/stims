/**
 * One screen at the start of a session: where this checkout is, whether it is
 * safe to edit, and what to run next.
 *
 * The main checkout is shared by several sessions, and dozens of worktrees
 * make "where am I" a multi-command question. This prints the branch, HEAD,
 * dirty files, whether this is the main checkout, and how many merged
 * worktrees are waiting to be pruned.
 *
 * Usage:
 *   bun run agent:start
 *   bun run agent:start -- --json
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { parseWorktreePorcelain } from './worktree-prune.ts';

export type SessionSummary = {
  cwd: string;
  branch: string;
  head: string;
  isMainCheckout: boolean;
  dirty: string[];
  worktrees: number;
  mergedWorktrees: number;
};

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    out: (result.stdout ?? '').trim(),
  };
}

function git(cwd: string, ...args: string[]) {
  return run('git', args, cwd);
}

/** The main checkout and the one running this script are never counted as pruneable. */
function collectSession(cwd: string): SessionSummary {
  const top = git(cwd, 'rev-parse', '--show-toplevel').out || cwd;
  const common = git(
    cwd,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ).out;
  const main = common ? dirname(common) : top;
  const branch =
    git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').out || '(unknown)';
  const head = git(cwd, 'rev-parse', '--short', 'HEAD').out || '(unknown)';
  const status = git(cwd, 'status', '--porcelain').out;
  const dirty = status === '' ? [] : status.split('\n');

  const listed = git(cwd, 'worktree', 'list', '--porcelain').out;
  const entries = parseWorktreePorcelain(listed);
  const merged = new Set(
    git(cwd, 'branch', '--merged', 'origin/main', '--format=%(refname:short)')
      .out.split('\n')
      .filter(Boolean),
  );
  const protectedBranches = new Set(['main', branch]);
  const mergedWorktrees = entries.filter(
    (entry) =>
      entry.branch !== null &&
      merged.has(entry.branch) &&
      !protectedBranches.has(entry.branch) &&
      resolve(entry.path) !== resolve(top) &&
      resolve(entry.path) !== resolve(main),
  ).length;

  return {
    cwd: top,
    branch,
    head,
    isMainCheckout: resolve(top) === resolve(main),
    dirty,
    worktrees: entries.length,
    mergedWorktrees,
  };
}

export function formatSession(summary: SessionSummary): string[] {
  const lines = [
    'Stims session',
    `  cwd:    ${summary.cwd}`,
    `  branch: ${summary.branch} (${summary.head})`,
    `  role:   ${summary.isMainCheckout ? 'main checkout — SHARED with other sessions' : 'worktree'}`,
    `  dirty:  ${summary.dirty.length === 0 ? 'none' : `${summary.dirty.length} file(s)`}`,
  ];
  for (const file of summary.dirty.slice(0, 5)) lines.push(`    ${file}`);
  if (summary.dirty.length > 5) {
    lines.push(`    … and ${summary.dirty.length - 5} more`);
  }
  lines.push(
    `  trees:  ${summary.worktrees} worktree(s), ${summary.mergedWorktrees} merged and pruneable`,
  );
  lines.push(
    '',
    'Next:',
    '  bun run help --for "<symptom>"   find the right instrument',
    '  bun run check:quick              fast gate while editing',
    '  bun run worktree:new -- <branch> start a change away from this checkout',
  );
  if (summary.mergedWorktrees > 0) {
    lines.push(
      '  bun run worktree:prune           size the merged worktrees (dry run)',
    );
  }
  if (summary.isMainCheckout && summary.dirty.length > 0) {
    lines.push(
      '',
      '⚠ This is the main checkout and it has uncommitted work. Another session',
      '  can switch branches under you. Move the change to its own worktree:',
      '    bun run worktree:new -- <branch>',
    );
  }
  return lines;
}

function main(argv: string[]): number {
  const summary = collectSession(process.cwd());
  if (argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  for (const line of formatSession(summary)) console.log(line);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
