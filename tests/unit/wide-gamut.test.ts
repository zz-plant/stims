import { afterEach, describe, expect, test } from 'bun:test';
import { ColorManagement, LinearSRGBColorSpace, SRGBColorSpace } from 'three';
import {
  DISPLAY_P3_COLOR_SPACE,
  isWideGamutEnabled,
  LINEAR_DISPLAY_P3_COLOR_SPACE,
  registerWideGamutColorSpaces,
  resolveLinearOutputColorSpace,
  resolveOutputColorSpace,
  setWideGamutEnabled,
} from '../../src/js/core/wide-gamut.ts';

const STORAGE_KEY = 'stims:wide-gamut';
const originalMatchMedia = window.matchMedia;

function setGamutMatch(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: query.includes('color-gamut: p3') ? matches : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  // matchMedia is global: leaving a stub installed made unrelated suites
  // (anything reaching isMobileDevice) see a browser with no media support.
  Object.defineProperty(window, 'matchMedia', {
    value: originalMatchMedia,
    configurable: true,
    writable: true,
  });
});

describe('wide gamut', () => {
  test('is off unless explicitly enabled', () => {
    expect(isWideGamutEnabled()).toBe(false);
  });

  test('the preference round-trips', () => {
    setWideGamutEnabled(true);
    expect(isWideGamutEnabled()).toBe(true);
    setWideGamutEnabled(false);
    expect(isWideGamutEnabled()).toBe(false);
  });

  test('stays on sRGB when the preference is off, even on a P3 display', () => {
    setGamutMatch(true);
    setWideGamutEnabled(false);
    expect(resolveOutputColorSpace()).toBe(SRGBColorSpace);
    expect(resolveLinearOutputColorSpace()).toBe(LinearSRGBColorSpace);
  });

  test('stays on sRGB when enabled but the display cannot show P3', () => {
    // Opting in must not widen output on hardware that would then have to
    // squash it back — that shifts colour for no benefit.
    setGamutMatch(false);
    setWideGamutEnabled(true);
    expect(resolveOutputColorSpace()).toBe(SRGBColorSpace);
    expect(resolveLinearOutputColorSpace()).toBe(LinearSRGBColorSpace);
  });

  test('registers P3 with three so the space actually resolves', () => {
    registerWideGamutColorSpaces();
    // three would silently fall back if the id were never defined, so assert
    // it is a space three knows rather than just a string we made up.
    expect(ColorManagement.getPrimaries(DISPLAY_P3_COLOR_SPACE)).toBeDefined();
    expect(
      ColorManagement.getPrimaries(LINEAR_DISPLAY_P3_COLOR_SPACE),
    ).toBeDefined();
  });

  test('registering twice is idempotent', () => {
    registerWideGamutColorSpaces();
    expect(() => registerWideGamutColorSpaces()).not.toThrow();
  });

  test('the P3 transfer functions differ, linear vs encoded', () => {
    registerWideGamutColorSpaces();
    // The linear and sRGB-transfer variants must not collapse into one, or the
    // present pass's encode suspension would be a no-op.
    expect(ColorManagement.getTransfer(LINEAR_DISPLAY_P3_COLOR_SPACE)).not.toBe(
      ColorManagement.getTransfer(DISPLAY_P3_COLOR_SPACE),
    );
  });
});
