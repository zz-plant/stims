import { afterEach, describe, expect, test } from 'bun:test';
import { trapFocusWithin } from '../../src/js/core/modal-utils.ts';

/**
 * A focus trap installs a document-level `focusin` listener that pulls focus
 * back into its own panel whenever focus lands outside it. Two of those can be
 * live at once in the real app — the shortcuts dialog and the command palette
 * both open *over* a Settings panel that stays mounted — and before traps were
 * stacked, both answered the same event: each pulled focus into itself, which
 * in a browser dispatches another `focusin`, which the other answered, with no
 * state either could settle in. The tab locks up.
 *
 * The property under test is therefore "exactly one trap responds, and it is
 * the innermost one". That is asserted directly rather than through the DOM,
 * because happy-dom ignores a `focus()` call made during focus dispatch: the
 * recursion that makes this fatal in a browser cannot be staged here, and a
 * test that watched `document.activeElement` would pass against the old code
 * for reasons that have nothing to do with the fix.
 */

/**
 * Elements this test created, so `recordFocusCalls` can spy on them.
 *
 * Spied per element rather than on `HTMLElement.prototype`: the `HTMLElement`
 * visible to this module is not the constructor happy-dom's document builds
 * its nodes from, so a prototype patch records nothing at all.
 */
let tracked: HTMLElement[] = [];

function track<T extends HTMLElement>(element: T): T {
  tracked.push(element);
  return element;
}

/**
 * Records who each trap tries to pull focus to, without actually moving focus.
 * Suppressing the real move is what keeps the recording honest: it isolates
 * "which traps responded to this one event" from any follow-on events a real
 * focus change would produce.
 */
function recordFocusCalls(act: () => void): string[] {
  const calls: string[] = [];
  for (const element of tracked) {
    element.focus = () => {
      calls.push(element.id || element.tagName.toLowerCase());
    };
  }
  try {
    act();
  } finally {
    for (const element of tracked) {
      // Drop the own property so the prototype's real focus is back.
      delete (element as Partial<HTMLElement>).focus;
    }
  }
  return calls;
}

function buildPanel(id: string) {
  const panel = track(document.createElement('div'));
  panel.id = id;
  panel.tabIndex = -1;
  for (const label of ['first', 'second']) {
    const button = track(document.createElement('button'));
    button.id = `${id}-${label}`;
    button.textContent = label;
    panel.appendChild(button);
  }
  document.body.appendChild(panel);
  return panel;
}

/** A control outside every trap, standing in for "focus escaped". */
function buildStray() {
  const stray = track(document.createElement('button'));
  stray.id = 'stray';
  document.body.appendChild(stray);
  return stray;
}

/**
 * A plain bubbling `Event`, not a `FocusEvent`: the handler under test reads
 * only `event.target`, and happy-dom does not put `FocusEvent` on the global
 * scope the way a browser does.
 */
function announceFocusIn(target: HTMLElement) {
  target.dispatchEvent(new Event('focusin', { bubbles: true }));
}

afterEach(() => {
  tracked = [];
  document.body.innerHTML = '';
});

describe('trapFocusWithin stacking', () => {
  test('only the innermost trap answers focus escaping', () => {
    const outer = buildPanel('outer');
    const inner = buildPanel('inner');
    const stray = buildStray();

    const releaseOuter = trapFocusWithin(outer);
    const releaseInner = trapFocusWithin(inner);

    try {
      const calls = recordFocusCalls(() => announceFocusIn(stray));

      // Before stacking this was ['outer-first', 'inner-first'] — the two
      // traps pulling in opposite directions, which is the lockup.
      expect(calls).toEqual(['inner-first']);
    } finally {
      releaseInner();
      releaseOuter();
    }
  });

  test('a trap ignores focus that is already inside it', () => {
    const inner = buildPanel('inner');
    const release = trapFocusWithin(inner);

    try {
      const calls = recordFocusCalls(() => {
        const target = document.getElementById('inner-second');
        if (target) announceFocusIn(target);
      });

      expect(calls).toEqual([]);
    } finally {
      release();
    }
  });

  test('the outer trap resumes once the inner one is released', () => {
    const outer = buildPanel('outer');
    const inner = buildPanel('inner');
    const stray = buildStray();

    const releaseOuter = trapFocusWithin(outer);
    const releaseInner = trapFocusWithin(inner);

    try {
      releaseInner();

      expect(recordFocusCalls(() => announceFocusIn(stray))).toEqual([
        'outer-first',
      ]);
    } finally {
      releaseOuter();
    }
  });

  test('traps released out of order leave the survivor enforcing', () => {
    const outer = buildPanel('outer');
    const inner = buildPanel('inner');
    const stray = buildStray();

    const releaseOuter = trapFocusWithin(outer);
    const releaseInner = trapFocusWithin(inner);

    try {
      // Closing the panel *underneath* first is legal: the dialog above it is
      // still open and must keep enforcing.
      releaseOuter();

      expect(recordFocusCalls(() => announceFocusIn(stray))).toEqual([
        'inner-first',
      ]);
    } finally {
      releaseInner();
    }
  });

  test('a lone trap still enforces', () => {
    const panel = buildPanel('solo');
    const stray = buildStray();

    const release = trapFocusWithin(panel);
    try {
      expect(recordFocusCalls(() => announceFocusIn(stray))).toEqual([
        'solo-first',
      ]);
    } finally {
      release();
    }
  });

  test('releasing every trap stops all enforcement', () => {
    const panel = buildPanel('solo');
    const stray = buildStray();

    trapFocusWithin(panel)();

    expect(recordFocusCalls(() => announceFocusIn(stray))).toEqual([]);
  });

  test('a trap with nothing focusable falls back to the panel itself', () => {
    const empty = track(document.createElement('div'));
    empty.id = 'empty';
    empty.tabIndex = -1;
    document.body.appendChild(empty);
    const stray = buildStray();

    const release = trapFocusWithin(empty);
    try {
      expect(recordFocusCalls(() => announceFocusIn(stray))).toEqual(['empty']);
    } finally {
      release();
    }
  });
});
