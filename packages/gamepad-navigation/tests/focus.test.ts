import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { initGamepadNavigation } from '../src/index.ts';

describe('gamepad navigation focus initialization and restoration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  test('focuses the first interactive element when no active focus exists', () => {
    const first = document.createElement('button');
    first.id = 'first';
    first.textContent = 'First';
    const second = document.createElement('button');
    second.textContent = 'Second';
    document.body.append(first, second);

    const cleanup = initGamepadNavigation();

    expect(document.activeElement).toBe(first);
    cleanup();
  });

  test('restores the previous focused element from session storage', () => {
    const first = document.createElement('button');
    first.id = 'first';
    const second = document.createElement('button');
    second.id = 'second';
    document.body.append(first, second);

    const storageKey = `stims:last-focus:${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ selector: '#second', index: 1 }),
    );

    const cleanup = initGamepadNavigation({
      focusStorageKey: 'stims:last-focus',
    });

    expect(document.activeElement).toBe(second);
    cleanup();
  });
});

describe('keyboard-as-remote gating', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('gamepad-active');
    sessionStorage.clear();
  });

  const arrowRight = () =>
    new window.KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });

  test('by default an arrow key neither moves focus nor claims the event', () => {
    // In the app this came from, the shell owns the arrow keys on a desktop
    // (they change preset). With this layer also handling them, every → walked
    // focus one element along and left the skip link visible over the stage.
    const stage = document.createElement('div');
    stage.tabIndex = -1;
    const skip = document.createElement('a');
    skip.href = '#stage';
    skip.textContent = 'Skip';
    document.body.append(skip, stage);
    stage.focus();

    const cleanup = initGamepadNavigation({ restoreFocus: false });
    const event = arrowRight();
    stage.dispatchEvent(event);

    expect(document.activeElement).toBe(stage);
    expect(event.defaultPrevented).toBeFalse();
    expect(document.body.classList.contains('gamepad-active')).toBeFalse();
    cleanup();
  });

  test('on a leanback device the same key moves focus like a D-pad', () => {
    const stage = document.createElement('div');
    stage.tabIndex = -1;
    const skip = document.createElement('a');
    skip.href = '#stage';
    skip.textContent = 'Skip';
    document.body.append(skip, stage);
    stage.focus();

    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    const event = arrowRight();
    stage.dispatchEvent(event);

    expect(document.activeElement).toBe(skip);
    expect(event.defaultPrevented).toBeTrue();
    cleanup();
  });

  test('a disclosure summary is reachable and opens like a button', () => {
    // Help text and "Advanced" settings are often <details> whose only
    // toggle is the <summary>; a D-pad that skipped it could never open them.
    const button = document.createElement('button');
    button.textContent = 'Use demo audio';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Audio help';
    details.append(summary, document.createElement('p'));
    document.body.append(button, details);
    button.focus();

    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    button.dispatchEvent(arrowRight());
    expect(document.activeElement).toBe(summary);

    summary.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(details.open).toBeTrue();
    cleanup();
  });
});

describe('directional focus by geometry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('gamepad-active');
    sessionStorage.clear();
  });

  /** A button that reports the given box; happy-dom lays nothing out. */
  const placed = (id: string, x: number, y: number) => {
    const button = document.createElement('button');
    button.id = id;
    button.getBoundingClientRect = () =>
      ({ left: x, top: y, width: 100, height: 40 }) as DOMRect;
    document.body.append(button);
    return button;
  };

  const key = (name: string) =>
    new window.KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
    });

  test('a direction goes to the nearest element that way, not the next in document order', () => {
    // Document order: a, below, right. From a, "right" must reach `right`
    // even though `below` comes first in the DOM.
    const a = placed('a', 0, 0);
    placed('below', 0, 200);
    const right = placed('right', 300, 0);
    a.focus();

    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    a.dispatchEvent(key('ArrowRight'));
    expect(document.activeElement).toBe(right);
    cleanup();
  });

  test('with nothing in that direction, focus wraps in document order', () => {
    const a = placed('a', 0, 0);
    const b = placed('b', 0, 200);
    b.focus();

    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    // Nothing is below b; "down" steps forward and wraps to a.
    b.dispatchEvent(key('ArrowDown'));
    expect(document.activeElement).toBe(a);
    cleanup();
  });

  test('a focused range input is stepped rather than left', async () => {
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '10';
    slider.step = '2';
    slider.value = '4';
    const after = placed('after', 300, 0);
    document.body.prepend(slider);
    slider.focus();
    const inputs: string[] = [];
    slider.addEventListener('input', () => inputs.push(slider.value));

    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    // The keyboard layer moves focus from a slider (arrows are its own
    // keys); the gamepad path steps it. Drive the gamepad path through a
    // fake pad on one animation frame.
    const pad = {
      connected: true,
      buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
      axes: [0, 0],
    };
    pad.buttons[15] = { pressed: true };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad],
    });
    window.dispatchEvent(new window.Event('gamepadconnected'));
    await nextFrame();
    expect(document.activeElement).toBe(slider);
    expect(inputs).toEqual(['6']);
    expect(after.matches(':focus')).toBe(false);
    pad.connected = false;
    cleanup();
    Reflect.deleteProperty(navigator, 'getGamepads');
  });
});

const nextFrame = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
