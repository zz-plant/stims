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
  test('defaults to system when nothing is stored', () => {
    // This must match index.html's inline pre-paint script, which has always
    // fallen back to prefers-color-scheme. It briefly read 'dark' here, which
    // made light-mode visitors paint light and then snap to dark on mount.
    // theme-boot-parity.test.ts guards the two against drifting again.
    expect(getActiveThemePreference().theme).toBe('system');
    stubPrefersLight(false);
    expect(resolveTheme()).toBe('dark');
    stubPrefersLight(true);
    expect(resolveTheme()).toBe('light');
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

  test('an unrecognized stored value degrades to system, not to a crash', () => {
    localStorage.setItem('stims:theme', 'chartreuse');
    expect(getActiveThemePreference().theme).toBe('system');
  });
});
