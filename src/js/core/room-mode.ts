/**
 * Room mode — `?room=1`: a screen nobody is operating.
 *
 * A multisensory room, a waiting area or a projector left running in a
 * classroom needs one link that opens straight onto calm, slowly changing
 * visuals and stays that way for hours. Every piece of that existed as a
 * separate setting or key, and none could come from a link, so whoever set
 * the room up had to walk through Settings on that machine and then hope no
 * one pressed a key. The link turns on, for this visit only:
 *
 *  - Reduce flashing (accessibility-preferences reads `isRoomModeRequested`).
 *  - Autoplay with an eight-second blend, and a dwell from `?dwell=`
 *    (default three minutes) instead of the 30 s a sitting visitor gets
 *    (runtime-preferences, `autoAdvanceDwellSeconds`).
 *  - Live performance behaviour: drawing continues in an unfocused window
 *    and quality holds still (live-performance-mode).
 *  - A screen wake lock whether or not the page is fullscreen (App).
 *  - No stage controls, title cards or cursor, and a keyboard and stage
 *    gestures that change nothing (App, `installRoomInputLock`).
 *
 * None of it is saved, so trying a room link on your own laptop leaves your
 * settings as they were. `?brightness=` and `?motion=` work with or without
 * the room flag; a link can only lower them.
 */
import { parseURLParams } from './url-params.ts';

export const ROOM_DEFAULT_DWELL_SECONDS = 180;
/** Autoplay's own floor; a room may hold a preset longer, never shorter. */
export const ROOM_MIN_DWELL_SECONDS = 30;
export const ROOM_MAX_DWELL_SECONDS = 3600;
/** The longest blend Settings offers: changes arrive as slow dissolves. */
export const ROOM_BLEND_SECONDS = 8;

export function clampRoomDwellSeconds(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return ROOM_DEFAULT_DWELL_SECONDS;
  }
  return Math.round(
    Math.min(ROOM_MAX_DWELL_SECONDS, Math.max(ROOM_MIN_DWELL_SECONDS, value)),
  );
}

type RoomState = { active: boolean; dwellSeconds: number };

let cached: RoomState | null = null;

function readRoomState(): RoomState {
  if (cached) return cached;
  if (typeof window === 'undefined') {
    // Headless tools (lab:replay, the VM tests) have no URL and never cache,
    // so a test that later stubs a window still sees its own location.
    return { active: false, dwellSeconds: ROOM_DEFAULT_DWELL_SECONDS };
  }
  try {
    const { room } = parseURLParams();
    cached = {
      active: room.enabled,
      dwellSeconds: clampRoomDwellSeconds(room.dwellSeconds),
    };
  } catch {
    cached = { active: false, dwellSeconds: ROOM_DEFAULT_DWELL_SECONDS };
  }
  return cached;
}

/**
 * Read once per page load and cached: the per-frame autoplay check asks, and
 * the answer cannot change without a navigation.
 */
export function isRoomModeRequested(): boolean {
  return readRoomState().active;
}

/** How long autoplay holds each preset in room mode. */
export function getRoomDwellSeconds(): number {
  return readRoomState().dwellSeconds;
}

/** Test seam: forget the cached URL read. */
export function resetRoomModeForTests() {
  cached = null;
}

/**
 * Swallow every key before the page's own handlers see it.
 *
 * Capture phase on the root element: after the document's capture-phase
 * listeners, which unlock audio on a first key press and must still hear
 * it, and before everything that acts on a key, the canvas's steering keys
 * and the shell's shortcuts alike, including D (blackout) and Y (white
 * flash). Default actions are left alone, so the browser's own keys still
 * work for whoever set the room up: F11 for fullscreen, reload, closing the
 * window.
 */
export function installRoomInputLock(
  target: EventTarget = document.documentElement,
): () => void {
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
  };
  target.addEventListener('keydown', swallow, { capture: true });
  target.addEventListener('keyup', swallow, { capture: true });
  return () => {
    target.removeEventListener('keydown', swallow, { capture: true });
    target.removeEventListener('keyup', swallow, { capture: true });
  };
}

export type RoomLinkOptions = {
  audio: 'demo' | 'microphone';
  dwellSeconds: number;
  stageBrightness: number;
  motionScale: number;
};

/**
 * The link Settings hands out. Brightness and motion are left out at full
 * strength, so the link stays as short as the choices allow.
 */
export function buildRoomUrl(origin: string, options: RoomLinkOptions) {
  const url = new URL('/', origin);
  url.searchParams.set('room', '1');
  url.searchParams.set('audio', options.audio);
  url.searchParams.set(
    'dwell',
    String(clampRoomDwellSeconds(options.dwellSeconds)),
  );
  if (options.stageBrightness < 1) {
    url.searchParams.set(
      'brightness',
      String(Math.round(options.stageBrightness * 100) / 100),
    );
  }
  if (options.motionScale < 1) {
    url.searchParams.set(
      'motion',
      String(Math.round(options.motionScale * 100) / 100),
    );
  }
  return url.toString();
}
