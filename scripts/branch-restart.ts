/**
 * Restarts a feature branch from the latest default branch after its pull
 * request was squash-merged, without losing work it would still need.
 *
 * A squash-merge leaves the branch's own commits unreachable from main, so the
 * manual recovery (`git checkout -B <branch> origin/main`) also leaves the
 * upstream tracking `origin/main` instead of `origin/<branch>`, and any hook
 * that compares against the upstream then reports commits that are already
 * merged as "unpushed". This does the reset once, correctly: it refuses when
 * there is uncommitted or unpushed work, resets only the LOCAL branch, points
 * the upstream at the remote feature branch when it exists, and prints the
 * exact push command. It never pushes: rewriting a remote branch is outward
 * facing and hard to undo, so that stays a deliberate second step.
 *
 * Usage:
 *   bun run branch:restart                      # current branch onto origin/main
 *   bun run branch:restart -- --branch <name>   # a named branch
 *   bun run branch:restart -- --base <name>     # a base other than main
 *   bun run branch:restart -- --dry-run         # print the plan, change nothing
 */
import { spawnSync } from 'node:child_process';

type Options = { branch?: string; base: string; dryRun: boolean };

export function parseArgs(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    branch: value('--branch'),
    base: value('--base') ?? 'main',
    dryRun: argv.includes('--dry-run'),
  };
}

function makeGit(cwd: string) {
  return (...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return {
      ok: result.status === 0,
      out: (result.stdout ?? '').trim(),
      err: (result.stderr ?? '').trim(),
    };
  };
}

export type RestartResult = {
  ok: boolean;
  lines: string[];
};

/** Runs the restart in `cwd`; separated from the CLI so it can be tested. */
export function restartBranch(
  options: Options,
  cwd: string = process.cwd(),
): RestartResult {
  const git = makeGit(cwd);
  const lines: string[] = [];
  const fail = (message: string): RestartResult => ({
    ok: false,
    lines: [...lines, `✖ ${message}`],
  });

  const current = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (!current.ok) return fail(`not a git repository: ${current.err}`);
  const branch = options.branch ?? current.out;
  if (branch === 'HEAD') return fail('detached HEAD; pass --branch <name>.');
  if (branch === options.base) {
    return fail(
      `refusing to reset the base branch "${options.base}" onto itself.`,
    );
  }

  const dirty = git('status', '--porcelain');
  if (dirty.out) {
    return fail(
      'uncommitted changes would be lost or carried onto the new base; commit or stash them first:\n' +
        dirty.out
          .split('\n')
          .slice(0, 8)
          .map((line) => `    ${line}`)
          .join('\n'),
    );
  }

  const fetched = git('fetch', '--quiet', 'origin', options.base);
  if (!fetched.ok)
    return fail(`git fetch origin ${options.base} failed: ${fetched.err}`);
  const base = `origin/${options.base}`;

  const remoteBranchRef = `origin/${branch}`;
  const hasLocal = git(
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ).ok;
  const remoteFetched = git('fetch', '--quiet', 'origin', branch).ok;
  const hasRemote =
    remoteFetched &&
    git('rev-parse', '--verify', '--quiet', `refs/remotes/${remoteBranchRef}`)
      .ok;

  // Work that exists nowhere else: local commits on neither the remote branch
  // nor the base. Resetting would destroy exactly these.
  if (hasLocal) {
    const exclude = hasRemote ? [remoteBranchRef, base] : [base];
    const unpushed = git(
      'log',
      '--oneline',
      `refs/heads/${branch}`,
      ...exclude.map((ref) => `^${ref}`),
    );
    if (unpushed.out) {
      return fail(
        `"${branch}" has commits that exist nowhere else and would be lost; push or cherry-pick them first:\n` +
          unpushed.out
            .split('\n')
            .slice(0, 8)
            .map((line) => `    ${line}`)
            .join('\n'),
      );
    }
  }

  // Informational: commits on the remote branch that the base lacks. After a
  // squash-merge that is the branch's own (now merged) history, which is fine
  // to replace, but it is also what unmerged remote work looks like.
  let remoteOnly: string[] = [];
  if (hasRemote) {
    remoteOnly = git('log', '--oneline', remoteBranchRef, `^${base}`)
      .out.split('\n')
      .filter(Boolean);
  }

  lines.push(`Restart "${branch}" from ${base}`);
  if (remoteOnly.length > 0) {
    lines.push(
      `! ${remoteBranchRef} has ${remoteOnly.length} commit(s) not in ${base}. Expected after a squash-merge; if the PR was NOT merged, stop — pushing replaces them:`,
      ...remoteOnly.slice(0, 5).map((line) => `    ${line}`),
    );
  }

  if (options.dryRun) {
    lines.push('(dry run: nothing changed)');
    return { ok: true, lines };
  }

  const reset = git('checkout', '-q', '-B', branch, base);
  if (!reset.ok) return fail(`checkout -B failed: ${reset.err}`);

  // `checkout -B <b> origin/main` sets upstream to origin/main, which is what
  // makes merged commits read as "unpushed" against the feature branch.
  if (hasRemote) {
    const upstream = git(
      'branch',
      `--set-upstream-to=${remoteBranchRef}`,
      branch,
    );
    if (!upstream.ok) return fail(`could not set upstream: ${upstream.err}`);
    const sha = git('rev-parse', '--short', remoteBranchRef).out;
    lines.push(
      `✓ ${branch} now at ${git('rev-parse', '--short', 'HEAD').out} (${base}), tracking ${remoteBranchRef}`,
      `Next, once you have new commits (never before: the branch equals ${base} until then):`,
      `    git push --force-with-lease=${branch}:${sha} -u origin ${branch}`,
    );
  } else {
    git('branch', '--unset-upstream', branch);
    lines.push(
      `✓ ${branch} now at ${git('rev-parse', '--short', 'HEAD').out} (${base}); no remote branch yet`,
      `Next, once you have new commits:`,
      `    git push -u origin ${branch}`,
    );
  }
  return { ok: true, lines };
}

if (import.meta.main) {
  const result = restartBranch(parseArgs(process.argv.slice(2)));
  console.log(result.lines.join('\n'));
  process.exit(result.ok ? 0 : 1);
}
