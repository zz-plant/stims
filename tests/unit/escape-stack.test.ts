import { afterEach, describe, expect, test } from 'bun:test';
import {
  escapeIsClaimed,
  registerEscapeHandler,
} from '../../src/js/core/modal-utils.ts';

/**
 * Escape must close the overlay in front of the user, and only that one.
 *
 * Before these handlers were stacked, each overlay listened wherever it liked.
 * The side panel listened on `document`; the help dialogs used a React
 * `onKeyDown` on their own backdrop, which React dispatches from the root
 * container — below `document`, and only for events that start inside that
 * backdrop. So opening the shortcuts dialog from inside Settings and pressing
 * Escape closed the sheet underneath and left the dialog open, and a second
 * press did nothing at all.
 */

const releases: Array<() => void> = [];

function register(calls: string[], name: string) {
  const release = registerEscapeHandler(() => calls.push(name));
  releases.push(release);
  return release;
}

/**
 * A bubbling keydown carrying `key: 'Escape'`. Built from a plain `Event`
 * with the property defined on it, because happy-dom does not expose
 * `KeyboardEvent` on the global scope the way a browser does.
 */
function pressEscape(target: EventTarget = document) {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'key', { value: 'Escape' });
  target.dispatchEvent(event);
}

afterEach(() => {
  while (releases.length > 0) releases.pop()?.();
  document.body.innerHTML = '';
});

describe('registerEscapeHandler', () => {
  test('dispatches to the innermost overlay only', () => {
    const calls: string[] = [];
    register(calls, 'sheet');
    register(calls, 'dialog');

    pressEscape();

    // The defect closed 'sheet' and left 'dialog' open — the wrong one, and
    // the one the user could not then get out of.
    expect(calls).toEqual(['dialog']);
  });

  test('the overlay underneath resumes once the top one closes', () => {
    const calls: string[] = [];
    register(calls, 'sheet');
    const releaseDialog = register(calls, 'dialog');

    releaseDialog();
    pressEscape();

    expect(calls).toEqual(['sheet']);
  });

  test('releasing out of order leaves the survivor handling Escape', () => {
    const calls: string[] = [];
    const releaseSheet = register(calls, 'sheet');
    register(calls, 'dialog');

    // The panel underneath can close first; the dialog above it stays open.
    releaseSheet();
    pressEscape();

    expect(calls).toEqual(['dialog']);
  });

  test('with nothing registered the key is left alone', () => {
    const seen: string[] = [];
    const onKey = () => seen.push('reached');
    document.addEventListener('keydown', onKey);
    try {
      pressEscape();
      // Not swallowed: no overlay is open, so Escape stays available to
      // whatever else listens for it.
      expect(seen).toEqual(['reached']);
    } finally {
      document.removeEventListener('keydown', onKey);
    }
  });

  test('a handler stopping propagation first still wins', () => {
    const calls: string[] = [];
    register(calls, 'sheet');

    const field = document.createElement('input');
    document.body.appendChild(field);
    // This is the Browse search field: Escape clears what you typed and must
    // not also close the panel around it. It works because the shared
    // listener is on the bubble phase, so a nearer handler can stop the event.
    field.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') event.stopPropagation();
    });

    pressEscape(field);

    expect(calls).toEqual([]);
  });

  test('reports whether an overlay has claimed Escape', () => {
    // The global shortcut handler asks this before acting. It attaches on
    // document when the shell mounts, before any overlay exists, so it runs
    // first and cannot be cancelled from here — a user who rebinds Escape to
    // an action would otherwise fire that action *and* dismiss the overlay.
    expect(escapeIsClaimed()).toBe(false);

    const calls: string[] = [];
    const release = register(calls, 'dialog');
    expect(escapeIsClaimed()).toBe(true);

    release();
    expect(escapeIsClaimed()).toBe(false);
  });

  test('the same handler registered twice unwinds one layer at a time', () => {
    const calls: string[] = [];
    const shared = () => calls.push('shared');
    const releaseA = registerEscapeHandler(shared);
    const releaseB = registerEscapeHandler(shared);
    releases.push(releaseA, releaseB);

    pressEscape();
    releaseB();
    pressEscape();
    releaseA();
    pressEscape();

    // Two presses land while it is registered, none after both are released.
    expect(calls).toEqual(['shared', 'shared']);
  });
});
