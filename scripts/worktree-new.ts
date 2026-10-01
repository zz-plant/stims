/**
 * Creates a git worktree for a branch off the latest default branch and
 * installs its dependencies, so a change can be made without touching the
 * shared main checkout.
 *
 * Several sessions often work in this repo at once, and the main checkout's
 * index and working tree are shared between them: another session's staged
 * files ride along with a commit, and a stash or branch switch from elsewhere
 * takes uncommitted work with it. A worktree per change avoids all of that.
 * New branches are created without tracking the base, the trap
 * `branch:restart` describes: an upstream of origin/main makes every commit
 * read as unpushed against the wrong branch.
 *
 * Usage:
 *   bun run worktree:new -- <branch>                 # off origin/main
 *   bun run worktree:new -- <branch> --base <name>   # a base other than main
 *   bun run worktree:new -- <branch> --path <dir>    # somewhere else
 *   bun run worktree:new -- <branch> --no-install    # skip bun install
 *
 * The default path is `<main checkout's parent>/worktrees/<repo>-<branch>`.
 * An existing local branch is checked out as it is, not reset.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

type Options = {
  branch?: string;
  base: string;
  path?: string;
  install: boolean;
};

export function parseArgs(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const positional = argv.filter(
    (arg, index) =>
      !arg.startsWith('--') &&
      !['--base', '--path'].includes(argv[index - 1] ?? ''),
  );
  return {
    branch: positional[0],
    base: value('--base') ?? 'main',
    path: value('--path'),
    install: !argv.includes('--no-install'),
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

export type WorktreeResult = {
  ok: boolean;
  lines: string[];
  path?: string;
};

/** Creates the worktree from `cwd`'s repository; separated from the CLI so
 * it can be tested. Never installs dependencies. */
export function createWorktree(
  options: Options,
  cwd: string = process.cwd(),
): WorktreeResult {
  const git = makeGit(cwd);
  const lines: string[] = [];
  const fail = (message: string): WorktreeResult => ({
    ok: false,
    lines: [...lines, `✖ ${message}`],
  });

  const { branch } = options;
  if (!branch) return fail('name the branch: bun run worktree:new -- <branch>');
  if (!git('check-ref-format', '--branch', branch).ok) {
    return fail(`"${branch}" is not a valid branch name.`);
  }

  const commonDir = git(
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  );
  if (!commonDir.ok) return fail(`not a git repository: ${commonDir.err}`);
  const mainCheckout = dirname(commonDir.out);
  const path = options.path
    ? resolve(cwd, options.path)
    : join(
        dirname(mainCheckout),
        'worktrees',
        `${basename(mainCheckout)}-${branch.replaceAll('/', '-')}`,
      );
  if (existsSync(path)) return fail(`${path} already exists.`);

  const fetched = git('fetch', '--quiet', 'origin', options.base);
  if (!fetched.ok) {
    return fail(`git fetch origin ${options.base} failed: ${fetched.err}`);
  }
  const base = `origin/${options.base}`;

  const hasLocal = git(
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ).ok;
  const added = hasLocal
    ? git('worktree', 'add', '--quiet', path, branch)
    : git('worktree', 'add', '--quiet', '--no-track', '-b', branch, path, base);
  if (!added.ok) return fail(`git worktree add failed: ${added.err}`);

  const head = makeGit(path)('rev-parse', '--short', 'HEAD').out;
  lines.push(
    hasLocal
      ? `✓ ${path} on existing branch ${branch} (${head})`
      : `✓ ${path} on new branch ${branch} from ${base} (${head})`,
  );
  return { ok: true, lines, path };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const result = createWorktree(options);
  console.log(result.lines.join('\n'));
  if (!result.ok || !result.path) process.exit(1);

  if (options.install) {
    console.log('Installing dependencies…');
    const install = spawnSync('bun', ['install'], {
      cwd: result.path,
      stdio: 'inherit',
    });
    if (install.status !== 0) {
      console.error(
        `✖ bun install failed in ${result.path}; the worktree is there, run it again by hand.`,
      );
      process.exit(install.status ?? 1);
    }
  }
  console.log(
    `Next:\n    cd ${result.path}\nRemove it when the branch is merged:\n    git worktree remove ${result.path}`,
  );
}
