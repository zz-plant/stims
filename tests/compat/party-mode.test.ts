import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getActiveMotionPreference,
  resetMotionPreferenceState,
  setMotionPreference,
} from '../../src/js/core/motion-preferences';
import { applyPartyMode } from '../../src/js/core/party-mode';
import {
  getActiveRenderPreferences,
  resetRenderPreferencesState,
  setRenderPreferences,
} from '../../src/js/core/render-preferences';

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
    });

    applyPartyMode({ enabled: true });

    expect(getActiveMotionPreference().enabled).toBe(true);
    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: false,
    });

    applyPartyMode({ enabled: false });

    expect(getActiveMotionPreference().enabled).toBe(false);
    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: true,
    });
  });

  test('does not mutate render preferences when disabling without saved state', () => {
    setRenderPreferences({
      compatibilityMode: true,
    });

    applyPartyMode({ enabled: false });

    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: true,
    });
  });

  test('keeps the original restore state when party mode is enabled repeatedly', () => {
    setMotionPreference({ enabled: false });
    setRenderPreferences({
      compatibilityMode: true,
    });

    applyPartyMode({ enabled: true });
    setMotionPreference({ enabled: true });
    setRenderPreferences({
      compatibilityMode: false,
    });
    applyPartyMode({ enabled: true });

    applyPartyMode({ enabled: false });

    expect(getActiveMotionPreference().enabled).toBe(false);
    expect(getActiveRenderPreferences()).toEqual({
      compatibilityMode: true,
    });
  });
});
