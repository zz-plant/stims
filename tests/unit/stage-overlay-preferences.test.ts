import { beforeEach, describe, expect, test } from 'bun:test';
import {
  getStageOverlayPreference,
  resetStageOverlayPreferenceState,
  setStageOverlayPreference,
  subscribeToStageOverlayPreference,
} from '../../src/js/core/stage-overlay-preferences.ts';

const STRUDEL_KEY = 'stims:overlay:strudel';
const DEBUG_HUD_KEY = 'stims:debug:hud';
const TITLE_CARD_KEY = 'stims:overlay:title-card';

beforeEach(() => {
  resetStageOverlayPreferenceState();
  localStorage.removeItem(STRUDEL_KEY);
  localStorage.removeItem(DEBUG_HUD_KEY);
  localStorage.removeItem(TITLE_CARD_KEY);
});

describe('stage overlay preferences', () => {
  test('defaults the tool overlays off and the preset title card on', () => {
    expect(getStageOverlayPreference()).toEqual({
      strudelLab: false,
      debugHud: false,
      presetTitleCard: true,
    });
  });

  test('a stored 0 turns the preset title card off', () => {
    localStorage.setItem(TITLE_CARD_KEY, '0');
    resetStageOverlayPreferenceState();
    expect(getStageOverlayPreference().presetTitleCard).toBe(false);
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
      presetTitleCard: true,
    });
    expect(localStorage.getItem(STRUDEL_KEY)).toBe('1');
    expect(localStorage.getItem(DEBUG_HUD_KEY)).toBe('1');
  });

  test('a partial update leaves the other field untouched', () => {
    setStageOverlayPreference({ strudelLab: true });
    expect(getStageOverlayPreference()).toEqual({
      strudelLab: true,
      debugHud: false,
      presetTitleCard: true,
    });
  });

  test('notifies subscribers on change', () => {
    const seen: Array<{
      strudelLab: boolean;
      debugHud: boolean;
      presetTitleCard: boolean;
    }> = [];
    subscribeToStageOverlayPreference((next) => seen.push(next));
    setStageOverlayPreference({ debugHud: true });
    expect(seen).toEqual([
      expect.objectContaining({ debugHud: true, strudelLab: false }),
    ]);
  });
});
