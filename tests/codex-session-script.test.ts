import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('codex session script prints a review profile plan', () => {
  const result = spawnSync(
    'bash',
    [
      'scripts/codex-session.sh',
      '--print-plan',
      '--profile',
      'review',
      '--skip-models',
      '--skip-dev-server',
      '--skip-watch',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Profile: review');
  expect(result.stdout).toContain('Local models: skipped');
  expect(result.stdout).toContain('Dev server: skipped');
  expect(result.stdout).toContain('Watcher: skipped');
});
