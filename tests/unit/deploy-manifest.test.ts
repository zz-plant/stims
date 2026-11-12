/**
 * Behavioural coverage for scripts/write-deploy-manifest.ts, which `site:build`
 * runs last so /deploy-manifest.json names the commit a deploy serves.
 *
 * Each test runs the actual script into a temporary directory, with the
 * environment Workers Builds gives it or without, so the test cannot drift
 * from what the build runs.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeManifest(commit: string | undefined) {
  const outputDir = mkdtempSync(join(tmpdir(), 'stims-deploy-manifest-'));
  tempDirs.push(outputDir);
  const env: Record<string, string | undefined> = {
    ...process.env,
    DEPLOY_OUTPUT_DIR: outputDir,
  };
  // Workers Builds runs the tests too (site:build:gated), with its own
  // commit in the environment; the fallback case must not inherit it.
  delete env.WORKERS_CI_COMMIT_SHA;
  if (commit !== undefined) env.WORKERS_CI_COMMIT_SHA = commit;
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', 'scripts/write-deploy-manifest.ts'],
    cwd: process.cwd(),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const manifestPath = join(outputDir, 'deploy-manifest.json');
  return {
    code: result.exitCode,
    output: `${result.stdout.toString()}\n${result.stderr.toString()}`,
    manifestPath,
    read: () => readFileSync(manifestPath, 'utf8'),
  };
}

describe('write-deploy-manifest', () => {
  test('publishes the Workers Builds commit', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const { code, output, read } = writeManifest(commit);

    expect(output).not.toContain('Invalid');
    expect(code).toBe(0);
    expect(read()).toBe(`{"commit":"${commit}"}\n`);
    expect(JSON.parse(read())).toEqual({ commit });
  });

  test('falls back to the checked-out commit outside Workers Builds', () => {
    const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      stdout: 'pipe',
    })
      .stdout.toString()
      .trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);

    const { code, read } = writeManifest(undefined);

    expect(code).toBe(0);
    expect(JSON.parse(read())).toEqual({ commit: head });
  });

  test('fails the build on a malformed commit and writes nothing', () => {
    const { code, output, manifestPath } = writeManifest('0123456789abcdef');

    expect(code).toBe(1);
    expect(output).toContain(
      'Invalid deployment commit SHA: "0123456789abcdef"',
    );
    expect(existsSync(manifestPath)).toBe(false);
  });
});
