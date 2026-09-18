import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  clampMotionScale,
  getActiveAccessibilityPreference,
  getMotionScale,
  REDUCED_MOTION_DEFAULT_SCALE,
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';

const STORAGE_KEY = 'stims:accessibility';
const originalMatchMedia = globalThis.window?.matchMedia;

function stubReducedMotion(matches: boolean) {
  globalThis.window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: query.includes('prefers-reduced-motion') && matches,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  resetAccessibilityPreferenceState();
  localStorage.clear();
  stubReducedMotion(false);
});

afterAll(() => {
  resetAccessibilityPreferenceState();
  localStorage.clear();
  globalThis.window.matchMedia = originalMatchMedia;
});

describe('motion scale preference', () => {
  test('clamps to 0–1 and treats junk as full motion', () => {
    expect(clampMotionScale(0.35)).toBe(0.35);
    expect(clampMotionScale(-1)).toBe(0);
    expect(clampMotionScale(4)).toBe(1);
    expect(clampMotionScale('0.5')).toBe(1);
    expect(clampMotionScale(Number.NaN)).toBe(1);
  });

  test('rests at full motion with no OS signal and no saved choice', () => {
    expect(getMotionScale()).toBe(1);
  });

  test('follows prefers-reduced-motion until the user picks a value', () => {
    stubReducedMotion(true);
    expect(getMotionScale()).toBe(REDUCED_MOTION_DEFAULT_SCALE);
  });

  test('a preference saved before the field existed still gets the OS default', () => {
    stubReducedMotion(true);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ textScale: 1, highContrast: false, freezeFrame: false }),
    );
    expect(getActiveAccessibilityPreference().motionScale).toBe(
      REDUCED_MOTION_DEFAULT_SCALE,
    );
  });

  test('a saved value wins over the OS signal and survives a reload', () => {
    stubReducedMotion(true);
    setAccessibilityPreference({ motionScale: 0.75 });
    expect(getMotionScale()).toBe(0.75);

    resetAccessibilityPreferenceState();
    expect(getMotionScale()).toBe(0.75);
  });

  test('the per-frame read tracks the setter without touching storage', () => {
    setAccessibilityPreference({ motionScale: 0.2 });
    localStorage.clear();
    expect(getMotionScale()).toBe(0.2);
  });
});
