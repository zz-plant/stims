import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getActiveMotionPreference,
  resetMotionPreferenceState,
  setMotionPreference,
} from '../assets/js/core/motion-preferences';
import {
  getActiveRenderPreferences,
  resetRenderPreferencesState,
  setRenderPreferences,
} from '../assets/js/core/render-preferences';
import { applyPartyMode } from '../assets/js/utils/party-mode';

describe('applyPartyMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetMotionPreferenceState();
    resetRenderPreferencesState();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetMotionPreferenceState();
    resetRenderPreferencesState();
  });

  test('restores motion and render preferences after disabling party mode', () => {
    setMotionPreference({ enabled: false });
    setRenderPreferences({
      compatibilityMode: true,
      maxPixelRatio: 1.25,
      renderScale: 0.9,
    });

    applyPartyMode({ enabled: true });

    expect(getActiveMotionPreference().enabled).toBe(true);
    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: false,
      maxPixelRatio: 2.5,
      renderScale: 1.15,
    });

    applyPartyMode({ enabled: false });

    expect(getActiveMotionPreference().enabled).toBe(false);
    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: true,
      maxPixelRatio: 1.25,
      renderScale: 0.9,
    });
  });

  test('does not mutate render preferences when disabling without saved state', () => {
    setRenderPreferences({
      compatibilityMode: true,
      maxPixelRatio: 1.4,
      renderScale: 0.8,
    });

    applyPartyMode({ enabled: false });

    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: true,
      maxPixelRatio: 1.4,
      renderScale: 0.8,
    });
  });
});
