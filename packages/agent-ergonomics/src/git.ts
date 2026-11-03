/**
 * A git runner bound to a directory, shared by the branch helpers: returns
 * exit status and trimmed output instead of throwing, so each helper can
 * explain a refusal in its own words.
 */
import { spawnSync } from 'node:child_process';

export type GitResult = { ok: boolean; out: string; err: string };

export function makeGit(cwd: string) {
  return (...args: string[]): GitResult => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return {
      ok: result.status === 0,
      out: (result.stdout ?? '').trim(),
      err: (result.stderr ?? '').trim(),
    };
  };
}
