/**
 * Behavioural coverage for the dependency-overrides guard.
 *
 * The first test is the defect that prompted it: the package.json main had
 * before #1732, where #1426 and #1557 raised three @codemirror dependencies
 * and left their overrides behind, and Dependabot then failed with
 * NoChangeError. Each test runs the actual script against a fixture manifest,
 * so the test cannot drift from the guard the gate runs.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runGuard(manifest: object): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dependency-overrides-'));
  try {
    const path = join(dir, 'package.json');
    writeFileSync(path, JSON.stringify(manifest, null, 2));
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'scripts/check-dependency-overrides.ts', path],
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

describe('check:dependency-overrides', () => {
  test('rejects the pre-#1732 @codemirror overrides, naming both values and the fix', () => {
    const { code, output } = runGuard({
      dependencies: {
        '@codemirror/autocomplete': '6.20.4',
        '@codemirror/language': '6.13.1',
        '@codemirror/state': '6.7.6',
        '@codemirror/view': '6.43.15',
      },
      overrides: {
        '@codemirror/language': '6.12.4',
        '@codemirror/view': '6.43.13',
        '@codemirror/state': '6.7.6',
        '@codemirror/autocomplete': '6.20.3',
      },
    });
    expect(code).toBe(1);
    expect(output).toContain(
      'overrides disagree with the declared versions (3)',
    );
    expect(output).toContain(
      '@codemirror/view: dependencies says 6.43.15, overrides says 6.43.13',
    );
    expect(output).toContain(
      'fix: set "@codemirror/view": "6.43.15" in overrides, then run `bun install`',
    );
    expect(output).toContain(
      '@codemirror/language: dependencies says 6.13.1, overrides says 6.12.4',
    );
    expect(output).toContain(
      '@codemirror/autocomplete: dependencies says 6.20.4, overrides says 6.20.3',
    );
    // The one that agreed is not reported.
    expect(output).not.toContain('@codemirror/state:');
  });

  test('rejects a devDependency bumped without its override', () => {
    const { code, output } = runGuard({
      devDependencies: { zod: '4.6.7' },
      overrides: { zod: '4.6.6' },
    });
    expect(code).toBe(1);
    expect(output).toContain(
      'zod: devDependencies says 4.6.7, overrides says 4.6.6',
    );
    expect(output).toContain('fix: set "zod": "4.6.7" in overrides');
  });

  test('rejects an override range the declared version merely satisfies', () => {
    // bun keeps a locked 6.43.13 under `^6.43.13` after the declaration moves
    // to 6.43.15, because the lock still matches the override.
    const { code, output } = runGuard({
      dependencies: { '@codemirror/view': '6.43.15' },
      overrides: { '@codemirror/view': '^6.43.13' },
    });
    expect(code).toBe(1);
    expect(output).toContain(
      '@codemirror/view: dependencies says 6.43.15, overrides says ^6.43.13',
    );
  });

  test('rejects drift in resolutions, which bun reads as overrides', () => {
    const { code, output } = runGuard({
      dependencies: { react: '19.3.1' },
      resolutions: { react: '19.3.0' },
    });
    expect(code).toBe(1);
    expect(output).toContain(
      'react: dependencies says 19.3.1, resolutions says 19.3.0',
    );
    expect(output).toContain('fix: set "react": "19.3.1" in resolutions');
  });

  test('accepts matching pins, matching ranges, $ references and transitive-only floors', () => {
    const { code, output } = runGuard({
      dependencies: {
        '@codemirror/state': '6.7.6',
        '@codemirror/view': '6.43.15',
      },
      devDependencies: { sharp: '^0.35.5', zod: '4.6.7' },
      overrides: {
        '@codemirror/state': '6.7.6',
        '@codemirror/view': '$@codemirror/view',
        sharp: '^0.35.5',
        zod: '4.6.7',
        // Declared by nothing at the root: a floor on a transitive copy.
        undici: '^7.30.1',
      },
    });
    expect(code).toBe(0);
    expect(output).toContain('4 overrides of declared packages match');
  });
});
