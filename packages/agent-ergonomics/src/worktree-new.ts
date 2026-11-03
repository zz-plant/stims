/**
 * Creates a git worktree for a branch off the latest default branch and
 * installs its dependencies, so a change can be made without touching the
 * shared main checkout.
 *
 * Several sessions often work in one repo at once, and the main checkout's
 * index and working tree are shared between them: another session's staged
 * files ride along with a commit, and a stash or branch switch from
 * elsewhere takes uncommitted work with it. A worktree per change avoids all
 * of that. New branches are created without tracking the base, the trap
 * `branch-restart` describes: an upstream of the base makes every commit
 * read as unpushed against the wrong branch.
 *
 * The default path is `<main checkout's parent>/<worktreesDir>/<repo>-<branch>`.
 * An existing local branch is checked out as it is, not reset.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Command } from './context.ts';
import { makeGit } from './git.ts';

export type WorktreeOptions = {
  branch?: string;
  base: string;
  remote?: string;
  worktreesDir?: string;
  path?: string;
  install: boolean;
};

export function parseWorktreeArgs(
  argv: string[],
  defaults: { base: string; remote: string; worktreesDir: string },
): WorktreeOptions {
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
    base: value('--base') ?? defaults.base,
    remote: defaults.remote,
    worktreesDir: defaults.worktreesDir,
    path: value('--path'),
    install: !argv.includes('--no-install'),
  };
}

export type WorktreeResult = { ok: boolean; lines: string[]; path?: string };

/**
 * Creates the worktree from `cwd`'s repository; separated from the CLI so it
 * can be tested. Never installs dependencies.
 */
export function createWorktree(
  options: WorktreeOptions,
  cwd: string = process.cwd(),
  usage = 'agent-ergonomics worktree-new',
): WorktreeResult {
  const git = makeGit(cwd);
  const remote = options.remote ?? 'origin';
  const lines: string[] = [];
  const fail = (message: string): WorktreeResult => ({
    ok: false,
    lines: [...lines, `✖ ${message}`],
  });

  const { branch } = options;
  if (!branch) return fail(`name the branch: ${usage} <branch>`);
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
        options.worktreesDir ?? 'worktrees',
        `${basename(mainCheckout)}-${branch.replaceAll('/', '-')}`,
      );
  if (existsSync(path)) return fail(`${path} already exists.`);

  const fetched = git('fetch', '--quiet', remote, options.base);
  if (!fetched.ok) {
    return fail(`git fetch ${remote} ${options.base} failed: ${fetched.err}`);
  }
  const base = `${remote}/${options.base}`;

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

/** `worktree-new <branch> [--base <name>] [--path <dir>] [--no-install]` */
export const runWorktreeNew: Command = (args, { config, cwd, io }) => {
  const options = parseWorktreeArgs(args, {
    base: config.git.defaultBase,
    remote: config.git.remote,
    worktreesDir: config.git.worktreesDir,
  });
  const result = createWorktree(
    options,
    cwd,
    `${config.commands.worktreeNew} --`,
  );
  io.log(result.lines.join('\n'));
  if (!result.ok || !result.path) return 1;

  if (options.install && config.git.install.length > 0) {
    io.log('Installing dependencies…');
    const [command, ...installArgs] = config.git.install;
    const install = spawnSync(command as string, installArgs, {
      cwd: result.path,
      stdio: 'inherit',
    });
    if (install.status !== 0) {
      io.error(
        `✖ ${config.git.install.join(' ')} failed in ${result.path}; the worktree is there, run it again by hand.`,
      );
      return install.status ?? 1;
    }
  }
  io.log(
    `Next:\n    cd ${result.path}\nRemove it when the branch is merged:\n    git worktree remove ${result.path}`,
  );
  return 0;
};
