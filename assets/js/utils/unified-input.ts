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
};

export type UnifiedGesture = {
  pointerCount: number;
  scale: number;
  rotation: number;
  translation: { x: number; y: number };
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
  const pads = navigator.getGamepads?.() ?? [];
  return Array.from(pads).find((pad) => pad?.connected) ?? null;
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
  const keyState = new Set<string>();
  let keyboardPointer = { normalizedX: 0, normalizedY: 0 };
  let gamepadPointer = { normalizedX: 0, normalizedY: 0 };
  let lastFrameTime =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  let lastPrimary: UnifiedPointer | null = null;
  let isPressed = false;
  let inputFrameId: number | null = null;
  let gamepadFrameId: number | null = null;
  let lastSource: InputSource = 'none';
  let lastGamepadConnected = false;
  let gestureAnchor: {
    centroid: { x: number; y: number };
    normalizedCentroid: { x: number; y: number };
    distance: number;
    angle: number;
  } | null = null;

  const boundsSource = boundsElement ?? target;
  if (!target.hasAttribute('tabindex')) {
    target.tabIndex = 0;
  }
  let bounds = boundsSource.getBoundingClientRect();

  const updateBounds = () => {
    bounds = boundsSource.getBoundingClientRect();
  };

  const resizeObserver = new ResizeObserver(() => {
    updateBounds();
  });
  resizeObserver.observe(boundsSource);

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
    pendingPointerEvents.push(event);
    scheduleFrame();
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

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!keyboardEnabled) return;
    if (isTextInput(document.activeElement)) return;
    keyState.add(event.key.toLowerCase());
    scheduleFrame();
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (!keyboardEnabled) return;
    keyState.delete(event.key.toLowerCase());
    scheduleFrame();
  };

  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);

  const updateKeyboardPointer = (deltaMs: number) => {
    if (!keyboardEnabled || keyState.size === 0) return null;
    let dx = 0;
    let dy = 0;
    if (keyState.has('arrowleft') || keyState.has('a')) dx -= 1;
    if (keyState.has('arrowright') || keyState.has('d')) dx += 1;
    if (keyState.has('arrowup') || keyState.has('w')) dy += 1;
    if (keyState.has('arrowdown') || keyState.has('s')) dy -= 1;

    const magnitude = Math.hypot(dx, dy) || 1;
    const boost = keyState.has('shift') ? keyboardBoost : 1;
    const step = (keyboardSpeed * boost * deltaMs) / 1000;
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

  const getKeyboardPressed = () => keyState.has(' ') || keyState.has('enter');

  const getGamepadPressed = () => {
    if (!gamepadEnabled) return false;
    const pad = getPrimaryGamepad();
    return Boolean(pad?.buttons?.[0]?.pressed);
  };

  const processPointerEvents = () => {
    for (const event of pendingPointerEvents.splice(0)) {
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

  const getGesture = (
    pointers: UnifiedPointer[],
    summary: ReturnType<typeof getPointerSummary>,
  ): UnifiedGesture | null => {
    if (pointers.length < 2) {
      gestureAnchor = null;
      return null;
    }

    const [p1, p2] = pointers;
    const dx = p2.clientX - p1.clientX;
    const dy = p2.clientY - p1.clientY;
    const distance = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);

    if (!gestureAnchor) {
      gestureAnchor = {
        centroid: summary.centroid,
        normalizedCentroid: summary.normalizedCentroid,
        distance,
        angle,
      };
      return null;
    }

    return {
      pointerCount: pointers.length,
      scale: distance / gestureAnchor.distance,
      rotation: angle - gestureAnchor.angle,
      translation: {
        x: summary.normalizedCentroid.x - gestureAnchor.normalizedCentroid.x,
        y: summary.normalizedCentroid.y - gestureAnchor.normalizedCentroid.y,
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
    const activeSummary = getPointerSummary(activePointerList);
    const gesture = getGesture(activePointerList, activeSummary);
    const primary = pointers[0] ?? null;
    const pressed =
      activePointerList.length > 0 || keyboardPressed || gamepadPressed;

    const dragDelta =
      primary && lastPrimary && pressed
        ? {
            x: primary.normalizedX - lastPrimary.normalizedX,
            y: primary.normalizedY - lastPrimary.normalizedY,
          }
        : { x: 0, y: 0 };

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
    };

    isPressed = pressed;
    lastPrimary = primary;

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
      activePointers.size > 0 ||
      (gamepadEnabled && getPrimaryGamepad())
    ) {
      scheduleFrame();
    }
  };

  const scheduleFrame = () => {
    if (inputFrameId != null) return;
    inputFrameId = requestAnimationFrame(emitState);
  };

  const subscribe = (handler: (state: UnifiedInputState) => void) => {
    subscribers.add(handler);
    scheduleFrame();
    return () => subscribers.delete(handler);
  };

  if (gamepadEnabled) {
    const pollGamepad = () => {
      if (getPrimaryGamepad()) {
        scheduleFrame();
      }
      gamepadFrameId = requestAnimationFrame(pollGamepad);
    };
    gamepadFrameId = requestAnimationFrame(pollGamepad);
  }

  const dispose = () => {
    if (inputFrameId != null) {
      cancelAnimationFrame(inputFrameId);
    }
    if (gamepadFrameId != null) {
      cancelAnimationFrame(gamepadFrameId);
    }
    resizeObserver.disconnect();
    target.removeEventListener('pointerdown', handlePointerDown);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('pointercancel', handlePointerUp);
    target.removeEventListener('pointerleave', handlePointerLeave);
    target.removeEventListener('pointerout', handlePointerLeave);
    target.removeEventListener('lostpointercapture', handlePointerLost);
    target.removeEventListener('keydown', handleKeyDown);
    target.removeEventListener('keyup', handleKeyUp);
    subscribers.clear();
    activePointers.clear();
    hoverPointer = null;
  };

  return { subscribe, dispose, scheduleFrame };
}
