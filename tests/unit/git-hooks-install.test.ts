import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  planHookInstall,
  restoreGitHooks,
} from '../../scripts/git-hooks-install.ts';

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

/** A checkout with one commit whose hooks directory is explicit, so the
 * machine's git config cannot leak in. */
function scenario() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'stims-hooks-')));
  roots.push(root);
  const clone = join(root, 'stims');
  git(root, 'init', '-q', '-b', 'main', clone);
  git(clone, 'config', 'user.email', 't@example.com');
  git(clone, 'config', 'user.name', 'T');
  git(clone, 'config', 'commit.gpgsign', 'false');
  const hooksDir = join(root, 'hooks');
  mkdirSync(hooksDir);
  git(clone, 'config', 'core.hooksPath', hooksDir);
  writeFileSync(join(clone, 'README.md'), 'base\n');
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'init');
  return { root, clone, hooksDir };
}

describe('postinstall hook plan', () => {
  test('installs in the main checkout, and a worktree reuses installed hooks', () => {
    const { root, clone, hooksDir } = scenario();
    // lefthook refuses a custom core.hooksPath without --force; plain
    // `install` here failed every `bun install` on a clone carrying one.
    expect(planHookInstall(clone)).toEqual({
      action: 'install-force',
      hooksDir,
    });
    const defaultHooksDir = join(clone, '.git', 'hooks');
    git(clone, 'config', 'core.hooksPath', defaultHooksDir);
    expect(planHookInstall(clone)).toEqual({
      action: 'install',
      hooksDir: defaultHooksDir,
    });
    git(clone, 'config', 'core.hooksPath', hooksDir);

    const worktree = join(root, 'wt');
    git(clone, 'worktree', 'add', '-q', '--detach', worktree);
    // No hooks installed yet: lefthook must be told to write into a hooks
    // path outside the worktree.
    expect(planHookInstall(worktree)).toEqual({
      action: 'install-force',
      hooksDir,
    });

    // One hook without the other is not an install to reuse.
    writeFileSync(join(hooksDir, 'pre-commit'), '#!/bin/sh\n');
    expect(planHookInstall(worktree)).toEqual({
      action: 'install-force',
      hooksDir,
    });

    writeFileSync(join(hooksDir, 'commit-msg'), '#!/bin/sh\n');
    expect(planHookInstall(worktree)).toEqual({ action: 'reuse', hooksDir });
  });

  test('skips outside a git checkout', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'stims-no-git-')));
    roots.push(dir);
    expect(existsSync(join(dir, '.git'))).toBe(false);
    expect(planHookInstall(dir).action).toBe('skip');
  });
});

describe('restoring missing hooks', () => {
  const lefthook = [
    process.execPath,
    resolve(import.meta.dir, '../../node_modules/lefthook/bin/index.js'),
  ];
  const quiet = () => {};
  const LONG_TEST = 30_000;

  /** The environment outside a CI run or a LEFTHOOK=0 shell: hooks switched on. */
  function hooksOnEnv(): Record<string, string | undefined> {
    const {
      CI: _ci,
      LEFTHOOK: _lefthook,
      ...env
    } = process.env as Record<string, string | undefined>;
    return env;
  }

  function commit(cwd: string, subject: string) {
    return spawnSync('git', ['commit', '-q', '--allow-empty', '-m', subject], {
      cwd,
      encoding: 'utf8',
      env: hooksOnEnv(),
    }).status;
  }

  /**
   * A clone on the commit that tracks lefthook's shims at core.hooksPath, the
   * way a clone stood before #1655, plus the commit that untracks them.
   */
  function huskyEraClone() {
    const { root, clone } = scenario();
    git(clone, 'config', 'core.hooksPath', '.husky/_');
    writeFileSync(
      join(clone, 'lefthook.yml'),
      "commit-msg:\n  commands:\n    subject:\n      run: grep -q '^fix' {1}\n",
    );
    expect(restoreGitHooks({ cwd: clone, env: {}, lefthook, log: quiet })).toBe(
      'restored',
    );
    git(clone, 'add', '-A');
    git(clone, 'commit', '-q', '-m', 'fix: track the shims');
    const tracked = git(clone, 'rev-parse', 'HEAD');
    expect(commit(clone, 'bad subject')).not.toBe(0);

    git(clone, 'rm', '-rq', '.husky');
    writeFileSync(join(clone, '.gitignore'), '/.husky/\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-q', '-m', 'fix: untrack the shims');
    return { root, clone, tracked, untracked: git(clone, 'rev-parse', 'HEAD') };
  }

  test(
    'a pull that deletes tracked shims stops the hooks until the restore runs',
    () => {
      const { clone, tracked, untracked } = huskyEraClone();
      git(clone, 'checkout', '-q', '--detach', tracked);
      git(clone, 'merge', '-q', '--ff-only', untracked);
      expect(existsSync(join(clone, '.husky/_/commit-msg'))).toBe(false);
      expect(commit(clone, 'slips through')).toBe(0);

      expect(
        restoreGitHooks({ cwd: clone, env: {}, lefthook, log: quiet }),
      ).toBe('restored');

      expect(commit(clone, 'bad subject')).not.toBe(0);
      expect(commit(clone, 'fix: a good subject')).toBe(0);
      expect(git(clone, 'config', 'core.hooksPath')).toBe('.husky/_');
      expect(git(clone, 'status', '--short')).toBe('');
    },
    LONG_TEST,
  );

  test(
    'a branch round trip through an older commit is repaired the same way',
    () => {
      const { clone, tracked, untracked } = huskyEraClone();
      restoreGitHooks({ cwd: clone, env: {}, lefthook, log: quiet });
      git(clone, 'checkout', '-q', '--detach', tracked);
      git(clone, 'checkout', '-q', '--detach', untracked);
      expect(commit(clone, 'slips through')).toBe(0);

      expect(
        restoreGitHooks({ cwd: clone, env: {}, lefthook, log: quiet }),
      ).toBe('restored');
      expect(commit(clone, 'bad subject')).not.toBe(0);
    },
    LONG_TEST,
  );

  test(
    'a worktree pinned to the main checkout writes the hooks there',
    () => {
      const { root, clone, untracked } = huskyEraClone();
      const worktree = join(root, 'wt');
      git(clone, 'worktree', 'add', '-q', '--detach', worktree, untracked);
      git(clone, 'config', 'extensions.worktreeConfig', 'true');
      const hooksDir = join(clone, '.husky/_');
      git(worktree, 'config', '--worktree', 'core.hooksPath', hooksDir);
      writeFileSync(
        join(worktree, 'lefthook.yml'),
        readFileSync(join(clone, 'lefthook.yml')),
      );
      rmSync(hooksDir, { recursive: true, force: true });
      expect(commit(worktree, 'slips through')).toBe(0);

      expect(
        restoreGitHooks({ cwd: worktree, env: {}, lefthook, log: quiet }),
      ).toBe('restored');

      expect(existsSync(join(hooksDir, 'commit-msg'))).toBe(true);
      expect(existsSync(join(worktree, '.husky/_/commit-msg'))).toBe(false);
      expect(commit(worktree, 'bad subject')).not.toBe(0);
    },
    LONG_TEST,
  );

  test(
    'the quality gate restores hooks before its first step',
    () => {
      const { root, clone } = scenario();
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const calls = join(root, 'bunx-calls');
      writeFileSync(join(bin, 'bunx'), `#!/bin/sh\necho "$*" >> "${calls}"\n`, {
        mode: 0o755,
      });
      const env = { ...hooksOnEnv(), PATH: `${bin}:${process.env.PATH}` };

      // The steps fail at once in a repo with no scripts; only the order counts.
      spawnSync(
        process.execPath,
        [
          resolve(import.meta.dir, '../../scripts/run-quality-gate.ts'),
          '--quick',
          '--serial',
        ],
        { cwd: clone, env, encoding: 'utf8' },
      );

      expect(readFileSync(calls, 'utf8').split('\n')[0]).toBe(
        'lefthook install --force',
      );
    },
    LONG_TEST,
  );

  test('leaves installed hooks alone', () => {
    const { clone, hooksDir } = scenario();
    writeFileSync(join(hooksDir, 'pre-commit'), 'mine\n');
    writeFileSync(join(hooksDir, 'commit-msg'), 'mine\n');
    expect(restoreGitHooks({ cwd: clone, env: {}, lefthook, log: quiet })).toBe(
      'present',
    );
    expect(readFileSync(join(hooksDir, 'commit-msg'), 'utf8')).toBe('mine\n');
  });

  test.each([{ CI: '1' }, { CI: 'true' }, { LEFTHOOK: '0' }])(
    'installs nothing under %p',
    (env) => {
      const { clone, hooksDir } = scenario();
      expect(restoreGitHooks({ cwd: clone, env, lefthook, log: quiet })).toBe(
        'skipped',
      );
      expect(existsSync(join(hooksDir, 'commit-msg'))).toBe(false);
    },
  );

  test('skips outside a git checkout', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'stims-no-git-')));
    roots.push(dir);
    expect(restoreGitHooks({ cwd: dir, env: {}, lefthook, log: quiet })).toBe(
      'skipped',
    );
  });

  test('a failed install warns with the fix and does not throw', () => {
    const { clone, hooksDir } = scenario();
    const lines: string[] = [];
    expect(
      restoreGitHooks({
        cwd: clone,
        env: {},
        lefthook: [join(hooksDir, 'no-such-lefthook')],
        log: (line) => lines.push(line),
      }),
    ).toBe('failed');
    expect(lines.join('\n')).toContain(hooksDir);
    expect(lines.join('\n')).toContain('bun install');
  });
});
