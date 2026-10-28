/**
 * The live stage utilities: blackout (D) and white flash (Y).
 *
 * Two presentation-only cuts a performer reaches for mid-show: blacking the
 * stage out between songs, and throwing a full-white flash on a drop. Both
 * act on the presentation layer only — a luminance channel and an overlay —
 * so no preset state, equation, or audio source is touched, and releasing
 * the key brings the picture back exactly as it was.
 *
 * The state lives here, not in component state, because the keyboard
 * listener writes it and two separate surfaces read it: the overlay that
 * paints the stage and a unit test that should not need React to check the
 * hold/latch rules. The hook in frontend/ owns the key events and calls in;
 * this module owns what they mean.
 *
 * Hold and latch: a keydown shows the cut and the matching keyup takes it
 * away — the momentary hold a DJ uses on a build-up. Two taps inside the
 * latch window latch the blackout so it survives the keyup, and the next
 * press releases it. The flash never latches: a white screen held by
 * accident blinds the room, and the strobe it exists for is made by tapping,
 * not by holding.
 */

export type StageUtilityMode = 'normal' | 'blackout' | 'flash';

/** Two presses closer together than this latch the blackout. */
export const BLACKOUT_LATCH_WINDOW_MS = 350;

let mode: StageUtilityMode = 'normal';
const modeListeners = new Set<() => void>();

/** The mode the stage is currently presenting. */
export function stageUtilityMode(): StageUtilityMode {
  return mode;
}

export function subscribeToStageUtilityMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

function setMode(next: StageUtilityMode) {
  if (mode === next) return;
  mode = next;
  for (const listener of modeListeners) listener();
}

let blackoutLatched = false;
let lastBlackoutReleaseAt = -Infinity;

/**
 * A blackout keydown: start holding, latch on the second fast press, or —
 * while latched — release. `repeat` is the key auto-repeating while held,
 * which is not a new press and must not re-trigger the latch logic.
 */
export function handleBlackoutKeyDown(repeat: boolean, now = Date.now()) {
  if (repeat) return;
  if (mode === 'blackout') {
    // A latched cut answers to one press, not two: the double-tap that
    // latched it already happened.
    blackoutLatched = false;
    setMode('normal');
    return;
  }
  // The gap is measured from the previous release, not the previous press:
  // the two taps a performer makes are down-up-down, and a slow release
  // between them is exactly what should keep them from latching.
  if (now - lastBlackoutReleaseAt <= BLACKOUT_LATCH_WINDOW_MS) {
    blackoutLatched = true;
  }
  setMode('blackout');
}

/** A blackout keyup: end the hold, unless the double-tap latched it. */
export function handleBlackoutKeyUp(now = Date.now()) {
  lastBlackoutReleaseAt = now;
  if (blackoutLatched) return;
  if (mode === 'blackout') setMode('normal');
}

/**
 * A blackout from a command rather than a key: the palette or a MIDI pad.
 * Nothing follows with a release, so it latches, and the next run ends it,
 * the same as a press of D does while latched.
 */
export function toggleBlackout() {
  if (mode === 'blackout') {
    blackoutLatched = false;
    setMode('normal');
    return;
  }
  blackoutLatched = true;
  setMode('blackout');
}

/** A flash keydown: white for exactly as long as the key is down. */
export function handleFlashKeyDown(repeat: boolean) {
  if (repeat) return;
  setMode('flash');
}

/** A flash keyup: back to the picture. */
export function handleFlashKeyUp() {
  if (mode === 'flash') setMode('normal');
}

/**
 * Drop any engaged utility without waiting for a keyup.
 *
 * Called when the window loses focus (the keyup for a held key may never
 * arrive) and when the live session ends — a cut that outlives the show is
 * a trap for whoever looks at the screen next.
 */
export function releaseStageUtilities() {
  blackoutLatched = false;
  setMode('normal');
}

/** Test seam: forget the latch timing and the mode between cases. */
export function resetStageUtilitiesForTests() {
  blackoutLatched = false;
  lastBlackoutReleaseAt = -Infinity;
  setMode('normal');
}
