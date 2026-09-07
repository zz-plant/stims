import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveTheme,
  type ThemeChoice,
} from '../../src/js/core/theme-preferences.ts';

/**
 * The theme is decided in two places that cannot share code: an inline script
 * in index.html that runs before any module is fetched (so the first paint is
 * already correct), and the theme-preferences store that takes over once React
 * mounts. When they disagree, the page paints one theme and then snaps to the
 * other — which is exactly what happened when the store defaulted to 'dark'
 * while the inline script fell back to prefers-color-scheme.
 *
 * This EXECUTES the shipped inline script — extracted from index.html and run
 * against stubbed localStorage / matchMedia / documentElement — and checks its
 * decision against the real `resolveTheme` from the store module, for every
 * combination of stored value and OS preference. An earlier version of this
 * file re-implemented both sides inside the test and compared the two copies,
 * which could not catch either real implementation changing.
 */

const indexHtml = readFileSync(
  join(import.meta.dir, '..', '..', 'index.html'),
  'utf8',
);

/** The shipped pre-paint script, located by the storage key it reads. */
function extractBootScript(): string {
  const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
  const boot = scripts.find((s) =>
    s.includes("localStorage.getItem('stims:theme')"),
  );
  if (!boot) throw new Error('pre-paint theme script not found in index.html');
  return boot;
}

/** Runs the real inline script and reports the class it applied. */
function runBootScript(
  stored: string | null,
  osPrefersLight: boolean,
): 'light' | 'dark' {
  const classes = new Set<string>();
  const sandbox = {
    localStorage: {
      getItem: (key: string) => (key === 'stims:theme' ? stored : null),
    },
    window: {
      matchMedia: (query: string) => ({
        matches: query.includes('light') ? osPrefersLight : !osPrefersLight,
      }),
    },
    document: {
      documentElement: { classList: { add: (c: string) => classes.add(c) } },
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('localStorage', 'window', 'document', extractBootScript())(
    sandbox.localStorage,
    sandbox.window,
    sandbox.document,
  );
  // No class applied means the page keeps its default (dark) styling.
  return classes.has('light') ? 'light' : 'dark';
}

function storeThemeFor(
  stored: string | null,
  osPrefersLight: boolean,
): 'light' | 'dark' {
  const previous = globalThis.matchMedia;
  (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({
    matches: query.includes('light') ? osPrefersLight : !osPrefersLight,
  });
  try {
    const choice: ThemeChoice =
      stored === 'light' || stored === 'dark' ? stored : 'system';
    return resolveTheme({ theme: choice });
  } finally {
    if (previous)
      (globalThis as { matchMedia?: unknown }).matchMedia = previous;
    else delete (globalThis as { matchMedia?: unknown }).matchMedia;
  }
}

describe('inline boot script and theme store agree', () => {
  test('index.html still carries the pre-paint theme script', () => {
    expect(extractBootScript()).toContain('prefers-color-scheme: light');
  });

  for (const stored of [null, 'light', 'dark', 'system', 'chartreuse']) {
    for (const osPrefersLight of [true, false]) {
      test(`stored=${stored ?? 'none'}, OS prefers ${
        osPrefersLight ? 'light' : 'dark'
      } resolves identically in both layers`, () => {
        expect(storeThemeFor(stored, osPrefersLight)).toBe(
          runBootScript(stored, osPrefersLight),
        );
      });
    }
  }

  test('an unset preference follows the OS, in both directions', () => {
    // The specific regression: this pair was light/dark before the fix.
    expect(runBootScript(null, true)).toBe('light');
    expect(runBootScript(null, false)).toBe('dark');
    expect(storeThemeFor(null, true)).toBe('light');
    expect(storeThemeFor(null, false)).toBe('dark');
  });
});
