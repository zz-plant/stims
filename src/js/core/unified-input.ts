/**
 * Unified Input System — normalizes multi-touch pointers, mouse gestures, keyboard strokes,
 * and gamepad axes into a single unified input stream with gesture recognition.
 */

import type { FrequencyAnalyser } from './audio-handler';

export type InputSource = 'none' | 'pointer' | 'keyboard' | 'gamepad';

export type UnifiedPointer = {
  id: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  normalizedX: number;
  normalizedY: number;
};

export type UnifiedInputState = {
  time: number;
  deltaMs: number;
  pointers: UnifiedPointer[];
  pointerCount: number;
  centroid: { x: number; y: number };
  normalizedCentroid: { x: number; y: number };
  primary: UnifiedPointer | null;
  isPressed: boolean;
  justPressed: boolean;
  justReleased: boolean;
  dragDelta: { x: number; y: number };
  source: InputSource;
  gesture: UnifiedGesture | null;
  mic: { level: number; available: boolean };
  performance: UnifiedPerformanceState;
};

export type UnifiedGesture = {
  pointerCount: number;
  scale: number;
  rotation: number;
  translation: { x: number; y: number };
};

export type UnifiedPerformanceActions = {
  accent: number;
  modeNext: number;
  modePrevious: number;
  presetNext: number;
  presetPrevious: number;
  quickLook1: number;
  quickLook2: number;
  quickLook3: number;
  remix: number;
};

export type UnifiedPerformanceState = {
  hoverActive: boolean;
  hover: { x: number; y: number } | null;
  wheelDelta: number;
  wheelAccum: number;
  dragIntensity: number;
  dragAngle: number;
  accentPulse: number;
  sourceFlags: {
    pointer: boolean;
    keyboard: boolean;
    gamepad: boolean;
    mouse: boolean;
    touch: boolean;
    pen: boolean;
  };
  actions: UnifiedPerformanceActions;
};

export type UnifiedInputOptions = {
  target: HTMLElement;
  boundsElement?: HTMLElement | null;
  onInput?: (state: UnifiedInputState) => void;
  keyboardEnabled?: boolean;
  gamepadEnabled?: boolean;
  keyboardSpeed?: number;
  keyboardBoost?: number;
  gamepadSpeed?: number;
  gamepadDeadzone?: number;
  focusOnPress?: boolean;
  micProvider?: () => { level: number; available: boolean };
};

const DEFAULT_KEYBOARD_SPEED = 1.4;
const DEFAULT_KEYBOARD_BOOST = 2.2;
const DEFAULT_GAMEPAD_SPEED = 1.2;
const DEFAULT_GAMEPAD_DEADZONE = 0.18;
const PERFORMANCE_PULSE_MS = 220;
const PERFORMANCE_WHEEL_DECAY = 0.76;
const PERFORMANCE_WHEEL_ACCUM_DECAY = 0.9;
const PERFORMANCE_WHEEL_MIN = 0.001;

const PERFORMANCE_ACTION_KEYS = {
  accent: [' ', 'enter'],
  modeNext: ['e', 'x'],
  modePrevious: ['q', 'z'],
  presetNext: [']'],
  presetPrevious: ['['],
  quickLook1: ['1'],
  quickLook2: ['2'],
  quickLook3: ['3'],
  remix: ['r'],
} satisfies Record<keyof UnifiedPerformanceActions, string[]>;

/**
 * Keys that steer the virtual pointer, and only while Shift is held.
 *
 * This was WASD plus the bare arrows, which could not work: the shell binds
 * A (save), S (settings) and both arrows (preset navigation), and the
 * reservation that keeps those shortcuts alive on a focused canvas took them
 * away from here — leaving a steering cluster that could go up, down and
 * right but never left. Shifted arrows collide with nothing: the shell's
 * bindings are bare, and the MilkDrop overlay's are letters.
 */
const KEYBOARD_POINTER_KEYS = new Set([
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
]);

/** True when this keydown is a steering chord rather than a shell shortcut. */
function isSteeringChord(key: string, shiftKey: boolean): boolean {
  return shiftKey && KEYBOARD_POINTER_KEYS.has(key);
}

/** Keyboard stand-in for the two-finger pinch/rotate gesture: = / - scale,
    , / . rotate. Without this, gesture-driven preset signals (pinchDelta →
    warp/zoom/video-echo) are unreachable without a touchscreen. */
const KEYBOARD_GESTURE_KEYS = new Set(['=', '+', '-', '_', ',', '.']);

/**
 * The stage's key layer, in the shape the shortcuts dialog renders.
 *
 * This layer existed for a long time with no user-facing description
 * anywhere, so every key below was reachable only by accident. It is
 * authored here, next to the maps it describes, so the keys and their
 * documentation cannot drift apart.
 *
 * Only keys that change what is on screen for *any* preset belong in this
 * list. The rest of the layer (see {@link STAGE_SIGNAL_KEYS}) is published to
 * preset code as variables, and documenting those the same way would promise
 * a behavior the bundled catalog never delivers — the exact failure this
 * documentation exists to end.
 *
 * Keys are stored the way `isReservedByShell` wants them (lowercase, ' ' for
 * the space bar) and prettified for display by `formatStageKey`.
 */
export type StageKeyDoc = {
  keys: string[];
  label: string;
  /** Rendered as a Shift chord, and exempt from the bare-key reservation. */
  shift?: boolean;
};

export const STAGE_KEY_DOCS: readonly StageKeyDoc[] = [
  {
    keys: ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'],
    label: 'Push the visuals around (drag, by keyboard)',
    shift: true,
  },
  { keys: ['=', '-'], label: 'Zoom and warp (the pinch gesture, by keyboard)' },
  { keys: [',', '.'], label: 'Rotate (the twist gesture, by keyboard)' },
];

/**
 * Keys the canvas forwards to preset code as `action_*` signals, and nothing
 * else: no runtime behavior reads them.
 *
 * Zero of the 2,686 bundled presets reference these variables, so on the
 * shipped catalog every key here is inert — which is why they are named in
 * one sentence aimed at people writing presets, rather than listed beside
 * keys that do something.
 */
export const STAGE_SIGNAL_KEYS: readonly string[] = [
  ' ',
  'enter',
  'e',
  'x',
  'q',
  'z',
  '[',
  ']',
  '1',
  '2',
  '3',
  'r',
];

const STAGE_KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  enter: 'Enter',
  arrowup: '\u2191',
  arrowdown: '\u2193',
  arrowleft: '\u2190',
  arrowright: '\u2192',
};

/** Display spelling for one stage key: 'r' -> 'R', 'arrowup' -> up arrow. */
export function formatStageKey(key: string, shift = false): string {
  const base = STAGE_KEY_LABELS[key] ?? key.toUpperCase();
  return shift ? `\u21e7${base}` : base;
}

/**
 * {@link STAGE_KEY_DOCS} with every key the shell has claimed removed, and
 * rows left with nothing dropped.
 *
 * The shell wins those keys (see {@link setReservedShellKeys}), so listing
 * them here would advertise a stage behavior that never fires. Resolved per
 * call, because shortcuts are rebindable at runtime.
 */
export function availableStageKeyDocs(): StageKeyDoc[] {
  const rows: StageKeyDoc[] = [];
  for (const row of STAGE_KEY_DOCS) {
    // A Shift row is exempt: the shell reserves bare keys, so Shift+Arrow
    // stays with the stage even though ArrowLeft is a shell binding.
    const keys = row.shift
      ? row.keys
      : row.keys.filter((key) => !isReservedByShell(key));
    if (keys.length > 0) rows.push({ ...row, keys });
  }
  return rows;
}

/** {@link STAGE_SIGNAL_KEYS}, minus the ones the shell has claimed. */
export function availableStageSignalKeys(): string[] {
  return STAGE_SIGNAL_KEYS.filter((key) => !isReservedByShell(key));
}

const KEYBOARD_GESTURE_SCALE_RATE = 0.9; // log-scale units per second
const KEYBOARD_GESTURE_ROTATION_RATE = 1.2; // radians per second
const KEYBOARD_GESTURE_RELEASE_MS = 400;

/**
 * True when a focused canvas swallows `key` before the document-level
 * shortcuts can see it.
 *
 * handleKeyDown() below stopPropagation()s every pointer, gesture and
 * performance key, deliberately, so one keystroke cannot fire both a canvas
 * behavior and a shell shortcut. The cost is that any shell shortcut sharing
 * one of these letters silently does nothing while the canvas holds focus —
 * which is invisible when reading shortcut-registry.ts alone. Exported so
 * that registry can be tested against it.
 */
/** Shared empty set, so clearing the reservation allocates nothing. */
export const NO_RESERVED_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>(),
) as ReadonlySet<string>;

let resolveReservedShellKeys: () => ReadonlySet<string> = () =>
  NO_RESERVED_KEYS;

/**
 * Declares the keys the application shell has bound to its own shortcuts, so
 * a focused canvas stops swallowing them.
 *
 * The canvas takes its pointer, gesture and performance keys with
 * preventDefault() + stopPropagation() to stop one keystroke doing two
 * things. That is right for keys only it uses, but six of them were also
 * documented shell shortcuts — Space, S, E, A and both arrows — and the
 * canvas focuses itself on pointerdown, so a single click on the stage left
 * Settings, the editor, save and preset navigation silently dead while the
 * shortcuts dialog still advertised them. Keys named here are left entirely
 * to the shell: not consumed, and not fed to the performance actions either,
 * so the keystroke still does exactly one thing.
 *
 * Passed as a resolver rather than a list because bindings are rebindable.
 */
export function setReservedShellKeys(
  resolver: () => ReadonlySet<string>,
): void {
  resolveReservedShellKeys = resolver;
}

/** True when the shell owns this key and the canvas must not touch it. */
export function isReservedByShell(key: string): boolean {
  const lower = key.toLowerCase() === 'space' ? ' ' : key.toLowerCase();
  return resolveReservedShellKeys().has(lower);
}

export function isCanvasConsumedKey(key: string, shiftKey = false): boolean {
  // Accept both spellings of the space bar: KeyboardEvent.key reports ' ',
  // while shortcut specs write it as 'Space'.
  const lower = key.toLowerCase() === 'space' ? ' ' : key.toLowerCase();
  return (
    isSteeringChord(lower, shiftKey) ||
    KEYBOARD_GESTURE_KEYS.has(lower) ||
    Object.values(PERFORMANCE_ACTION_KEYS).some((keys) => keys.includes(lower))
  );
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizePoint = (clientX: number, clientY: number, bounds: DOMRect) => {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const x = (clientX - bounds.left) / width;
  const y = (clientY - bounds.top) / height;
  return {
    normalizedX: x * 2 - 1,
    normalizedY: -(y * 2 - 1),
  };
};

const pointerFromNormalized = (
  normalizedX: number,
  normalizedY: number,
  bounds: DOMRect,
  id: number,
  pointerType: string,
): UnifiedPointer => {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  return {
    id,
    pointerType,
    normalizedX,
    normalizedY,
    clientX: bounds.left + ((normalizedX + 1) / 2) * width,
    clientY: bounds.top + ((1 - normalizedY) / 2) * height,
  };
};

const getPrimaryGamepad = () => {
  try {
    const pads = navigator.getGamepads?.() ?? [];
    return Array.from(pads).find((pad) => pad?.connected) ?? null;
  } catch {
    return null;
  }
};

const isTextInput = (element: Element | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLElement && element.isContentEditable);

export const createMicSnapshotProvider =
  (
    analyser: FrequencyAnalyser | null,
  ): (() => { level: number; available: boolean }) =>
  () => ({
    level: analyser?.getRmsLevel() ?? 0,
    available: Boolean(analyser),
  });

export function createUnifiedInput({
  target,
  boundsElement = null,
  onInput,
  keyboardEnabled = true,
  gamepadEnabled = true,
  keyboardSpeed = DEFAULT_KEYBOARD_SPEED,
  keyboardBoost = DEFAULT_KEYBOARD_BOOST,
  gamepadSpeed = DEFAULT_GAMEPAD_SPEED,
  gamepadDeadzone = DEFAULT_GAMEPAD_DEADZONE,
  focusOnPress = true,
  micProvider,
}: UnifiedInputOptions) {
  const activePointers = new Map<number, UnifiedPointer>();
  let hoverPointer: UnifiedPointer | null = null;
  const pendingPointerEvents: PointerEvent[] = [];
  const pendingPointerMoveIndexes = new Map<number, number>();
  const keyState = new Set<string>();
  /**
   * Arrows currently held *as steering chords*.
   *
   * Tracked separately from `keyState` rather than re-deriving from it: the
   * modifier is only known at keydown, and an embedding with no shell
   * reservation installed would otherwise let a bare arrow steer — the same
   * double-duty this chord exists to avoid.
   */
  const steerKeys = new Set<string>();
  let keyboardPointer = { normalizedX: 0, normalizedY: 0 };
  let gamepadPointer = { normalizedX: 0, normalizedY: 0 };
  let lastFrameTime =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  let lastPrimary: UnifiedPointer | null = null;
  let isPressed = false;
  let inputFrameId: number | null = null;
  let lastSource: InputSource = 'none';
  let lastGamepadConnected = false;
  let wheelDelta = 0;
  let wheelAccum = 0;
  let lastAccentAt = -Infinity;
  const actionLastTriggeredAt: Record<keyof UnifiedPerformanceActions, number> =
    {
      accent: -Infinity,
      modeNext: -Infinity,
      modePrevious: -Infinity,
      presetNext: -Infinity,
      presetPrevious: -Infinity,
      quickLook1: -Infinity,
      quickLook2: -Infinity,
      quickLook3: -Infinity,
      remix: -Infinity,
    };
  let gestureAnchor: {
    /** The two pointers this gesture is pinned to for its whole lifetime. */
    ids: [number, number];
    normalizedCentroid: { x: number; y: number };
    distance: number;
    /** Last frame's raw angle, for unwrapping the next delta. */
    lastAngle: number;
    /** Rotation accumulated across frames, free to pass ±π. */
    rotation: number;
  } | null = null;

  const boundsSource = boundsElement ?? target;
  if (!target.hasAttribute('tabindex')) {
    target.tabIndex = 0;
  }
  let bounds = boundsSource.getBoundingClientRect();

  const updateBounds = () => {
    bounds = boundsSource.getBoundingClientRect();
  };
  const canPollGamepad = () =>
    gamepadEnabled &&
    typeof document !== 'undefined' &&
    !document.hidden &&
    !!getPrimaryGamepad();

  let resizeObserver: ResizeObserver | null = null;
  const handleWindowResize = () => updateBounds();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateBounds();
    });
    resizeObserver.observe(boundsSource);
  } else {
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleWindowResize);
  }

  const updatePointerFromEvent = (event: PointerEvent) => {
    const normalized = normalizePoint(event.clientX, event.clientY, bounds);
    const pointer: UnifiedPointer = {
      id: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      clientX: event.clientX,
      clientY: event.clientY,
      ...normalized,
    };

    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, pointer);
      return;
    }

    if (event.type === 'pointerdown') {
      activePointers.set(event.pointerId, pointer);
      return;
    }

    if (pointer.pointerType === 'mouse' || pointer.pointerType === 'pen') {
      hoverPointer = pointer;
    }
  };

  const queuePointerEvent = (event: PointerEvent) => {
    if (event.type === 'pointermove') {
      const existingIndex = pendingPointerMoveIndexes.get(event.pointerId);
      if (typeof existingIndex === 'number') {
        pendingPointerEvents[existingIndex] = event;
        scheduleFrame();
        return;
      }
      pendingPointerMoveIndexes.set(
        event.pointerId,
        pendingPointerEvents.length,
      );
    }
    pendingPointerEvents.push(event);
    scheduleFrame();
  };

  const triggerPerformanceAction = (
    action: keyof UnifiedPerformanceActions,
    now: number,
  ) => {
    actionLastTriggeredAt[action] = now;
    if (action === 'accent') {
      lastAccentAt = now;
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (focusOnPress) {
      target.focus({ preventScroll: true });
    }
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures for non-capturing elements.
    }
    triggerPerformanceAction(
      'accent',
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
    );
    queuePointerEvent(event);
  };

  const handlePointerMove = (event: PointerEvent) => {
    queuePointerEvent(event);
  };

  const handlePointerUp = (event: PointerEvent) => {
    try {
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore release failures for non-capturing elements.
    }
    queuePointerEvent(event);
  };

  const handlePointerLeave = (event: PointerEvent) => {
    queuePointerEvent(event);
  };

  const handlePointerLost = (event: PointerEvent) => {
    queuePointerEvent(event);
  };

  target.addEventListener('pointerdown', handlePointerDown);
  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', handlePointerUp);
  target.addEventListener('pointercancel', handlePointerUp);
  target.addEventListener('pointerleave', handlePointerLeave);
  target.addEventListener('pointerout', handlePointerLeave);
  target.addEventListener('lostpointercapture', handlePointerLost);

  const handleWheel = (event: WheelEvent) => {
    if (event.cancelable) {
      event.preventDefault();
    }
    const normalizedDelta = clamp(-event.deltaY / 240, -1.5, 1.5);
    wheelDelta = clamp(wheelDelta + normalizedDelta, -2, 2);
    wheelAccum = clamp(wheelAccum + normalizedDelta, -3, 3);
    scheduleFrame();
  };

  target.addEventListener('wheel', handleWheel, { passive: false });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!keyboardEnabled) return;
    if (isTextInput(document.activeElement)) return;
    const lowerKey = event.key.toLowerCase();
    // The shell reserves bare keys, so a steering chord is never one of its
    // shortcuts even when the unshifted key is: Shift+ArrowLeft steers,
    // ArrowLeft still changes preset.
    const steering = isSteeringChord(lowerKey, event.shiftKey);
    // The shell owns this chord; leave the event completely untouched so its
    // shortcut runs and nothing here double-acts on the same press.
    if (!steering && isReservedByShell(lowerKey)) return;
    keyState.add(lowerKey);
    if (steering) {
      steerKeys.add(lowerKey);
    } else {
      steerKeys.delete(lowerKey);
    }
    // Consume keys this surface handles. Space/e/x/q/z/r/1-3 and the
    // movement arrows all collide with document-level shell shortcuts
    // (stop audio, open editor, quick-select, previous/next preset) — without
    // this, one keystroke on a focused canvas fires both behaviors.
    if (isCanvasConsumedKey(lowerKey, event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!event.repeat) {
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      for (const [action, keys] of Object.entries(PERFORMANCE_ACTION_KEYS) as [
        keyof UnifiedPerformanceActions,
        string[],
      ][]) {
        if (keys.includes(event.key.toLowerCase())) {
          triggerPerformanceAction(action, now);
        }
      }
    }
    scheduleFrame();
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (!keyboardEnabled) return;
    // Deleting unconditionally (rather than mirroring the keydown guard) so a
    // key reserved mid-press cannot stay stuck in the held set.
    const released = event.key.toLowerCase();
    keyState.delete(released);
    // Letting go of Shift ends the chord, so the scene stops moving where the
    // user stopped asking it to.
    if (released === 'shift') {
      steerKeys.clear();
    } else {
      steerKeys.delete(released);
    }
    scheduleFrame();
  };

  // keydown/keyup are bound to the target, so a key released after focus has
  // moved on — clicking a panel button mid-press, cmd-tabbing away — delivers
  // its keyup somewhere else and leaves that key held forever: the synthetic
  // pinch ramps to its clamp and never lifts, the virtual pointer keeps
  // drifting, and `keyState.size > 0` re-arms the rAF loop every frame for the
  // rest of the session. Dropping the held set when the surface stops
  // receiving keys is the release those keys will never get.
  const releaseHeldKeys = () => {
    if (keyState.size === 0 && !keyboardGestureActive) return;
    keyState.clear();
    steerKeys.clear();
    // Losing focus is not the same as letting go: there is no ramp to run,
    // and the release timer only advances on frames the loop is still
    // scheduling. Drop the synthetic pinch here so the visuals cannot stay
    // warped waiting for a countdown nothing is driving.
    resetKeyboardGesture();
    scheduleFrame();
  };
  const handleTargetBlur = () => releaseHeldKeys();
  const handleWindowBlur = () => releaseHeldKeys();
  const handleKeyVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.hidden) releaseHeldKeys();
  };

  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);
  target.addEventListener('blur', handleTargetBlur);
  window.addEventListener('blur', handleWindowBlur);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleKeyVisibilityChange);
  }

  const updateKeyboardPointer = (deltaMs: number) => {
    if (!keyboardEnabled || keyState.size === 0) return null;
    let dx = 0;
    let dy = 0;
    if (steerKeys.has('arrowleft')) dx -= 1;
    if (steerKeys.has('arrowright')) dx += 1;
    if (steerKeys.has('arrowup')) dy += 1;
    if (steerKeys.has('arrowdown')) dy -= 1;

    const magnitude = Math.hypot(dx, dy) || 1;
    // No Shift boost here: Shift is what makes an arrow a steering chord in
    // the first place, so boosting on it would mean the only speed there is
    // — a pointer crossing the stage in two thirds of a second.
    const step = (keyboardSpeed * deltaMs) / 1000;
    keyboardPointer = {
      normalizedX: clamp(
        keyboardPointer.normalizedX + (dx / magnitude) * step,
        -1,
        1,
      ),
      normalizedY: clamp(
        keyboardPointer.normalizedY + (dy / magnitude) * step,
        -1,
        1,
      ),
    };

    return pointerFromNormalized(
      keyboardPointer.normalizedX,
      keyboardPointer.normalizedY,
      bounds,
      9998,
      'keyboard',
    );
  };

  let keyboardGestureScale = 1;
  let keyboardGestureRotation = 0;
  let keyboardGestureActive = false;
  let keyboardGestureIdleMs = 0;

  /** Drop the synthetic pinch outright, with no release ramp. */
  const resetKeyboardGesture = () => {
    keyboardGestureActive = false;
    keyboardGestureScale = 1;
    keyboardGestureRotation = 0;
    keyboardGestureIdleMs = 0;
  };

  // Two-finger gesture stand-in: while = / - / , / . are held the synthetic
  // gesture accumulates like a pinch in progress; releasing the keys for
  // KEYBOARD_GESTURE_RELEASE_MS "lifts the fingers" and resets the anchor.
  const updateKeyboardGesture = (deltaMs: number): UnifiedGesture | null => {
    if (!keyboardEnabled) {
      keyboardGestureActive = false;
      return null;
    }
    const zoomIn = keyState.has('=') || keyState.has('+');
    const zoomOut = keyState.has('-') || keyState.has('_');
    const rotateLeft = keyState.has(',');
    const rotateRight = keyState.has('.');
    const engaged = zoomIn || zoomOut || rotateLeft || rotateRight;

    if (engaged) {
      keyboardGestureActive = true;
      keyboardGestureIdleMs = 0;
      const boost = keyState.has('shift') ? keyboardBoost : 1;
      const scaleRate = (KEYBOARD_GESTURE_SCALE_RATE * boost * deltaMs) / 1000;
      if (zoomIn) keyboardGestureScale *= Math.exp(scaleRate);
      if (zoomOut) keyboardGestureScale *= Math.exp(-scaleRate);
      keyboardGestureScale = clamp(keyboardGestureScale, 0.2, 5);
      const rotationRate =
        (KEYBOARD_GESTURE_ROTATION_RATE * boost * deltaMs) / 1000;
      if (rotateLeft) keyboardGestureRotation -= rotationRate;
      if (rotateRight) keyboardGestureRotation += rotationRate;
    } else if (keyboardGestureActive) {
      keyboardGestureIdleMs += deltaMs;
      if (keyboardGestureIdleMs > KEYBOARD_GESTURE_RELEASE_MS) {
        keyboardGestureActive = false;
        keyboardGestureScale = 1;
        keyboardGestureRotation = 0;
      }
    }

    if (!keyboardGestureActive) return null;
    return {
      pointerCount: 2,
      scale: keyboardGestureScale,
      rotation: keyboardGestureRotation,
      translation: { x: 0, y: 0 },
    };
  };

  const updateGamepadPointer = (deltaMs: number) => {
    if (!gamepadEnabled) return null;
    const pad = getPrimaryGamepad();
    if (!pad) {
      if (lastGamepadConnected) {
        document.body?.classList.remove('gamepad-active');
        lastGamepadConnected = false;
      }
      return null;
    }

    if (!lastGamepadConnected) {
      document.body?.classList.add('gamepad-active');
      lastGamepadConnected = true;
    }

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const deadzone = gamepadDeadzone;
    const dx = Math.abs(axisX) > deadzone ? axisX : 0;
    const dy = Math.abs(axisY) > deadzone ? -axisY : 0;

    if (dx === 0 && dy === 0) {
      return pointerFromNormalized(
        gamepadPointer.normalizedX,
        gamepadPointer.normalizedY,
        bounds,
        9999,
        'gamepad',
      );
    }

    const step = (gamepadSpeed * deltaMs) / 1000;
    gamepadPointer = {
      normalizedX: clamp(gamepadPointer.normalizedX + dx * step, -1, 1),
      normalizedY: clamp(gamepadPointer.normalizedY + dy * step, -1, 1),
    };

    return pointerFromNormalized(
      gamepadPointer.normalizedX,
      gamepadPointer.normalizedY,
      bounds,
      9999,
      'gamepad',
    );
  };

  /**
   * Steering counts as pressed, so pushing the visuals takes one chord.
   *
   * The scene only moves while `isPressed` (dragDelta is gated on it), and
   * the hold key for that was Space or Enter — with Space bound to the
   * shell's stop-audio, this asked for Shift, an arrow and Enter at once to
   * do what a mouse does by dragging.
   */
  const getKeyboardPressed = () =>
    keyState.has(' ') || keyState.has('enter') || steerKeys.size > 0;

  const getGamepadPressed = () => {
    if (!gamepadEnabled) return false;
    const pad = getPrimaryGamepad();
    return Boolean(pad?.buttons?.[0]?.pressed);
  };

  const processPointerEvents = () => {
    const events = pendingPointerEvents.splice(0);
    pendingPointerMoveIndexes.clear();
    for (const event of events) {
      if (event.type === 'pointerup' || event.type === 'pointercancel') {
        activePointers.delete(event.pointerId);
        if (hoverPointer && hoverPointer.id === event.pointerId) {
          hoverPointer = null;
        }
        continue;
      }

      if (event.type === 'pointerleave' || event.type === 'pointerout') {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
          hoverPointer = null;
        }
        continue;
      }

      if (event.type === 'lostpointercapture') {
        activePointers.delete(event.pointerId);
        continue;
      }

      updatePointerFromEvent(event);
    }
  };

  const getPointerSummary = (pointers: UnifiedPointer[]) => {
    if (pointers.length === 0) {
      return {
        centroid: { x: 0, y: 0 },
        normalizedCentroid: { x: 0, y: 0 },
      };
    }

    const total = pointers.reduce(
      (acc, pointer) => {
        acc.x += pointer.clientX;
        acc.y += pointer.clientY;
        acc.normalizedX += pointer.normalizedX;
        acc.normalizedY += pointer.normalizedY;
        return acc;
      },
      { x: 0, y: 0, normalizedX: 0, normalizedY: 0 },
    );

    const divisor = pointers.length || 1;
    return {
      centroid: { x: total.x / divisor, y: total.y / divisor },
      normalizedCentroid: {
        x: total.normalizedX / divisor,
        y: total.normalizedY / divisor,
      },
    };
  };

  const getGesture = (pointers: UnifiedPointer[]): UnifiedGesture | null => {
    if (pointers.length < 2) {
      gestureAnchor = null;
      return null;
    }

    // Pin the gesture to two specific pointer ids for its lifetime. Reading
    // "the first two active pointers" every frame meant a third finger
    // landing, or the first of three lifting, silently swapped which hand
    // positions the anchor was measured against: a motionless three-finger
    // rest reported scale 5 and rotation π the instant one finger came off.
    let p1 = pointers[0];
    let p2 = pointers[1];
    if (gestureAnchor) {
      const anchored1 = pointers.find((p) => p.id === gestureAnchor?.ids[0]);
      const anchored2 = pointers.find((p) => p.id === gestureAnchor?.ids[1]);
      if (anchored1 && anchored2) {
        p1 = anchored1;
        p2 = anchored2;
      } else {
        // One of the anchored fingers left. Re-anchor on whatever is still
        // down rather than carrying a scale measured against a finger that
        // is no longer part of the gesture.
        gestureAnchor = null;
      }
    }

    const dx = p2.clientX - p1.clientX;
    const dy = p2.clientY - p1.clientY;
    const distance = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    // The anchored pair's own centroid, not every active pointer's: a finger
    // joining or leaving would otherwise shift the translation on its own.
    const normalizedCentroid = {
      x: (p1.normalizedX + p2.normalizedX) / 2,
      y: (p1.normalizedY + p2.normalizedY) / 2,
    };

    if (!gestureAnchor) {
      gestureAnchor = {
        ids: [p1.id, p2.id],
        normalizedCentroid,
        distance,
        lastAngle: angle,
        rotation: 0,
      };
      return null;
    }

    // Unwrap: atan2 folds at ±π, so diffing raw angles turned a 1° turn
    // across that seam into a reported 359° one and spun the whole scene.
    const rawDelta = angle - gestureAnchor.lastAngle;
    gestureAnchor.rotation += Math.atan2(
      Math.sin(rawDelta),
      Math.cos(rawDelta),
    );
    gestureAnchor.lastAngle = angle;

    return {
      pointerCount: pointers.length,
      scale: distance / gestureAnchor.distance,
      rotation: gestureAnchor.rotation,
      translation: {
        x: normalizedCentroid.x - gestureAnchor.normalizedCentroid.x,
        y: normalizedCentroid.y - gestureAnchor.normalizedCentroid.y,
      },
    };
  };

  const createState = (now: number): UnifiedInputState => {
    const deltaMs = now - lastFrameTime;
    lastFrameTime = now;

    processPointerEvents();

    const keyboardPointerSnapshot = updateKeyboardPointer(deltaMs);
    const gamepadPointerSnapshot = updateGamepadPointer(deltaMs);
    const keyboardPressed = getKeyboardPressed();
    const gamepadPressed = getGamepadPressed();

    const activePointerList = Array.from(activePointers.values());
    let pointers: UnifiedPointer[] = activePointerList;
    let source: InputSource = activePointerList.length ? 'pointer' : 'none';

    if (pointers.length === 0 && hoverPointer) {
      pointers = [hoverPointer];
      source = 'pointer';
    }

    if (pointers.length === 0 && keyboardPointerSnapshot) {
      pointers = [keyboardPointerSnapshot];
      source = 'keyboard';
    }

    if (pointers.length === 0 && gamepadPointerSnapshot) {
      pointers = [gamepadPointerSnapshot];
      source = 'gamepad';
    }

    if (source !== 'none') {
      lastSource = source;
    }

    const summary = getPointerSummary(pointers);
    // Run the keyboard gesture every frame so its release timer decays even
    // while real pointers take precedence.
    const keyboardGesture = updateKeyboardGesture(deltaMs);
    const gesture = getGesture(activePointerList) ?? keyboardGesture;
    const primary = pointers[0] ?? null;
    const pressed =
      activePointerList.length > 0 || keyboardPressed || gamepadPressed;

    // Same-pointer check: when the finger the primary slot points at changes
    // (one of a multi-touch lifts, or a hover pointer takes over), the two
    // positions belong to different hands and their difference is not a drag
    // — it used to land as one huge dragIntensity spike on the frame of the
    // swap.
    const dragDelta =
      primary && lastPrimary && primary.id === lastPrimary.id && pressed
        ? {
            x: primary.normalizedX - lastPrimary.normalizedX,
            y: primary.normalizedY - lastPrimary.normalizedY,
          }
        : { x: 0, y: 0 };
    const dragIntensity = Math.hypot(dragDelta.x, dragDelta.y);
    const performanceState: UnifiedPerformanceState = {
      hoverActive: Boolean(hoverPointer),
      hover: hoverPointer
        ? {
            x: hoverPointer.normalizedX,
            y: hoverPointer.normalizedY,
          }
        : null,
      wheelDelta,
      wheelAccum,
      dragIntensity,
      dragAngle: dragIntensity > 0 ? Math.atan2(dragDelta.y, dragDelta.x) : 0,
      accentPulse: Math.max(0, 1 - (now - lastAccentAt) / PERFORMANCE_PULSE_MS),
      sourceFlags: {
        pointer: source === 'pointer',
        keyboard: source === 'keyboard',
        gamepad: source === 'gamepad',
        mouse:
          primary?.pointerType === 'mouse' ||
          hoverPointer?.pointerType === 'mouse',
        touch: activePointerList.some(
          (pointer) => pointer.pointerType === 'touch',
        ),
        pen: activePointerList.some((pointer) => pointer.pointerType === 'pen'),
      },
      actions: {
        accent: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.accent) / PERFORMANCE_PULSE_MS,
        ),
        modeNext: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.modeNext) / PERFORMANCE_PULSE_MS,
        ),
        modePrevious: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.modePrevious) / PERFORMANCE_PULSE_MS,
        ),
        presetNext: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.presetNext) / PERFORMANCE_PULSE_MS,
        ),
        presetPrevious: Math.max(
          0,
          1 -
            (now - actionLastTriggeredAt.presetPrevious) / PERFORMANCE_PULSE_MS,
        ),
        quickLook1: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.quickLook1) / PERFORMANCE_PULSE_MS,
        ),
        quickLook2: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.quickLook2) / PERFORMANCE_PULSE_MS,
        ),
        quickLook3: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.quickLook3) / PERFORMANCE_PULSE_MS,
        ),
        remix: Math.max(
          0,
          1 - (now - actionLastTriggeredAt.remix) / PERFORMANCE_PULSE_MS,
        ),
      },
    };

    const state: UnifiedInputState = {
      time: now,
      deltaMs,
      pointers,
      pointerCount: pointers.length,
      centroid: summary.centroid,
      normalizedCentroid: summary.normalizedCentroid,
      primary,
      isPressed: pressed,
      justPressed: pressed && !isPressed,
      justReleased: !pressed && isPressed,
      dragDelta,
      source: source === 'none' ? lastSource : source,
      gesture,
      mic: micProvider?.() ?? { level: 0, available: false },
      performance: performanceState,
    };

    isPressed = pressed;
    lastPrimary = primary;
    wheelDelta *= PERFORMANCE_WHEEL_DECAY;
    wheelAccum *= PERFORMANCE_WHEEL_ACCUM_DECAY;
    if (Math.abs(wheelDelta) < PERFORMANCE_WHEEL_MIN) {
      wheelDelta = 0;
    }
    if (Math.abs(wheelAccum) < PERFORMANCE_WHEEL_MIN) {
      wheelAccum = 0;
    }

    return state;
  };

  const subscribers = new Set<(state: UnifiedInputState) => void>();

  const emitState = () => {
    inputFrameId = null;
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const state = createState(now);
    if (onInput) onInput(state);
    for (const handler of subscribers) {
      handler(state);
    }
    if (
      keyState.size > 0 ||
      // The synthetic pinch releases over KEYBOARD_GESTURE_RELEASE_MS of idle
      // time, which only elapses on frames this loop schedules. Without it the
      // loop stopped on the keyup frame and the last warped gesture stood as
      // the runtime's current input until unrelated activity woke it.
      keyboardGestureActive ||
      activePointers.size > 0 ||
      canPollGamepad() ||
      Math.abs(wheelDelta) > PERFORMANCE_WHEEL_MIN ||
      Math.abs(wheelAccum) > PERFORMANCE_WHEEL_MIN ||
      Object.values(actionLastTriggeredAt).some(
        (value) => now - value < PERFORMANCE_PULSE_MS,
      )
    ) {
      scheduleFrame();
    }
  };

  const scheduleFrame = () => {
    if (
      inputFrameId != null ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return;
    }
    inputFrameId = requestAnimationFrame(emitState);
  };

  const subscribe = (handler: (state: UnifiedInputState) => void) => {
    subscribers.add(handler);
    scheduleFrame();
    return () => subscribers.delete(handler);
  };

  const handleGamepadConnectionChange = () => {
    if (canPollGamepad()) {
      scheduleFrame();
    }
  };

  const handleVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      if (inputFrameId != null) {
        cancelAnimationFrame(inputFrameId);
        inputFrameId = null;
      }
      return;
    }
    scheduleFrame();
  };

  if (gamepadEnabled) {
    window.addEventListener('gamepadconnected', handleGamepadConnectionChange);
    window.addEventListener(
      'gamepaddisconnected',
      handleGamepadConnectionChange,
    );
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    handleGamepadConnectionChange();
  }

  const dispose = () => {
    if (inputFrameId != null) {
      cancelAnimationFrame(inputFrameId);
      inputFrameId = null;
    }
    resizeObserver?.disconnect();
    if (!resizeObserver) {
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('orientationchange', handleWindowResize);
    }
    target.removeEventListener('pointerdown', handlePointerDown);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('pointercancel', handlePointerUp);
    target.removeEventListener('pointerleave', handlePointerLeave);
    target.removeEventListener('pointerout', handlePointerLeave);
    target.removeEventListener('lostpointercapture', handlePointerLost);
    target.removeEventListener('wheel', handleWheel);
    target.removeEventListener('keydown', handleKeyDown);
    target.removeEventListener('keyup', handleKeyUp);
    target.removeEventListener('blur', handleTargetBlur);
    window.removeEventListener('blur', handleWindowBlur);
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        handleKeyVisibilityChange,
      );
    }
    if (gamepadEnabled) {
      window.removeEventListener(
        'gamepadconnected',
        handleGamepadConnectionChange,
      );
      window.removeEventListener(
        'gamepaddisconnected',
        handleGamepadConnectionChange,
      );
      if (typeof document !== 'undefined') {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange,
        );
      }
      if (lastGamepadConnected) {
        document.body?.classList.remove('gamepad-active');
        lastGamepadConnected = false;
      }
    }
    subscribers.clear();
    activePointers.clear();
    pendingPointerEvents.length = 0;
    pendingPointerMoveIndexes.clear();
    keyState.clear();
    steerKeys.clear();
    wheelDelta = 0;
    wheelAccum = 0;
    hoverPointer = null;
  };

  return { subscribe, dispose, scheduleFrame };
}
