/**
 * Finds (and optionally removes) worktrees whose branch is already merged, and
 * reports the disk each one holds.
 *
 * `worktree:new` had no counterpart, so merged branches left their checkouts
 * behind: 65 worktrees and 87 GB accumulated, `git worktree list` became noise,
 * and every session paid to scan it. This is the counterpart. It never removes
 * the main checkout, the worktree it is run from, or a dirty worktree unless
 * asked to.
 *
 * Usage:
 *   bun run worktree:prune                  # dry run: clean, merged worktrees
 *   bun run worktree:prune --apply          # remove them
 *   bun run worktree:prune --apply --all    # also remove clean, unmerged ones
 *   bun run worktree:prune --force          # apply, and remove dirty ones too
 *   bun run worktree:prune -- --json        # analysis for agent:start
 *
 * `--base <name>` and `--remote <name>` default to `main` and `origin`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

export type WorktreeEntry = {
  path: string;
  branch: string | null;
  dirty: boolean;
  merged: boolean;
  bytes: number;
};

export type PruneOptions = {
  base: string;
  remote: string;
  apply: boolean;
  force: boolean;
  all: boolean;
  json: boolean;
};

export function parsePruneArgs(argv: string[]): PruneOptions {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const force = argv.includes('--force');
  return {
    base: value('--base') ?? 'main',
    remote: value('--remote') ?? 'origin',
    apply: argv.includes('--apply') || force,
    force,
    all: argv.includes('--all'),
    json: argv.includes('--json'),
  };
}

/**
 * A worktree can live on a volume that has gone away, and `git status` there
 * does not fail — it waits. Bound every call so one stale path cannot hold the
 * whole prune; a timed-out status reads as dirty and keeps the worktree.
 */
const GIT_TIMEOUT_MS = 15_000;

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  });
  return {
    ok: result.status === 0,
    out: result.stdout ?? '',
    err: (result.stderr ?? result.error?.message ?? '').trim(),
  };
}

function git(cwd: string, ...args: string[]) {
  return run('git', args, cwd);
}

/** `du -sk` is portable across macOS and Linux and fast enough for a few dozen paths. */
function directoryBytes(path: string): number {
  const result = run('du', ['-sk', path], process.cwd());
  if (!result.ok) return 0;
  const kib = Number(result.out.split(/\s+/)[0]);
  return Number.isFinite(kib) ? kib * 1024 : 0;
}

type RawWorktree = { path: string; branch: string | null };

export function parseWorktreePorcelain(output: string): RawWorktree[] {
  const entries: RawWorktree[] = [];
  let current: RawWorktree | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    }
  }
  if (current) entries.push(current);
  return entries;
}

/** The main checkout and the one running this script are never candidates. */
function protectedPaths(cwd: string): Set<string> {
  const paths = new Set<string>();
  const common = git(
    cwd,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  );
  if (common.ok) paths.add(dirname(common.out.trim()));
  const top = git(cwd, 'rev-parse', '--show-toplevel');
  if (top.ok) paths.add(top.out.trim());
  return paths;
}

export function analyzeWorktrees(
  cwd: string,
  options: Pick<PruneOptions, 'base' | 'remote'>,
  measure = true,
  onlyMerged = false,
): WorktreeEntry[] {
  const listed = git(cwd, 'worktree', 'list', '--porcelain');
  if (!listed.ok) throw new Error(`git worktree list failed: ${listed.err}`);

  const skip = protectedPaths(cwd);
  const base = `${options.remote}/${options.base}`;
  const entries: WorktreeEntry[] = [];

  for (const raw of parseWorktreePorcelain(listed.out)) {
    const path = resolve(cwd, raw.path);
    if (skip.has(path)) continue;

    const merged =
      raw.branch !== null &&
      git(cwd, 'merge-base', '--is-ancestor', raw.branch, base).ok;
    // A `status` walk over every worktree is the slow part of a default run,
    // and an unmerged branch is kept regardless. Only `--all` needs it.
    const dirty =
      onlyMerged && !merged
        ? false
        : (() => {
            const status = git(path, 'status', '--porcelain');
            return !status.ok || status.out.trim() !== '';
          })();

    entries.push({
      path,
      branch: raw.branch,
      dirty,
      merged,
      // `du` is the expensive part; the CLI measures only the candidates it
      // will report or remove. Callers that need every size pass measure=true.
      bytes: measure ? directoryBytes(path) : 0,
    });
  }
  return entries;
}

export type Selection = {
  candidates: WorktreeEntry[];
  kept: Array<{ entry: WorktreeEntry; reason: string }>;
  bytes: number;
};

export function selectWorktrees(
  entries: WorktreeEntry[],
  options: Pick<PruneOptions, 'all' | 'force'>,
): Selection {
  const candidates: WorktreeEntry[] = [];
  const kept: Array<{ entry: WorktreeEntry; reason: string }> = [];
  for (const entry of entries) {
    if (entry.dirty && !options.force) {
      kept.push({ entry, reason: 'dirty (use --force)' });
    } else if (!entry.merged && !options.all) {
      kept.push({ entry, reason: 'branch not merged (use --all)' });
    } else {
      candidates.push(entry);
    }
  }
  return {
    candidates,
    kept,
    bytes: candidates.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

export function removeWorktree(
  cwd: string,
  entry: WorktreeEntry,
  force: boolean,
): string | null {
  const args = ['worktree', 'remove', entry.path];
  if (force && entry.dirty) args.push('--force');
  const result = git(cwd, ...args);
  return result.ok ? null : result.err || 'git worktree remove failed';
}

function main(argv: string[]): number {
  const options = parsePruneArgs(argv);
  const cwd = process.cwd();
  const entries = analyzeWorktrees(cwd, options, false, !options.all);
  const selection = selectWorktrees(entries, options);
  for (const entry of selection.candidates) {
    entry.bytes = directoryBytes(entry.path);
  }
  selection.bytes = selection.candidates.reduce(
    (sum, entry) => sum + entry.bytes,
    0,
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          apply: options.apply,
          bytes: selection.bytes,
          candidates: selection.candidates.map((entry) => ({
            path: entry.path,
            branch: entry.branch,
            bytes: entry.bytes,
          })),
          kept: selection.kept.map(({ entry, reason }) => ({
            path: entry.path,
            branch: entry.branch,
            reason,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (selection.candidates.length === 0) {
    console.log('No worktrees to prune.');
    return 0;
  }

  console.log(
    options.apply
      ? 'Removing worktrees:'
      : `Worktrees to prune (dry run, ${formatBytes(selection.bytes)}):`,
  );
  for (const entry of selection.candidates) {
    console.log(
      `  ${entry.path}  ${entry.branch ?? '(detached)'}  ${formatBytes(entry.bytes)}`,
    );
  }

  if (!options.apply) {
    console.log(
      `\nRun \`bun run worktree:prune --apply\` to remove ${selection.candidates.length} worktree(s).`,
    );
    return 0;
  }

  const failures: string[] = [];
  for (const entry of selection.candidates) {
    const error = removeWorktree(cwd, entry, options.force);
    if (error) failures.push(`${entry.path}: ${error}`);
  }
  git(cwd, 'worktree', 'prune');

  if (failures.length > 0) {
    console.error(`\nCould not remove ${failures.length} worktree(s):`);
    for (const failure of failures) console.error(`  ${failure}`);
    return 1;
  }
  console.log(
    `\nRemoved ${selection.candidates.length} worktree(s), reclaiming ${formatBytes(selection.bytes)}.`,
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
