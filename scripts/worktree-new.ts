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
import {
  parseWorktreeArgs,
  resolveConfig,
  runCli,
  type WorktreeOptions,
  createWorktree as worktree,
} from 'agent-ergonomics';
import stimsConfig from '../agent-ergonomics.config.ts';

export type { WorktreeResult } from 'agent-ergonomics';

const config = resolveConfig(stimsConfig);
export const parseArgs = (argv: string[]) =>
  parseWorktreeArgs(argv, {
    base: config.git.defaultBase,
    remote: config.git.remote,
    worktreesDir: config.git.worktreesDir,
  });
export const createWorktree = (options: WorktreeOptions, cwd = process.cwd()) =>
  worktree(options, cwd, `${config.commands.worktreeNew} --`);

if (import.meta.main)
  process.exit(await runCli(['worktree-new', ...process.argv.slice(2)]));
