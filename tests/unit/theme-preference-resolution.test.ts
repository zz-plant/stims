import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getActiveThemePreference,
  resetThemePreferenceState,
  resolveTheme,
  setThemePreference,
} from '../../src/js/core/theme-preferences.ts';

/**
 * The theme store shipped with no writer at all — a fully styled light theme
 * that nothing could reach. These lock in the parts that made it reachable:
 * the 'system' choice, and the resolution step that keeps 'system' from
 * leaking into code that only understands light/dark.
 */

const originalMatchMedia = globalThis.matchMedia;

function stubPrefersLight(prefersLight: boolean) {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('light') ? prefersLight : !prefersLight,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeEach(() => {
  resetThemePreferenceState();
  localStorage.removeItem('stims:theme');
});

afterEach(() => {
  resetThemePreferenceState();
  localStorage.removeItem('stims:theme');
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe('theme preference resolution', () => {
  test('defaults to dark when nothing is stored', () => {
    // Deliberate: the light theme had never been exercised by real traffic,
    // so 'system' is opt-in rather than the default. If this flips, it should
    // be a decision, not a drift.
    expect(getActiveThemePreference().theme).toBe('dark');
    expect(resolveTheme()).toBe('dark');
  });

  test('explicit choices resolve to themselves regardless of the OS', () => {
    stubPrefersLight(true);
    setThemePreference({ theme: 'dark' });
    expect(resolveTheme()).toBe('dark');

    stubPrefersLight(false);
    setThemePreference({ theme: 'light' });
    expect(resolveTheme()).toBe('light');
  });

  test('system follows prefers-color-scheme in both directions', () => {
    setThemePreference({ theme: 'system' });

    stubPrefersLight(true);
    expect(resolveTheme()).toBe('light');

    stubPrefersLight(false);
    expect(resolveTheme()).toBe('dark');
  });

  test('system falls back to dark when matchMedia is unavailable', () => {
    setThemePreference({ theme: 'system' });
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(resolveTheme()).toBe('dark');
  });

  test('persists the choice, including system', () => {
    setThemePreference({ theme: 'system' });
    expect(localStorage.getItem('stims:theme')).toBe('system');

    resetThemePreferenceState();
    expect(getActiveThemePreference().theme).toBe('system');
  });

  test('an unrecognized stored value degrades to dark, not to a crash', () => {
    localStorage.setItem('stims:theme', 'chartreuse');
    expect(getActiveThemePreference().theme).toBe('dark');
  });
});
