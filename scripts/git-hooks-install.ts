/**
 * Decides how `bun install` should install the lefthook git hooks for the
 * checkout it runs in.
 *
 * A linked worktree (`git worktree add`) shares its repository's hooks: they
 * live at core.hooksPath, or the common .git/hooks, which the main checkout's
 * install already wrote. lefthook refuses to install into a hooks path outside
 * the checkout it runs from, so `bun install` in every new worktree used to end
 * in a failed postinstall. Here a worktree reuses installed hooks, and installs
 * with `--force` only when none exist yet.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type HookInstallPlan = {
  action: 'install' | 'install-force' | 'reuse' | 'skip';
  hooksDir: string | null;
};

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

  if (gitDir === commonDir) return { action: 'install', hooksDir };
  if (existsSync(join(hooksDir, 'pre-commit'))) {
    return { action: 'reuse', hooksDir };
  }
  return { action: 'install-force', hooksDir };
}
