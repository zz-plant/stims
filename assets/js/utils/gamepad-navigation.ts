type GamepadNavigationOptions = {
  focusableSelector?: string;
  activeClass?: string;
  axisThreshold?: number;
  initialRepeatDelayMs?: number;
  repeatIntervalMs?: number;
};

const DEFAULT_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DEFAULT_OPTIONS: Required<GamepadNavigationOptions> = {
  focusableSelector: DEFAULT_FOCUSABLE_SELECTOR,
  activeClass: 'gamepad-active',
  axisThreshold: 0.55,
  initialRepeatDelayMs: 220,
  repeatIntervalMs: 120,
};

const getGamepads = () => navigator.getGamepads?.() ?? [];

const getPrimaryGamepad = () => {
  const pads = Array.from(getGamepads());
  return pads.find((pad) => pad?.connected) ?? null;
};

const isFocusable = (element: HTMLElement) => {
  if (element.hasAttribute('disabled')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (element.hasAttribute('hidden')) return false;
  if (
    element instanceof HTMLInputElement &&
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

const moveFocus = (
  direction: 'next' | 'prev',
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
  const currentIndex = active ? elements.indexOf(active) : -1;
  const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
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
  element instanceof HTMLInputElement &&
  ['text', 'search', 'email', 'url', 'tel', 'password'].includes(element.type);

const activateElement = (element: HTMLElement | null) => {
  if (!element) return;
  if (
    element instanceof HTMLInputElement &&
    ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(element.type)
  ) {
    element.click();
    return;
  }

  if (element instanceof HTMLSelectElement) {
    element.click();
    return;
  }

  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement
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

export const initGamepadNavigation = (
  options: GamepadNavigationOptions = {},
) => {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const doc = document;
  const body = doc.body;
  if (!body) return () => {};

  let lastButtons: boolean[] = [];
  let lastDirection: 'next' | 'prev' | null = null;
  let nextMoveTime = 0;
  let rafId: number | null = null;

  const setActive = () => {
    if (!body.classList.contains(resolved.activeClass)) {
      body.classList.add(resolved.activeClass);
    }
  };

  const getDirection = (pad: Gamepad): 'next' | 'prev' | null => {
    const buttons = pad.buttons;
    if (buttons[12]?.pressed) return 'prev';
    if (buttons[13]?.pressed) return 'next';
    if (buttons[14]?.pressed) return 'prev';
    if (buttons[15]?.pressed) return 'next';

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const absX = Math.abs(axisX);
    const absY = Math.abs(axisY);
    if (absX < resolved.axisThreshold && absY < resolved.axisThreshold) {
      return null;
    }
    if (absX >= absY) {
      return axisX > 0 ? 'next' : 'prev';
    }
    return axisY > 0 ? 'next' : 'prev';
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
      active instanceof HTMLInputElement &&
      active.type === 'range' &&
      (direction === 'next' || direction === 'prev')
    ) {
      if (now < nextMoveTime) return;
      adjustRangeInput(
        active,
        direction === 'next' ? 'increment' : 'decrement',
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
    moveFocus(
      direction === 'next' ? 'next' : 'prev',
      resolved.focusableSelector,
      doc,
    );
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
      activateElement(active);
    }

    if (bPressed) {
      setActive();
      if (!triggerBackAction(doc)) {
        dispatchEscape(doc);
      }
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
    if (rafId === null) {
      rafId = window.requestAnimationFrame(tick);
    }
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

  if (getPrimaryGamepad()) {
    handleConnect();
  }

  return () => {
    window.removeEventListener('gamepadconnected', handleConnect);
    window.removeEventListener('gamepaddisconnected', handleDisconnect);
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
    }
  };
};
