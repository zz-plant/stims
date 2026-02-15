import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  COMPATIBILITY_MODE_KEY,
  getActiveRenderPreferences,
  MAX_PIXEL_RATIO_KEY,
  RENDER_SCALE_KEY,
  resetRenderPreferencesState,
  setRenderPreferences,
} from '../assets/js/core/render-preferences';

describe('render preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRenderPreferencesState();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetRenderPreferencesState();
  });

  test('clamps numeric preferences to supported bounds', () => {
    const updated = setRenderPreferences({
      compatibilityMode: true,
      maxPixelRatio: 4,
      renderScale: 0.4,
    });

    expect(updated).toEqual({
      compatibilityMode: true,
      maxPixelRatio: 3,
      renderScale: 0.6,
    });
  });

  test('persists and clears nullable numeric values in localStorage', () => {
    setRenderPreferences({
      compatibilityMode: true,
      maxPixelRatio: 2.4,
      renderScale: 1.2,
    });

    expect(window.localStorage.getItem(COMPATIBILITY_MODE_KEY)).toBe('true');
    expect(window.localStorage.getItem(MAX_PIXEL_RATIO_KEY)).toBe('2.4');
    expect(window.localStorage.getItem(RENDER_SCALE_KEY)).toBe('1.2');

    setRenderPreferences({ maxPixelRatio: null, renderScale: null });

    expect(window.localStorage.getItem(COMPATIBILITY_MODE_KEY)).toBe('true');
    expect(window.localStorage.getItem(MAX_PIXEL_RATIO_KEY)).toBeNull();
    expect(window.localStorage.getItem(RENDER_SCALE_KEY)).toBeNull();
  });

  test('ignores invalid numeric values loaded from localStorage', () => {
    window.localStorage.setItem(COMPATIBILITY_MODE_KEY, 'true');
    window.localStorage.setItem(MAX_PIXEL_RATIO_KEY, 'not-a-number');
    window.localStorage.setItem(RENDER_SCALE_KEY, '1.1');

    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: true,
      maxPixelRatio: null,
      renderScale: 1.1,
    });
  });
});
