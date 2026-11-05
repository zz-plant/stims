/**
 * Decides how the lefthook git hooks get installed for the checkout it runs
 * in, and puts them back when they have gone missing.
 *
 * A linked worktree (`git worktree add`) shares its repository's hooks: they
 * live at core.hooksPath, or the common .git/hooks, which the main checkout's
 * install already wrote. lefthook refuses to install into a hooks path outside
 * the checkout it runs from, so `bun install` in every new worktree used to end
 * in a failed postinstall. Here a worktree reuses installed hooks, and installs
 * with `--force` only when none exist yet. The main checkout forces too when
 * core.hooksPath points somewhere custom, for the same refusal.
 *
 * Hooks can vanish with no install to bring them back. Clones from the husky
 * era keep core.hooksPath at `.husky/_` inside the working tree, where the
 * shims were tracked until #1655. Pulling that commit deleted them, and so does
 * a checkout round trip through any older commit. Git then runs no hooks and
 * says nothing, so the quality gate calls `restoreGitHooks` before its steps.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type HookInstallPlan = {
  action: 'install' | 'install-force' | 'reuse' | 'skip';
  hooksDir: string | null;
};

/** The hooks lefthook.yml defines. One install writes them all. */
const HOOK_NAMES = ['pre-commit', 'commit-msg'];

const hooksInstalled = (hooksDir: string) =>
  HOOK_NAMES.every((name) => existsSync(join(hooksDir, name)));

export function planHookInstall(cwd = process.cwd()): HookInstallPlan {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

  let gitDir: string;
  let commonDir: string;
  let hooksDir: string;
  try {
    gitDir = git('rev-parse', '--path-format=absolute', '--git-dir');
    commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
    hooksDir = git(
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'hooks',
    );
  } catch {
    // Not a git checkout (an unpacked tarball): there is nowhere to install.
    return { action: 'skip', hooksDir: null };
  }

  if (gitDir === commonDir) {
    // lefthook refuses a custom core.hooksPath (a husky leftover on older
    // clones) unless forced, which failed every `bun install` in the main
    // checkout. Install where git actually looks for hooks.
    const customHooksPath = hooksDir !== join(gitDir, 'hooks');
    return { action: customHooksPath ? 'install-force' : 'install', hooksDir };
  }
  if (hooksInstalled(hooksDir)) {
    return { action: 'reuse', hooksDir };
  }
  return { action: 'install-force', hooksDir };
}

export type RestoreOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** The command that runs lefthook. */
  lefthook?: string[];
  log?: (line: string) => void;
};

/**
 * Reinstalls the hooks if git's hooks directory for this checkout lacks any of
 * them. Skipped in CI and under LEFTHOOK=0, which never install hooks. A failed
 * install only warns: the gate should still report on the code, and its
 * dead-code step fails on the unused lefthook for as long as hooks are absent.
 */
export function restoreGitHooks({
  cwd = process.cwd(),
  env = process.env,
  lefthook = ['bunx', 'lefthook'],
  log = console.error,
}: RestoreOptions = {}): 'skipped' | 'present' | 'restored' | 'failed' {
  if (env.CI || env.LEFTHOOK === '0') return 'skipped';
  const { action, hooksDir } = planHookInstall(cwd);
  if (hooksDir === null) return 'skipped';
  if (hooksInstalled(hooksDir)) return 'present';

  const [command, ...args] = lefthook as [string, ...string[]];
  const force = action === 'install-force' ? ['--force'] : [];
  try {
    execFileSync(command, [...args, 'install', ...force], {
      cwd,
      stdio: 'pipe',
    });
  } catch (error) {
    log(
      `[hooks] git hooks are missing from ${hooksDir} and reinstalling them failed: ${String(error)}\n[hooks] Commits run no local checks until \`bun install\` succeeds.`,
    );
    return 'failed';
  }
  log(`[hooks] git hooks were missing from ${hooksDir}; reinstalled them.`);
  return 'restored';
}
