import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();

function runRunner(files: string[], extraArgs: string[], env: object = {}) {
  // `--bail` is inert under CI, so the runner must be exercised without it.
  const { CI: _ci, STIMS_NO_BAIL: _nb, ...baseEnv } = process.env;
  const proc = Bun.spawnSync(
    ['bun', 'run', 'scripts/run-tests.ts', ...extraArgs, ...files],
    { cwd: ROOT, env: { ...baseEnv, ...env }, stdout: 'pipe', stderr: 'pipe' },
  );
  return proc.stdout.toString() + proc.stderr.toString();
}

describe('scripts/run-tests.ts bail behaviour', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stims-no-bail-'));
  const fixture = (name: string, value: number) => {
    const file = join(dir, `${name}.test.ts`);
    writeFileSync(
      file,
      `import { expect, test } from 'bun:test';\ntest('fixture ${name}', () => expect(1).toBe(${value}));\n`,
    );
    return file;
  };
  const files = [fixture('a', 2), fixture('b', 3)];

  test('stops at the first failing file by default', () => {
    const out = runRunner(files, []);
    expect(out).toContain('fixture a');
    expect(out).not.toContain('fixture b');
    expect(out).toContain('Bailed out');
  });

  test('--no-bail reports every failure', () => {
    const out = runRunner(files, ['--no-bail']);
    expect(out).toContain('fixture a');
    expect(out).toContain('fixture b');
    expect(out).not.toContain('Bailed out');
  });

  test('STIMS_NO_BAIL=1 does the same without a flag', () => {
    const out = runRunner(files, [], { STIMS_NO_BAIL: '1' });
    expect(out).toContain('fixture b');
    expect(out).not.toContain('Bailed out');
  });

  test('cleanup', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
