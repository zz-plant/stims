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

describe('whether taking focus scrolls the page to it', () => {
  // Stopped after each test, pass or fail: a layer left running would move
  // focus in the tests that follow.
  let stop = () => {};

  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    stop();
    stop = () => {};
    document.body.innerHTML = '';
    document.body.classList.remove('gamepad-active');
    sessionStorage.clear();
  });

  /**
   * What each `focus()` on the element asked of the browser. happy-dom lays
   * nothing out, so the scroll cannot be measured here; whether the browser
   * was told not to scroll can.
   */
  const focusRequests = (element: HTMLElement) => {
    const requests: (FocusOptions | undefined)[] = [];
    const focus = element.focus.bind(element);
    element.focus = (options?: FocusOptions) => {
      requests.push(options);
      focus(options);
    };
    return requests;
  };

  /** The first focusable element of a page whose controls come later. */
  const footerLink = () => {
    const link = document.createElement('a');
    link.href = '/';
    link.textContent = 'Visualizer';
    document.body.append(link);
    return link;
  };

  test('focus taken at start leaves the page where it is', () => {
    // In the app this came from, the first focusable element at start was a
    // footer link below the fold, and focusing it scrolled the page down to
    // it on load.
    const link = footerLink();
    const requests = focusRequests(link);

    stop = initGamepadNavigation();

    expect(document.activeElement).toBe(link);
    expect(requests).toEqual([{ preventScroll: true }]);
  });

  test('focus restored at start leaves the page where it is', () => {
    // The start above is remembered, so a reload restores the same link.
    const link = footerLink();
    const requests = focusRequests(link);
    sessionStorage.setItem(
      `stims:last-focus:${window.location.pathname}${window.location.search}`,
      JSON.stringify({ selector: null, index: 0 }),
    );

    stop = initGamepadNavigation({ focusStorageKey: 'stims:last-focus' });

    expect(document.activeElement).toBe(link);
    expect(requests).toEqual([{ preventScroll: true }]);
  });

  test('focus taken when a pad connects scrolls to its target', async () => {
    // Someone holding a controller needs to see what it is pointing at.
    stop = initGamepadNavigation({ restoreFocus: false });
    const link = footerLink();
    const requests = focusRequests(link);

    await pressOnPad(PAD_RB);

    expect(document.activeElement).toBe(link);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((options) => options?.preventScroll)).toBeFalse();
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

/** One press of one button by a scripted pad, on the real polling path. */
const pressOnPad = async (button: number) => {
  const pad = {
    connected: true,
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
    axes: [0, 0],
  };
  pad.buttons[button] = { pressed: true };
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => [pad],
  });
  window.dispatchEvent(new window.Event('gamepadconnected'));
  await nextFrame();
  pad.connected = false;
  Reflect.deleteProperty(navigator, 'getGamepads');
};

const PAD_B = 1;
const PAD_RB = 5;

const keydown = (name: string) =>
  new window.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
  });

describe('elements under a hidden ancestor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('gamepad-active');
    sessionStorage.clear();
  });

  /** A top-left button, a button in a hidden section, and a third button. */
  const mount = () => {
    const first = document.createElement('button');
    first.getBoundingClientRect = () =>
      ({ left: 10, top: 10, width: 100, height: 40 }) as DOMRect;
    const section = document.createElement('div');
    section.style.display = 'none';
    const hidden = document.createElement('button');
    section.append(hidden);
    const last = document.createElement('button');
    last.getBoundingClientRect = () =>
      ({ left: 300, top: 10, width: 100, height: 40 }) as DOMRect;
    document.body.append(first, section, last);
    first.focus();
    return { first, hidden, last };
  };

  test('RB steps past a button inside a display: none parent', async () => {
    const { last } = mount();
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_RB);
    expect(document.activeElement).toBe(last);
    cleanup();
  });

  test('left does not pick the origin box of a hidden button', () => {
    // A hidden box reports (0, 0), up and to the left of any real element.
    // With nothing truly to the left, left steps back and wraps to the end.
    const { first, last } = mount();
    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    first.dispatchEvent(keydown('ArrowLeft'));
    expect(document.activeElement).toBe(last);
    cleanup();
  });

  test('without checkVisibility, an element with no client rects is skipped', async () => {
    // The older Chromium builds on TVs; happy-dom always reports one rect.
    const { hidden, last } = mount();
    Object.assign(hidden, {
      checkVisibility: undefined,
      getClientRects: () => [],
    });
    Object.assign(last, { checkVisibility: undefined });
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_RB);
    expect(document.activeElement).toBe(last);
    cleanup();
  });
});

describe('a back press on a native dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('gamepad-active');
    sessionStorage.clear();
  });

  /** An open dialog with focus inside, counting its `close` events. */
  const openDialog = (parent: HTMLElement = document.body) => {
    const dialog = document.createElement('dialog');
    const inside = document.createElement('button');
    dialog.append(inside);
    parent.append(dialog);
    dialog.show();
    inside.focus();
    const closes: string[] = [];
    dialog.addEventListener('close', () => closes.push('close'));
    return { dialog, inside, closes };
  };

  test('pad B closes it, once', async () => {
    const { dialog, closes } = openDialog();
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_B);
    expect(dialog.open).toBeFalse();
    expect(closes).toEqual(['close']);
    cleanup();
  });

  test('Backspace closes it once, though its Escape comes back through the layer', () => {
    const { dialog, inside, closes } = openDialog();
    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    const event = keydown('Backspace');
    inside.dispatchEvent(event);
    expect(dialog.open).toBeFalse();
    expect(closes).toEqual(['close']);
    expect(event.defaultPrevented).toBeTrue();
    cleanup();
  });

  test('a real Escape is left for the browser, which closes it natively', () => {
    const { dialog, inside } = openDialog();
    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    const event = keydown('Escape');
    inside.dispatchEvent(event);
    expect(event.defaultPrevented).toBeFalse();
    // happy-dom has no close watcher, so nothing closes it here.
    expect(dialog.open).toBeTrue();
    cleanup();
  });

  test('a real Escape with no dialog open is still claimed', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    const event = keydown('Escape');
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBeTrue();
    cleanup();
  });

  test('a cancel listener that calls preventDefault keeps it open', async () => {
    const { dialog, closes } = openDialog();
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_B);
    expect(dialog.open).toBeTrue();
    expect(closes).toEqual([]);
    cleanup();
  });

  test('requestClose is used where the browser has it', async () => {
    const { dialog } = openDialog();
    let requests = 0;
    Object.assign(dialog, { requestClose: () => requests++ });
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_B);
    expect(requests).toBe(1);
    cleanup();
  });

  test('a page Escape listener that closed it does not close the dialog beneath', async () => {
    const lower = openDialog();
    const upper = openDialog();
    const onEscape = () => upper.dialog.close();
    document.addEventListener('keydown', onEscape);
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_B);
    document.removeEventListener('keydown', onEscape);
    expect(upper.closes).toEqual(['close']);
    expect(lower.dialog.open).toBeTrue();
    cleanup();
  });

  test('a page Escape listener that canceled the keydown keeps it open', async () => {
    // What a popover inside the dialog does when it takes the press itself.
    const { dialog } = openDialog();
    const onEscape = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener('keydown', onEscape);
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_B);
    document.removeEventListener('keydown', onEscape);
    expect(dialog.open).toBeTrue();
    cleanup();
  });

  test('closedby="none" is honoured', async () => {
    const { dialog } = openDialog();
    dialog.setAttribute('closedby', 'none');
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_B);
    expect(dialog.open).toBeTrue();
    cleanup();
  });

  test('a role="dialog" element is left to its own Escape listener', async () => {
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const inside = document.createElement('button');
    panel.append(inside);
    document.body.append(panel);
    inside.focus();
    const escapes: string[] = [];
    const onEscape = (event: KeyboardEvent) => escapes.push(event.key);
    document.addEventListener('keydown', onEscape);
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_B);
    document.removeEventListener('keydown', onEscape);
    expect(escapes).toEqual(['Escape']);
    cleanup();
  });
});

describe('controls whose focus() does nothing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('gamepad-active');
    sessionStorage.clear();
  });

  /** A first button, a section holding a button, and a last button. */
  const mount = (section: HTMLElement) => {
    const first = document.createElement('button');
    const inside = document.createElement('button');
    section.append(inside);
    const last = document.createElement('button');
    document.body.append(first, section, last);
    first.focus();
    return { first, inside, last };
  };

  test('RB steps past a button under an inert ancestor', async () => {
    const section = document.createElement('div');
    section.setAttribute('inert', '');
    const { last } = mount(section);
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_RB);
    expect(document.activeElement).toBe(last);
    cleanup();
  });

  test('RB steps past a section the page made inert from script', async () => {
    const section = document.createElement('div');
    const { last } = mount(section);
    section.inert = true;
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_RB);
    expect(document.activeElement).toBe(last);
    cleanup();
  });

  test('RB steps past a button in a disabled fieldset', async () => {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    const { last } = mount(fieldset);
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_RB);
    expect(document.activeElement).toBe(last);
    cleanup();
  });

  test('a button in the first legend of a disabled fieldset is still reached', async () => {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    const legend = document.createElement('legend');
    const inLegend = document.createElement('button');
    legend.append(inLegend);
    fieldset.append(legend);
    mount(fieldset);
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_RB);
    expect(document.activeElement).toBe(inLegend);
    cleanup();
  });

  test('a link in a disabled fieldset is still reached', async () => {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    const link = document.createElement('a');
    link.href = '#help';
    fieldset.append(link);
    mount(fieldset);
    const cleanup = initGamepadNavigation({ restoreFocus: false });
    await pressOnPad(PAD_RB);
    expect(document.activeElement).toBe(link);
    cleanup();
  });
});

describe('keys inside a text field', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('gamepad-active');
    sessionStorage.clear();
  });

  /** A button, then the field, then a button, with focus in the field. */
  const mount = <T extends HTMLElement>(field: T) => {
    const before = document.createElement('button');
    const after = document.createElement('button');
    document.body.append(before, field, after);
    field.focus();
    const escapes: string[] = [];
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escapes.push(event.key);
    };
    document.addEventListener('keydown', onEscape);
    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    return {
      before,
      after,
      escapes,
      cleanup: () => {
        document.removeEventListener('keydown', onEscape);
        cleanup();
      },
    };
  };

  const textarea = (value: string, caret: number) => {
    const field = document.createElement('textarea');
    field.value = value;
    field.setSelectionRange(caret, caret);
    return field;
  };

  const numberInput = () => {
    const field = document.createElement('input');
    field.type = 'number';
    field.value = '5';
    return field;
  };

  const press = (target: HTMLElement, name: string, keyCode = 0) => {
    const event = new window.KeyboardEvent('keydown', {
      key: name,
      keyCode,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };

  for (const [label, make] of [
    ['textarea', () => textarea('abc', 2)],
    ['number input', numberInput],
  ] as const) {
    test(`Backspace in a ${label} is left to delete, not sent back`, () => {
      const field = make();
      const { escapes, cleanup } = mount(field);
      const event = press(field, 'Backspace', 8);
      expect(event.defaultPrevented).toBeFalse();
      expect(escapes).toEqual([]);
      expect(document.activeElement).toBe(field);
      cleanup();
    });

    test(`a remote back key in a ${label} still goes back`, () => {
      const field = make();
      const { escapes, cleanup } = mount(field);
      for (const [name, code] of [
        ['GoBack', 0],
        ['XF86Back', 10009],
      ] as const) {
        expect(press(field, name, code).defaultPrevented).toBeTrue();
      }
      expect(escapes).toEqual(['Escape', 'Escape']);
      cleanup();
    });

    test(`a real Escape in a ${label} is still claimed`, () => {
      const field = make();
      const { cleanup } = mount(field);
      expect(press(field, 'Escape', 27).defaultPrevented).toBeTrue();
      cleanup();
    });
  }

  test('Backspace in a textarea inside a dialog leaves the dialog open', () => {
    const dialog = document.createElement('dialog');
    const field = textarea('abc', 3);
    dialog.append(field);
    document.body.append(dialog);
    dialog.show();
    field.focus();
    const cleanup = initGamepadNavigation({
      restoreFocus: false,
      keyboardNavigation: true,
    });
    press(field, 'Backspace', 8);
    expect(dialog.open).toBeTrue();
    cleanup();
  });

  test('textarea arrows move the caret while it can move, then move focus', () => {
    const field = textarea('ab\ncd', 2);
    const { before, after, cleanup } = mount(field);
    for (const name of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(press(field, name).defaultPrevented).toBeFalse();
      expect(document.activeElement).toBe(field);
    }
    field.setSelectionRange(0, 0);
    expect(press(field, 'ArrowUp').defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(before);

    field.focus();
    field.setSelectionRange(5, 5);
    press(field, 'ArrowRight');
    expect(document.activeElement).toBe(after);
    cleanup();
  });

  test('a selection in a textarea keeps the arrow, which collapses it', () => {
    const field = textarea('abc', 0);
    const { cleanup } = mount(field);
    field.setSelectionRange(0, 3);
    expect(press(field, 'ArrowLeft').defaultPrevented).toBeFalse();
    expect(document.activeElement).toBe(field);
    cleanup();
  });

  test('a number input keeps Up and Down to step, and leaves on Left and Right', () => {
    const field = numberInput();
    const { after, cleanup } = mount(field);
    expect(press(field, 'ArrowUp').defaultPrevented).toBeFalse();
    expect(press(field, 'ArrowDown').defaultPrevented).toBeFalse();
    expect(document.activeElement).toBe(field);
    expect(press(field, 'ArrowRight').defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(after);
    cleanup();
  });

  test('Enter in a textarea is left to make a new line', () => {
    const field = textarea('abc', 3);
    const { cleanup } = mount(field);
    let clicks = 0;
    field.addEventListener('click', () => clicks++);
    expect(press(field, 'Enter', 13).defaultPrevented).toBeFalse();
    expect(clicks).toBe(0);
    cleanup();
  });

  test('a single-line text field leaves on Down, and on Left at its start', () => {
    const field = document.createElement('input');
    field.value = 'abc';
    const { before, after, cleanup } = mount(field);
    field.setSelectionRange(1, 1);
    expect(press(field, 'ArrowLeft').defaultPrevented).toBeFalse();
    expect(document.activeElement).toBe(field);
    press(field, 'ArrowDown');
    expect(document.activeElement).toBe(after);

    field.focus();
    field.setSelectionRange(0, 0);
    press(field, 'ArrowLeft');
    expect(document.activeElement).toBe(before);
    cleanup();
  });
});
