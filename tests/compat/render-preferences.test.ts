import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  COMPATIBILITY_MODE_KEY,
  resetRenderPreferencesState,
  setCompatibilityMode,
  setRenderPreferences,
} from '../../assets/js/core/render-preferences';
import {
  hasWebGPUCompatibilityGapOverride,
  setWebGPUCompatibilityGapOverride,
} from '../../assets/js/core/renderer-query-override.ts';

describe('render preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetRenderPreferencesState();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetRenderPreferencesState();
  });

  test('persists compatibility mode to localStorage', () => {
    setRenderPreferences({ compatibilityMode: true });

    expect(window.localStorage.getItem(COMPATIBILITY_MODE_KEY)).toBe('true');
  });

  test('clears explicit WebGPU retry overrides when compatibility mode is re-enabled', () => {
    setWebGPUCompatibilityGapOverride(true);

    setCompatibilityMode(true);

    expect(hasWebGPUCompatibilityGapOverride()).toBe(false);
  });
});
