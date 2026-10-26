import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  getActiveAccessibilityPreference,
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import { parseURLParams } from '../../src/js/core/url-params.ts';

const STORAGE_KEY = 'stims:accessibility';
const originalMatchMedia = globalThis.window?.matchMedia;

function visit(search: string) {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(`https://toil.fyi/${search}`);
  resetAccessibilityPreferenceState();
}

function saved(): Record<string, unknown> | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  localStorage.clear();
  // No OS reduced-motion signal: flashing protection still defaults on.
  globalThis.window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
  visit('');
});

afterAll(() => {
  visit('');
  localStorage.clear();
  globalThis.window.matchMedia = originalMatchMedia;
});

describe('?reduceFlashing=1', () => {
  test('parses only the turn-on spellings', () => {
    for (const value of ['1', 'true', 'on', 'yes'])
      expect(parseURLParams(`?reduceFlashing=${value}`).reduceFlashing).toBe(
        true,
      );
    for (const search of ['?reduceFlashing=0', '?reduceFlashing=off', ''])
      expect(parseURLParams(search).reduceFlashing).toBe(false);
  });

  test('turns the setting on for the visit without saving it', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ reduceFlashing: false }),
    );
    visit('?reduceFlashing=1');
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);

    setAccessibilityPreference({ stageBrightness: 0.6 });
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
    expect(saved()).toMatchObject({
      stageBrightness: 0.6,
      reduceFlashing: false,
    });
  });

  test('a link cannot turn off a saved choice', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reduceFlashing: true }));
    visit('?reduceFlashing=0');
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
  });

  test('an in-app toggle still wins, and is what gets saved', () => {
    visit('?reduceFlashing=1');
    setAccessibilityPreference({ reduceFlashing: false });
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(false);
    expect(saved()).toMatchObject({ reduceFlashing: false });
  });
});

describe('default flashing protection', () => {
  test('protects a first visit without an OS motion preference', () => {
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
  });

  test('protects old, invalid and damaged saved preferences', () => {
    for (const raw of ['{}', '{"reduceFlashing":"off"}', 'broken']) {
      localStorage.setItem(STORAGE_KEY, raw);
      visit('');
      expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
    }
  });

  test('keeps an explicit opt-out after reload and unrelated settings edits', () => {
    setAccessibilityPreference({ reduceFlashing: false });
    visit('');
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(false);
    setAccessibilityPreference({ stageBrightness: 0.7 });
    visit('');
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(false);
  });
});
