type GamepadNavigationOptions = {
  focusableSelector?: string;
  activeClass?: string;
  axisThreshold?: number;
  initialRepeatDelayMs?: number;
  repeatIntervalMs?: number;
  restoreFocus?: boolean;
  focusStorageKey?: string;
};

type FocusDirection = 'next' | 'prev' | 'up' | 'down' | 'left' | 'right';

type StoredFocusState = {
  selector: string | null;
  index: number;
};

const DEFAULT_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DEFAULT_OPTIONS: Required<GamepadNavigationOptions> = {
  focusableSelector: DEFAULT_FOCUSABLE_SELECTOR,
  activeClass: 'gamepad-active',
  axisThreshold: 0.55,
  initialRepeatDelayMs: 220,
  repeatIntervalMs: 120,
  restoreFocus: true,
  focusStorageKey: 'stims:last-focus',
};

const getGamepads = () => navigator.getGamepads?.() ?? [];

const getPrimaryGamepad = () => {
  const pads = Array.from(getGamepads());
  return pads.find((pad) => pad?.connected) ?? null;
};

const getWindowCtor = <T>(
  name: string,
): (new (...args: never[]) => T) | null => {
  const ctor = (globalThis as Record<string, unknown>)[name];
  return typeof ctor === 'function'
    ? (ctor as new (
        ...args: never[]
      ) => T)
    : null;
};

const isInstanceOf = <T>(value: unknown, ctorName: string): value is T => {
  const ctor = getWindowCtor<T>(ctorName);
  return Boolean(ctor && value instanceof ctor);
};

const isFocusable = (element: HTMLElement) => {
  if (element.hasAttribute('disabled')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (element.hasAttribute('hidden')) return false;
  if (
    isInstanceOf<HTMLInputElement>(element, 'HTMLInputElement') &&
    element.type &&
    element.type.toLowerCase() === 'hidden'
  ) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
};

const getActiveScope = (doc: Document) => {
  const modal = doc.querySelector<HTMLElement>(
    'dialog[open], [role="dialog"][aria-modal="true"]',
  );
  return modal ?? doc;
};

const getFocusableElements = (
  root: Document | HTMLElement,
  selector: string,
) => {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>(selector),
  ).filter(isFocusable);
  return elements;
};

const getElementCenter = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
};

const findDirectionalFocusTarget = (
  active: HTMLElement,
  elements: HTMLElement[],
  direction: Exclude<FocusDirection, 'next' | 'prev'>,
) => {
  const origin = getElementCenter(active);
  const candidates = elements.filter((element) => element !== active);

  type ScoredElement = {
    element: HTMLElement;
    score: number;
  };

  const scored = candidates
    .map((element) => {
      const center = getElementCenter(element);
      const dx = center.x - origin.x;
      const dy = center.y - origin.y;

      if (direction === 'up' && dy >= 0) return null;
      if (direction === 'down' && dy <= 0) return null;
      if (direction === 'left' && dx >= 0) return null;
      if (direction === 'right' && dx <= 0) return null;

      if (
        (direction === 'up' || direction === 'down') &&
        Math.abs(dy) < Math.abs(dx)
      ) {
        return null;
      }

      if (
        (direction === 'left' || direction === 'right') &&
        Math.abs(dx) < Math.abs(dy)
      ) {
        return null;
      }

      const primaryDistance =
        direction === 'up' || direction === 'down'
          ? Math.abs(dy)
          : Math.abs(dx);
      const secondaryDistance =
        direction === 'up' || direction === 'down'
          ? Math.abs(dx)
          : Math.abs(dy);

      return {
        element,
        score: primaryDistance + secondaryDistance * 0.35,
      } satisfies ScoredElement;
    })
    .filter((entry): entry is ScoredElement => entry !== null)
    .sort((a, b) => a.score - b.score);

  return scored[0]?.element ?? null;
};

const moveFocus = (
  direction: FocusDirection,
  selector: string,
  doc: Document,
) => {
  const scope = getActiveScope(doc);
  const elements = getFocusableElements(scope, selector);
  if (elements.length === 0) {
    if (scope instanceof HTMLElement) scope.focus();
    return;
  }

  const active = doc.activeElement as HTMLElement | null;

  if (
    active &&
    ['up', 'down', 'left', 'right'].includes(direction) &&
    elements.includes(active)
  ) {
    const directionalTarget = findDirectionalFocusTarget(
      active,
      elements,
      direction as Exclude<FocusDirection, 'next' | 'prev'>,
    );
    if (directionalTarget) {
      directionalTarget.focus();
      return;
    }
  }

  const currentIndex = active ? elements.indexOf(active) : -1;
  const delta =
    direction === 'next' || direction === 'right' || direction === 'down'
      ? 1
      : -1;
  const nextIndex = currentIndex + delta;
  const wrappedIndex =
    ((nextIndex % elements.length) + elements.length) % elements.length;
  elements[wrappedIndex]?.focus();
};

const adjustRangeInput = (
  input: HTMLInputElement,
  direction: 'increment' | 'decrement',
) => {
  const stepValue = Number.parseFloat(input.step);
  const step = Number.isFinite(stepValue) && stepValue > 0 ? stepValue : 1;
  const min = Number.parseFloat(input.min);
  const max = Number.parseFloat(input.max);
  const currentValue = Number.parseFloat(input.value || '0');
  const nextValue =
    direction === 'increment' ? currentValue + step : currentValue - step;
  const clampedValue = Math.max(
    Number.isFinite(min) ? min : -Infinity,
    Math.min(Number.isFinite(max) ? max : Infinity, nextValue),
  );
  input.value = String(clampedValue);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const isTextInput = (element: HTMLElement) =>
  isInstanceOf<HTMLInputElement>(element, 'HTMLInputElement') &&
  ['text', 'search', 'email', 'url', 'tel', 'password'].includes(element.type);

const activateElement = (element: HTMLElement | null) => {
  if (!element) return;
  if (
    isInstanceOf<HTMLInputElement>(element, 'HTMLInputElement') &&
    ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(element.type)
  ) {
    element.click();
    return;
  }

  if (isInstanceOf<HTMLSelectElement>(element, 'HTMLSelectElement')) {
    element.click();
    return;
  }

  if (
    isInstanceOf<HTMLButtonElement>(element, 'HTMLButtonElement') ||
    isInstanceOf<HTMLAnchorElement>(element, 'HTMLAnchorElement')
  ) {
    element.click();
    return;
  }

  if (typeof element.click === 'function') {
    element.click();
  } else {
    element.focus();
  }
};

const triggerBackAction = (doc: Document) => {
  const backButton = doc.querySelector<HTMLElement>(
    '[data-back-to-library], [data-back], .toy-nav__back',
  );
  if (backButton) {
    backButton.click();
    return true;
  }
  return false;
};

const dispatchEscape = (doc: Document) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
  });
  doc.dispatchEvent(event);
};

const escapeSelector = (value: string) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
};

const getFocusStateStorageKey = (baseKey: string) => {
  const url =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : 'unknown';
  return `${baseKey}:${url}`;
};

const readStoredFocusState = (baseKey: string): StoredFocusState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(getFocusStateStorageKey(baseKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFocusState;
    if (typeof parsed?.index !== 'number') return null;
    return {
      selector: typeof parsed.selector === 'string' ? parsed.selector : null,
      index: parsed.index,
    };
  } catch (_error) {
    return null;
  }
};

const writeStoredFocusState = (baseKey: string, state: StoredFocusState) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      getFocusStateStorageKey(baseKey),
      JSON.stringify(state),
    );
  } catch (_error) {
    // Ignore storage errors.
  }
};

const getElementSelector = (element: HTMLElement) => {
  if (element.id) {
    return `#${escapeSelector(element.id)}`;
  }
  const explicitKey = element.getAttribute('data-focus-key');
  if (explicitKey) {
    return `[data-focus-key="${escapeSelector(explicitKey)}"]`;
  }
  return null;
};

const focusFirstAvailable = (doc: Document, selector: string) => {
  const scope = getActiveScope(doc);
  const elements = getFocusableElements(scope, selector);
  const first = elements[0];
  if (first) {
    first.focus();
    return first;
  }
  if (scope instanceof HTMLElement) {
    scope.focus();
  }
  return null;
};

const restoreLastFocusedElement = (
  doc: Document,
  selector: string,
  focusStorageKey: string,
) => {
  const stored = readStoredFocusState(focusStorageKey);
  if (!stored) return null;

  const scope = getActiveScope(doc);
  if (stored.selector) {
    const bySelector = scope.querySelector<HTMLElement>(stored.selector);
    if (bySelector && isFocusable(bySelector)) {
      bySelector.focus();
      return bySelector;
    }
  }

  const elements = getFocusableElements(scope, selector);
  if (elements.length === 0) return null;
  const clampedIndex = Math.max(0, Math.min(elements.length - 1, stored.index));
  const target = elements[clampedIndex] ?? elements[0] ?? null;
  target?.focus();
  return target;
};

export const shouldDispatchEscapeFallback = (originKey: string) =>
  originKey !== 'Escape';

const DIRECTIONAL_KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
} as const satisfies Record<string, Exclude<FocusDirection, 'next' | 'prev'>>;

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

const isDirectionalKey = (
  key: string,
): key is keyof typeof DIRECTIONAL_KEYS => {
  return key in DIRECTIONAL_KEYS;
};

const getDirectionFromKey = (
  key: keyof typeof DIRECTIONAL_KEYS,
): Exclude<FocusDirection, 'next' | 'prev'> => DIRECTIONAL_KEYS[key];

const isBackKey = (event: KeyboardEvent) => {
  if (BACK_KEYS.has(event.key)) {
    return true;
  }
  const keyCode = event.keyCode || event.which || 0;
  return LEGACY_BACK_KEY_CODES.has(keyCode);
};

const isEnterLikeKey = (event: KeyboardEvent) => {
  if (ENTER_KEYS.has(event.key)) {
    return true;
  }
  const keyCode = event.keyCode || event.which || 0;
  return LEGACY_ENTER_KEY_CODES.has(keyCode);
};

export const shouldHandleBackKey = (event: KeyboardEvent) => isBackKey(event);
export const shouldHandleEnterLikeKey = (event: KeyboardEvent) =>
  isEnterLikeKey(event);

export const initGamepadNavigation = (
  options: GamepadNavigationOptions = {},
) => {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const doc = document;
  const body = doc.body;
  if (!body) return () => {};

  let lastButtons: boolean[] = [];
  let lastDirection: FocusDirection | null = null;
  let nextMoveTime = 0;
  let rafId: number | null = null;

  const setActive = () => {
    if (!body.classList.contains(resolved.activeClass)) {
      body.classList.add(resolved.activeClass);
    }
  };

  const triggerBackOrEscape = (originKey: string = 'Escape') => {
    if (!triggerBackAction(doc) && shouldDispatchEscapeFallback(originKey)) {
      dispatchEscape(doc);
    }
  };

  const getDirection = (pad: Gamepad): FocusDirection | null => {
    const buttons = pad.buttons;
    if (buttons[12]?.pressed) return 'up';
    if (buttons[13]?.pressed) return 'down';
    if (buttons[14]?.pressed) return 'left';
    if (buttons[15]?.pressed) return 'right';

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const absX = Math.abs(axisX);
    const absY = Math.abs(axisY);
    if (absX < resolved.axisThreshold && absY < resolved.axisThreshold) {
      return null;
    }
    if (absX >= absY) {
      return axisX > 0 ? 'right' : 'left';
    }
    return axisY > 0 ? 'down' : 'up';
  };

  const handleDirectional = (now: number, pad: Gamepad) => {
    const active = doc.activeElement as HTMLElement | null;
    const direction = getDirection(pad);
    if (!direction) {
      lastDirection = null;
      return;
    }

    setActive();
    const isRepeat = lastDirection === direction;

    if (
      isInstanceOf<HTMLInputElement>(active, 'HTMLInputElement') &&
      active.type === 'range' &&
      (direction === 'left' || direction === 'right')
    ) {
      if (now < nextMoveTime) return;
      adjustRangeInput(
        active,
        direction === 'right' ? 'increment' : 'decrement',
      );
      lastDirection = direction;
      nextMoveTime =
        now +
        (isRepeat ? resolved.repeatIntervalMs : resolved.initialRepeatDelayMs);
      return;
    }

    if (active && isTextInput(active)) {
      return;
    }

    if (now < nextMoveTime) return;
    moveFocus(direction, resolved.focusableSelector, doc);
    lastDirection = direction;
    nextMoveTime =
      now +
      (isRepeat ? resolved.repeatIntervalMs : resolved.initialRepeatDelayMs);
  };

  const handleButtons = (pad: Gamepad) => {
    const pressed = pad.buttons.map((button) => button.pressed);
    const wasPressed = (index: number) => lastButtons[index] ?? false;

    const aPressed = pressed[0] && !wasPressed(0);
    const bPressed = pressed[1] && !wasPressed(1);
    const leftBumper = pressed[4] && !wasPressed(4);
    const rightBumper = pressed[5] && !wasPressed(5);

    if (aPressed) {
      setActive();
      const active = doc.activeElement as HTMLElement | null;
      const target =
        active ?? focusFirstAvailable(doc, resolved.focusableSelector);
      activateElement(target);
    }

    if (bPressed) {
      setActive();
      triggerBackOrEscape('GamepadB');
    }

    if (leftBumper) {
      setActive();
      moveFocus('prev', resolved.focusableSelector, doc);
    }

    if (rightBumper) {
      setActive();
      moveFocus('next', resolved.focusableSelector, doc);
    }

    lastButtons = pressed;
  };

  const tick = (now: number) => {
    const pad = getPrimaryGamepad();
    if (pad) {
      handleDirectional(now, pad);
      handleButtons(pad);
    }
    rafId = window.requestAnimationFrame(tick);
  };

  const handleConnect = () => {
    if (!doc.activeElement || doc.activeElement === doc.body) {
      if (resolved.restoreFocus) {
        restoreLastFocusedElement(
          doc,
          resolved.focusableSelector,
          resolved.focusStorageKey,
        );
      }
      focusFirstAvailable(doc, resolved.focusableSelector);
    }

    if (rafId === null) {
      rafId = window.requestAnimationFrame(tick);
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    const active = doc.activeElement as HTMLElement | null;
    if (active && isTextInput(active)) {
      if (event.key !== 'Escape') return;
    }

    if (isDirectionalKey(event.key)) {
      setActive();
      moveFocus(
        getDirectionFromKey(event.key),
        resolved.focusableSelector,
        doc,
      );
      event.preventDefault();
      return;
    }

    if (isEnterLikeKey(event)) {
      setActive();
      const target =
        active ?? focusFirstAvailable(doc, resolved.focusableSelector);
      activateElement(target);
      event.preventDefault();
      return;
    }

    if (isBackKey(event)) {
      setActive();
      triggerBackOrEscape(event.key);
      event.preventDefault();
    }
  };

  const onDocumentFocusIn = (event: FocusEvent) => {
    if (!resolved.restoreFocus) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const scope = getActiveScope(doc);
    const elements = getFocusableElements(scope, resolved.focusableSelector);
    const index = elements.indexOf(target);
    if (index < 0) return;
    writeStoredFocusState(resolved.focusStorageKey, {
      selector: getElementSelector(target),
      index,
    });
  };

  const handleDisconnect = () => {
    if (!getPrimaryGamepad()) {
      body.classList.remove(resolved.activeClass);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
  };

  window.addEventListener('gamepadconnected', handleConnect);
  window.addEventListener('gamepaddisconnected', handleDisconnect);
  window.addEventListener('keydown', handleKeydown);
  doc.addEventListener('focusin', onDocumentFocusIn);

  if (
    resolved.restoreFocus &&
    (!doc.activeElement || doc.activeElement === doc.body)
  ) {
    if (
      !restoreLastFocusedElement(
        doc,
        resolved.focusableSelector,
        resolved.focusStorageKey,
      )
    ) {
      focusFirstAvailable(doc, resolved.focusableSelector);
    }
  }

  if (getPrimaryGamepad()) {
    handleConnect();
  }

  return () => {
    window.removeEventListener('gamepadconnected', handleConnect);
    window.removeEventListener('gamepaddisconnected', handleDisconnect);
    window.removeEventListener('keydown', handleKeydown);
    doc.removeEventListener('focusin', onDocumentFocusIn);
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
    }
  };
};
