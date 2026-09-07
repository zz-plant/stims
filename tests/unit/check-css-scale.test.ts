/**
 * Behavioural coverage for the radius/type scale guard.
 *
 * The guard shipped with a hole: its radius pattern only matched a literal
 * sitting immediately after `border-radius:`, so a shorthand that led with a
 * token hid every value after it. `border-radius: var(--radius-xl) 18px 0 0`
 * passed, in the very commit that introduced the check — and it was a real
 * defect, a bottom sheet whose two top corners had ended up different sizes.
 *
 * These run the actual script against fixture stylesheets rather than
 * re-implementing its matching, so the test cannot drift from the guard the
 * quality gate runs.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runGuard(css: string): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'css-scale-'));
  try {
    writeFileSync(join(dir, 'fixture.css'), css);
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'scripts/check-css-scale.ts', dir],
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

describe('check:css-scale', () => {
  test('accepts values that sit on the scale', () => {
    const { code } = runGuard(
      `.a { border-radius: 10px; font-size: 0.875rem; }
       .b { border-radius: var(--radius-lg); }
       .c { border-radius: 50%; }
       .d { border-radius: 14px 14px 0 0; }`,
    );
    expect(code).toBe(0);
  });

  test('rejects an off-scale radius in the leading position', () => {
    const { code, output } = runGuard('.a { border-radius: 18px; }');
    expect(code).toBe(1);
    expect(output).toContain('18px');
  });

  test('rejects an off-scale radius after a token in a shorthand', () => {
    // The exact shape that slipped through: the guard used to stop reading
    // after the first value, so a leading var() hid everything behind it.
    const { code, output } = runGuard(
      '.a { border-radius: var(--radius-xl) 18px 0 0; }',
    );
    expect(code).toBe(1);
    expect(output).toContain('18px');
  });

  test('rejects an off-scale radius in the elliptical half of a shorthand', () => {
    const { code, output } = runGuard(
      '.a { border-radius: 10px 10px 0 0 / 10px 10px 0 7px; }',
    );
    expect(code).toBe(1);
    expect(output).toContain('7px');
  });

  test('ignores lengths inside calc(), which are operands not corners', () => {
    // Concentric corners: the inner radius is derived from the outer one and
    // the literal is the gap between them, so it is on the scale by
    // construction.
    const { code } = runGuard(
      '.a { border-radius: calc(var(--ctl-radius) - 3px); }',
    );
    expect(code).toBe(0);
  });

  test('rejects a font size below the floor', () => {
    const { code, output } = runGuard('.a { font-size: 0.62rem; }');
    expect(code).toBe(1);
    expect(output).toContain('0.6875rem');
  });

  test('ignores values inside comments', () => {
    const { code } = runGuard('/* border-radius: 18px; */ .a { color: red; }');
    expect(code).toBe(0);
  });
});
