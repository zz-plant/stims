import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const run = (...args: string[]) =>
  execFileSync('bun', ['run', 'scripts/scripts-list.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });

describe('bun run help --for', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const source = readFileSync(join(ROOT, 'scripts/scripts-list.ts'), 'utf8');

  test('every curated route points at a script that exists', () => {
    // The routing table is hand-maintained and check:doc-references does not
    // cover it, so a renamed script would silently route people nowhere.
    const table = source.slice(
      source.indexOf('const ROUTES'),
      source.indexOf('const forIndex'),
    );
    const named = [...table.matchAll(/run: \[([^\]]+)\]/gu)].flatMap((match) =>
      [...match[1].matchAll(/'([^']+)'/gu)].map((inner) => inner[1]),
    );

    expect(named.length).toBeGreaterThan(0);
    const missing = named.filter((name) => !pkg.scripts?.[name]);
    expect(missing).toEqual([]);
  });

  test('routes a fidelity symptom to the parity instruments, not to a unit test', () => {
    const out = run('--for', 'my preset looks wrong');
    expect(out).toContain('parity:capture');
    expect(out).toContain('parity:diff');
  });

  test('routes a backend-divergence symptom to the differential lab', () => {
    expect(run('--for', 'webgpu and webgl differ')).toContain(
      'lab:gpu-differential',
    );
  });

  test('falls back to keyword matches when no route is curated', () => {
    const out = run('--for', 'how do i deploy to cloudflare');
    expect(out).toContain('No curated route');
  });

  test('points an unmatched query at the onboarding docs', () => {
    const out = run('--for', 'qqqq zzzz');
    expect(out).toContain('docs/ONBOARDING.md');
  });

  test('--for with no query exits non-zero', () => {
    expect(() => run('--for')).toThrow();
  });
});
