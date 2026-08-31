import { beforeEach, describe, expect, test } from 'bun:test';
import {
  getStageOverlayPreference,
  resetStageOverlayPreferenceState,
  setStageOverlayPreference,
  subscribeToStageOverlayPreference,
} from '../../src/js/core/stage-overlay-preferences.ts';

const STRUDEL_KEY = 'stims:overlay:strudel';
const DEBUG_HUD_KEY = 'stims:debug:hud';

beforeEach(() => {
  resetStageOverlayPreferenceState();
  localStorage.removeItem(STRUDEL_KEY);
  localStorage.removeItem(DEBUG_HUD_KEY);
});

describe('stage overlay preferences', () => {
  test('defaults both overlays off', () => {
    expect(getStageOverlayPreference()).toEqual({
      strudelLab: false,
      debugHud: false,
    });
  });

  test('reads a pre-existing persisted debug HUD flag', () => {
    localStorage.setItem(DEBUG_HUD_KEY, '1');
    resetStageOverlayPreferenceState();
    expect(getStageOverlayPreference().debugHud).toBe(true);
  });

  test('set persists and updates the in-memory value', () => {
    setStageOverlayPreference({ strudelLab: true, debugHud: true });
    expect(getStageOverlayPreference()).toEqual({
      strudelLab: true,
      debugHud: true,
    });
    expect(localStorage.getItem(STRUDEL_KEY)).toBe('1');
    expect(localStorage.getItem(DEBUG_HUD_KEY)).toBe('1');
  });

  test('a partial update leaves the other field untouched', () => {
    setStageOverlayPreference({ strudelLab: true });
    expect(getStageOverlayPreference()).toEqual({
      strudelLab: true,
      debugHud: false,
    });
  });

  test('notifies subscribers on change', () => {
    const seen: Array<{ strudelLab: boolean; debugHud: boolean }> = [];
    subscribeToStageOverlayPreference((next) => seen.push(next));
    setStageOverlayPreference({ debugHud: true });
    expect(seen).toEqual([
      expect.objectContaining({ debugHud: true, strudelLab: false }),
    ]);
  });
});
