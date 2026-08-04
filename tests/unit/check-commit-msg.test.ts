import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function writeMsg(subject: string): Promise<string> {
  const file = path.join(
    tmpdir(),
    `commit-msg-${Math.random().toString(36).slice(2)}.txt`,
  );
  await fs.writeFile(file, subject);
  return file;
}

async function check(subject: string): Promise<number> {
  const file = await writeMsg(subject);
  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'scripts/check-commit-msg.ts', file],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
  return proc.exitCode ?? 0;
}

describe('check-commit-msg', () => {
  test('rejects non-descriptive subjects', async () => {
    for (const bad of [
      'fixes',
      'fixed',
      'stims',
      'Various fixes',
      'certainly this works',
      'hopefully works',
    ]) {
      expect(await check(bad)).toBe(1);
    }
  });

  test('rejects missing conventional-commits prefix', async () => {
    expect(await check('update audio handler')).toBe(1);
    expect(await check('Fix the leak')).toBe(1);
  });

  test('rejects subjects over 72 chars', async () => {
    expect(
      await check(
        'fix: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(1);
  });

  test('accepts valid conventional commits', async () => {
    expect(await check('fix(audio): close context on unmount')).toBe(0);
    expect(await check('feat: add mobile viewport matrix')).toBe(0);
    expect(await check('refactor(renderer): split warp template')).toBe(0);
    expect(await check('ci: gate shader parity on preset changes')).toBe(0);
  });
});
