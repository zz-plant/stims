import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('codex model route prints a review plan without executing helpers', () => {
  const result = spawnSync(
    'bash',
    [
      'scripts/codex-model-route.sh',
      '--mode',
      'review',
      '--print-plan',
      '--no-exec',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: '/usr/bin:/bin',
      },
    },
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('lmstudio-ensure-model quality');
  expect(result.stdout).toContain('quality local model role');
});
