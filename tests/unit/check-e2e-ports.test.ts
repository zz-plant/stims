/**
 * Behavioural coverage for the e2e dev-server port guard.
 *
 * The first test pins the defect that prompted it: agent-boot-smoke and
 * flash-sampler-readback both declared port 5186, and the local e2e runner
 * runs two files at once. These run the actual script against fixture
 * directories, so the test cannot drift from the guard the gate runs.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const suite = (port: number | null) =>
  [
    "import { startDevServer } from './dev-server.ts';",
    port === null ? '' : `const TEST_PORT = ${port};`,
    'await startDevServer({ port: 5000 + 1 });',
  ].join('\n');

function runGuard(files: Record<string, string>): {
  code: number;
  output: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-ports-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'scripts/check-e2e-ports.ts', dir],
      cwd: process.cwd(),
    });
    return {
      code: result.exitCode ?? 1,
      output:
        new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check:e2e-ports', () => {
  test('rejects two suites that claim the same port, naming both', () => {
    const { code, output } = runGuard({
      'agent-boot-smoke.test.ts': suite(5186),
      'flash-sampler-readback.test.ts': suite(5186),
    });
    expect(code).toBe(1);
    expect(output).toContain('port 5186 is claimed by');
    expect(output).toContain('agent-boot-smoke.test.ts');
    expect(output).toContain('flash-sampler-readback.test.ts');
  });

  test('rejects a suite whose port it cannot see', () => {
    const { code, output } = runGuard({
      'inline-port.test.ts': suite(null),
    });
    expect(code).toBe(1);
    expect(output).toContain('inline-port.test.ts starts a dev server');
  });

  test('accepts distinct ports and ignores files that start no server', () => {
    const { code, output } = runGuard({
      'a.test.ts': suite(5180),
      'b.test.ts': suite(5181),
      'pure.test.ts': 'const TEST_PORT = 5180;\n',
    });
    expect(code).toBe(0);
    expect(output).toContain('5180');
    expect(output).toContain('5181');
  });
});
