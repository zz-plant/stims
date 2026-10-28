import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  getActiveAccessibilityPreference,
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import {
  isLivePerformanceModeActive,
  resetLivePerformanceModeForTests,
} from '../../src/js/core/live-performance-mode.ts';
import {
  buildRoomUrl,
  clampRoomDwellSeconds,
  installRoomInputLock,
  ROOM_BLEND_SECONDS,
  ROOM_DEFAULT_DWELL_SECONDS,
  resetRoomModeForTests,
} from '../../src/js/core/room-mode.ts';
import { readSessionRouteState } from '../../src/js/frontend/url-state.ts';
import { autoAdvanceDwellSeconds } from '../../src/js/milkdrop/runtime/lifecycle.ts';
import { UI_PREFS_KEY } from '../../src/js/milkdrop/runtime/persistence.ts';
import { createMilkdropRuntimePreferences } from '../../src/js/milkdrop/runtime/runtime-preferences.ts';

const A11Y_KEY = 'stims:accessibility';
const LIVE_KEY = 'stims:live-performance-mode';
const originalMatchMedia = globalThis.window?.matchMedia;

function visit(search: string) {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(`https://toil.fyi/${search}`);
  resetRoomModeForTests();
  resetAccessibilityPreferenceState();
  resetLivePerformanceModeForTests();
}

function stored(key: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  localStorage.clear();
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

describe('room link', () => {
  test('holds each preset for the dwell it names, within bounds', () => {
    visit('?room=1&dwell=600');
    expect(autoAdvanceDwellSeconds(ROOM_BLEND_SECONDS)).toBe(600);
    visit('?room=1');
    expect(autoAdvanceDwellSeconds(ROOM_BLEND_SECONDS)).toBe(
      ROOM_DEFAULT_DWELL_SECONDS,
    );
    expect(clampRoomDwellSeconds(5)).toBe(30);
    expect(clampRoomDwellSeconds(99_999)).toBe(3600);
    expect(clampRoomDwellSeconds(Number.NaN)).toBe(ROOM_DEFAULT_DWELL_SECONDS);
  });

  test('leaves a sitting visitor on the 30 s autoplay', () => {
    visit('?dwell=600');
    expect(autoAdvanceDwellSeconds(2.5)).toBe(30);
  });

  test('autoplays with a slow blend, from the first-run preset, saving nothing', () => {
    localStorage.setItem(
      UI_PREFS_KEY,
      JSON.stringify({
        autoplay: false,
        blendDuration: 1,
        transitionMode: 'cut',
        lastPresetId: 'their-preset',
      }),
    );
    visit('?room=1');
    const prefs = createMilkdropRuntimePreferences();
    expect(prefs.getAutoplay()).toBe(true);
    expect(prefs.getBlendDuration(2.5)).toBe(ROOM_BLEND_SECONDS);
    expect(prefs.getTransitionMode()).toBe('blend');
    expect(prefs.getStartupPresetId()).toBeUndefined();

    prefs.setAutoplay(false);
    prefs.rememberLastPreset('some-preset');
    expect(stored(UI_PREFS_KEY)).toEqual({
      autoplay: false,
      blendDuration: 1,
      transitionMode: 'cut',
      lastPresetId: 'their-preset',
    });
  });

  test('turns on reduce flashing and live behaviour for the visit only', () => {
    localStorage.setItem(A11Y_KEY, JSON.stringify({ reduceFlashing: false }));
    visit('?room=1');
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
    expect(isLivePerformanceModeActive()).toBe(true);
    expect(localStorage.getItem(LIVE_KEY)).toBeNull();
    expect(stored(A11Y_KEY)).toEqual({ reduceFlashing: false });
  });

  test('opens onto the demo track when it names no source', () => {
    expect(readSessionRouteState('https://toil.fyi/?room=1').audioSource).toBe(
      'demo',
    );
    expect(
      readSessionRouteState('https://toil.fyi/?room=1&audio=mic').audioSource,
    ).toBe('microphone');
    expect(readSessionRouteState('https://toil.fyi/').audioSource).toBeNull();
  });

  test('builds the link Settings hands out', () => {
    const url = new URL(
      buildRoomUrl('https://toil.fyi', {
        audio: 'microphone',
        dwellSeconds: 300,
        stageBrightness: 0.6,
        motionScale: 1,
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      room: '1',
      audio: 'microphone',
      dwell: '300',
      brightness: '0.6',
    });
  });
});

describe('a saved live performance mode', () => {
  test('applies on the first per-frame read after a reload', () => {
    localStorage.setItem(LIVE_KEY, 'true');
    visit('');
    // Nothing else has touched the module: the render path's read alone
    // has to find the saved choice.
    expect(isLivePerformanceModeActive()).toBe(true);
    expect(document.documentElement.dataset.livePerformance).toBe('true');
  });
});

describe('?brightness= and ?motion=', () => {
  test('lower the saved values for the visit without saving them', () => {
    localStorage.setItem(
      A11Y_KEY,
      JSON.stringify({ stageBrightness: 0.8, motionScale: 0.9 }),
    );
    visit('?brightness=0.5&motion=0.2');
    expect(getActiveAccessibilityPreference()).toMatchObject({
      stageBrightness: 0.5,
      motionScale: 0.2,
    });

    setAccessibilityPreference({ textScale: 1.25 });
    expect(stored(A11Y_KEY)).toMatchObject({
      stageBrightness: 0.8,
      motionScale: 0.9,
      textScale: 1.25,
    });
  });

  test('cannot raise a saved value or go below the brightness floor', () => {
    localStorage.setItem(
      A11Y_KEY,
      JSON.stringify({ stageBrightness: 0.4, motionScale: 0.1 }),
    );
    visit('?brightness=1&motion=1');
    expect(getActiveAccessibilityPreference()).toMatchObject({
      stageBrightness: 0.4,
      motionScale: 0.1,
    });

    localStorage.clear();
    visit('?brightness=0');
    expect(getActiveAccessibilityPreference().stageBrightness).toBe(0.3);
  });

  test('an in-app change wins and is saved', () => {
    visit('?brightness=0.5');
    setAccessibilityPreference({ stageBrightness: 0.9 });
    expect(getActiveAccessibilityPreference().stageBrightness).toBe(0.9);
    expect(stored(A11Y_KEY)).toMatchObject({ stageBrightness: 0.9 });
  });
});

describe('room key lock', () => {
  test('stops keys before the page acts on them, after audio unlock hears them', () => {
    const heard: string[] = [];
    const unlock = () => heard.push('document capture');
    const shortcut = () => heard.push('document bubble');
    const canvas = document.createElement('canvas');
    const steer = () => heard.push('canvas');
    document.body.append(canvas);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('keydown', shortcut);
    canvas.addEventListener('keydown', steer);
    const release = installRoomInputLock();
    try {
      canvas.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'y', bubbles: true }),
      );
      expect(heard).toEqual(['document capture']);

      release();
      heard.length = 0;
      canvas.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'y', bubbles: true }),
      );
      expect(heard).toEqual(['document capture', 'canvas', 'document bubble']);
    } finally {
      release();
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('keydown', shortcut);
      canvas.remove();
    }
  });
});
