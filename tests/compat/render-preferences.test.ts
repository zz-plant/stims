import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  hasWebGPUCompatibilityGapOverride,
  setWebGPUCompatibilityGapOverride,
} from '../../src/js/core/renderer-query-override.ts';
import {
  COMPATIBILITY_MODE_KEY,
  resetRenderPreferenceStore,
  setCompatibilityMode,
  setRenderPreferences,
} from '../../src/js/core/state/render-preference-store.ts';

describe('render preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetRenderPreferenceStore();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetRenderPreferenceStore();
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
