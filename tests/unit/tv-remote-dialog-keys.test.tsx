import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { initGamepadNavigation } from 'gamepad-navigation';
import { act, createElement, createRef, Fragment, type ReactNode } from 'react';
import { CreditsDialog } from '../../src/js/frontend/CreditsDialog.tsx';
import { useKeyboardShortcuts } from '../../src/js/frontend/hooks/useKeyboardShortcuts.ts';
import { ShortcutsDialog } from '../../src/js/frontend/ShortcutsDialog.tsx';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';
import { replaceProperty } from '../test-helpers.ts';

/**
 * On a smart TV the remote's D-pad and Back key arrive as arrow keys and
 * Backspace, and the gamepad-navigation layer on `window` turns them into
 * focus moves and a synthetic Escape. A modal dialog's card used to stop
 * every key but Escape from leaving it, so Back left the dialog open and the
 * D-pad could not move focus in it. The same keys are bound to preset
 * shortcuts (ArrowLeft and Backspace are Previous, ArrowRight is Next), which
 * must not fire behind the dialog.
 */

const counts = { previous: 0, shuffle: 0, panel: 0, closed: 0 };

function ShellShortcuts() {
  useKeyboardShortcuts({
    liveMode: true,
    engineReady: true,
    panel: null,
    updatePanel: () => {
      counts.panel += 1;
    },
    handlePresetSelection: () => {},
    handleShufflePreset: () => {
      counts.shuffle += 1;
    },
    handlePreviousPreset: () => {
      counts.previous += 1;
    },
    handleTogglePlayback: () => {},
    handleVisualSearch: async () => {},
    handleToggleFullscreen: () => {},
    setShowShortcuts: () => {},
  });
  return null;
}

const onClose = () => {
  counts.closed += 1;
};

const dialogs: Array<{ name: string; render: () => ReactNode }> = [
  {
    name: 'Shortcuts',
    render: () =>
      createElement(ShortcutsDialog, {
        open: true,
        onClose,
        shortcutsRef: createRef<HTMLDivElement>(),
      }),
  },
  {
    name: 'Credits',
    render: () =>
      createElement(CreditsDialog, {
        open: true,
        onClose,
        creditsRef: createRef<HTMLDivElement>(),
      }),
  },
];

function press(target: Element | null, key: string): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target?.dispatchEvent(event);
  });
  return event;
}

let rendered: RenderedWorkspace | null = null;
let stopNavigation: (() => void) | null = null;
let restoreKeyboardEvent: (() => void) | null = null;

function mount(dialog: ReactNode) {
  rendered = renderWorkspace(
    createElement(Fragment, null, createElement(ShellShortcuts), dialog),
  );
  stopNavigation = initGamepadNavigation({ keyboardNavigation: true });
  return rendered.container;
}

beforeEach(() => {
  // The layer builds its synthetic Escape from the global constructor, which
  // this test DOM only puts on `window`. Without it the Escape never goes out.
  restoreKeyboardEvent = replaceProperty(
    globalThis,
    'KeyboardEvent',
    window.KeyboardEvent,
  );
  counts.previous = 0;
  counts.shuffle = 0;
  counts.panel = 0;
  counts.closed = 0;
});

afterEach(() => {
  stopNavigation?.();
  stopNavigation = null;
  rendered?.dispose();
  rendered = null;
  restoreKeyboardEvent?.();
  restoreKeyboardEvent = null;
  document.body.classList.remove('gamepad-active');
  sessionStorage.clear();
});

describe('TV remote keys inside a modal dialog', () => {
  for (const { name, render } of dialogs) {
    test(`${name}: Back closes the dialog without going to the previous preset`, () => {
      const container = mount(render());
      const close = container.querySelector<HTMLButtonElement>(
        '[role="dialog"] button',
      );
      close?.focus();

      press(close, 'Backspace');

      expect(counts.closed).toBe(1);
      expect(counts.previous).toBe(0);
    });

    test(`${name}: the D-pad moves focus without changing preset`, () => {
      const container = mount(render());
      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      );
      expect(buttons.length).toBeGreaterThan(1);
      buttons[0]?.focus();

      const down = press(buttons[0] ?? null, 'ArrowDown');
      const right = press(document.activeElement, 'ArrowRight');
      const left = press(document.activeElement, 'ArrowLeft');

      // The layer cancels every arrow it moves focus with.
      expect(down.defaultPrevented).toBe(true);
      expect(right.defaultPrevented).toBe(true);
      expect(left.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(buttons[0]);
      expect(counts.shuffle).toBe(0);
      expect(counts.previous).toBe(0);
      expect(counts.closed).toBe(0);
    });

    test(`${name}: other keys stay in the dialog`, () => {
      const container = mount(render());
      const close = container.querySelector<HTMLButtonElement>(
        '[role="dialog"] button',
      );
      close?.focus();

      // B opens Browse everywhere else.
      press(close, 'b');

      expect(counts.panel).toBe(0);
      expect(counts.closed).toBe(0);
    });
  }

  test('Shortcuts: keys typed into a binding field edit it and fire no shell shortcut', () => {
    const container = mount(dialogs[0]?.render());
    const edit = container.querySelector<HTMLButtonElement>(
      '[data-shortcut-edit]',
    );
    rendered?.click(edit);
    const input =
      container.querySelector<HTMLInputElement>('input[name="keys"]');
    expect(document.activeElement).toBe(input);

    // Mid-text, the field keeps Backspace, the arrows and letters.
    input?.setSelectionRange(2, 2);
    for (const key of ['Backspace', 'ArrowLeft', 'ArrowRight', 'b']) {
      const event = press(input, key);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(input);

    // At the start of the text, ArrowLeft leaves the field for the layer.
    input?.setSelectionRange(0, 0);
    const leave = press(input, 'ArrowLeft');
    expect(leave.defaultPrevented).toBe(true);

    expect(counts.closed).toBe(0);
    expect(counts.previous).toBe(0);
    expect(counts.shuffle).toBe(0);
    expect(counts.panel).toBe(0);
  });
});
