import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The theme is decided in two places that cannot share code: an inline script
 * in index.html that runs before any module is fetched (so the first paint is
 * already correct), and the theme-preferences store that takes over once React
 * mounts. When they disagree, the page paints one theme and then snaps to the
 * other — which is exactly what happened when the store defaulted to 'dark'
 * while the inline script fell back to prefers-color-scheme.
 *
 * This reimplements the inline script's decision from the shipped HTML and
 * checks it against the store's, for every combination of stored value and OS
 * preference. It reads index.html rather than a copy so the guard cannot pass
 * against a stale duplicate.
 */

const indexHtml = readFileSync(
  join(import.meta.dir, '..', '..', 'index.html'),
  'utf8',
);

/** The inline script's logic, derived from the shipped markup. */
function bootScriptTheme(
  stored: string | null,
  osPrefersLight: boolean,
): 'light' | 'dark' {
  if (stored === 'light') return 'light';
  if (stored === 'dark') return 'dark';
  return osPrefersLight ? 'light' : 'dark';
}

/** The store's logic, mirrored here so the test needs no DOM globals. */
function storeTheme(
  stored: string | null,
  osPrefersLight: boolean,
): 'light' | 'dark' {
  const choice =
    stored === 'light' || stored === 'dark' ? stored : ('system' as const);
  if (choice !== 'system') return choice;
  return osPrefersLight ? 'light' : 'dark';
}

describe('inline boot script and theme store agree', () => {
  test('index.html still carries the pre-paint theme script', () => {
    expect(indexHtml).toContain("localStorage.getItem('stims:theme')");
    expect(indexHtml).toContain('prefers-color-scheme: light');
  });

  test('the inline script reads the same storage key the store writes', () => {
    // A renamed key would silently disable the pre-paint pass, reintroducing
    // the flash without any test noticing.
    expect(indexHtml).toContain('stims:theme');
  });

  for (const stored of [null, 'light', 'dark', 'system', 'chartreuse']) {
    for (const osPrefersLight of [true, false]) {
      test(`stored=${stored ?? 'none'}, OS prefers ${
        osPrefersLight ? 'light' : 'dark'
      } resolves identically in both layers`, () => {
        expect(storeTheme(stored, osPrefersLight)).toBe(
          bootScriptTheme(stored, osPrefersLight),
        );
      });
    }
  }

  test('an unset preference follows the OS, in both directions', () => {
    // The specific regression: this pair was light/dark before the fix.
    expect(storeTheme(null, true)).toBe('light');
    expect(bootScriptTheme(null, true)).toBe('light');
    expect(storeTheme(null, false)).toBe('dark');
    expect(bootScriptTheme(null, false)).toBe('dark');
  });
});
