/**
 * Which keydowns the keyboard layer acts on: the arrows move focus, the back
 * keys go back, Enter and OK activate. TV remotes name some of these keys
 * differently, and older ones send only a key code, so both are matched.
 *
 * A module of its own so a page can ask the same question without loading
 * the layer, which Stims imports only once the first frame is up.
 */

type CardinalDirection = 'up' | 'down' | 'left' | 'right';

const DIRECTIONAL_KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
} as const satisfies Record<string, CardinalDirection>;

const BACK_KEYS = new Set([
  'Escape',
  'Backspace',
  'GoBack',
  'BrowserBack',
  'Back',
  'Exit',
  'MediaBack',
]);
const ENTER_KEYS = new Set([
  'Enter',
  'NumpadEnter',
  'OK',
  'Select',
  'Return',
  'Spacebar',
]);
const LEGACY_BACK_KEY_CODES = new Set([8, 27, 166, 461, 10009]);
const LEGACY_ENTER_KEY_CODES = new Set([13, 32, 23]);

export const isDirectionalKey = (
  key: string,
): key is keyof typeof DIRECTIONAL_KEYS => {
  return key in DIRECTIONAL_KEYS;
};

export const getDirectionFromKey = (
  key: keyof typeof DIRECTIONAL_KEYS,
): CardinalDirection => DIRECTIONAL_KEYS[key];

export const isBackKey = (event: KeyboardEvent) => {
  if (BACK_KEYS.has(event.key)) {
    return true;
  }
  const keyCode = event.keyCode || event.which || 0;
  return LEGACY_BACK_KEY_CODES.has(keyCode);
};

const isRemoteLegacyKeyEvent = (event: KeyboardEvent) => {
  return event.key === 'Unidentified';
};

export const isEnterLikeKey = (event: KeyboardEvent) => {
  if (ENTER_KEYS.has(event.key)) {
    return true;
  }
  if (!isRemoteLegacyKeyEvent(event)) {
    return false;
  }
  const keyCode = event.keyCode || event.which || 0;
  return LEGACY_ENTER_KEY_CODES.has(keyCode);
};

export const shouldHandleBackKey = (event: KeyboardEvent) => isBackKey(event);
export const shouldHandleDirectionalKey = (event: KeyboardEvent) =>
  isDirectionalKey(event.key);
export const shouldHandleEnterLikeKey = (event: KeyboardEvent) =>
  isEnterLikeKey(event);
