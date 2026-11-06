import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The rules themselves are covered in packages/agent-ergonomics/tests/
// commit-msg.test.ts. This runs the hook's real entry point, so it covers the
// wiring: scripts/check-commit-msg.ts loading this repo's config, whose hint
// for a vague subject differs from the package default.
async function check(subject: string) {
  const file = path.join(
    tmpdir(),
    `commit-msg-${Math.random().toString(36).slice(2)}.txt`,
  );
  await fs.writeFile(file, subject);
  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'scripts/check-commit-msg.ts', file],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
  return {
    code: proc.exitCode ?? 0,
    stderr: await new Response(proc.stderr).text(),
  };
}

test('the commit-msg hook applies this repo config', async () => {
  const vague = await check('fixes');
  expect(vague.code).toBe(1);
  expect(vague.stderr).toContain('preceded repeated fix flurries');
  expect((await check('update audio handler')).code).toBe(1);
  expect((await check('fix(audio): close context on unmount')).code).toBe(0);
});
