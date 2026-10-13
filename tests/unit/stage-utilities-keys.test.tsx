import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  releaseStageUtilities,
  resetStageUtilitiesForTests,
  stageUtilityMode,
} from '../../src/js/core/services/stage-utilities.ts';
import { useKeyboardShortcuts } from '../../src/js/frontend/hooks/useKeyboardShortcuts.ts';

/**
 * The stage utilities' keyboard dispatch, against the real listener: keydown
 * starts the hold, keyup ends it, window blur ends it without a keyup, and
 * the chords that belong to other shortcuts (Shift+D is live-performance
 * mode) never trigger the cut.
 *
 * There was no harness for this hook before, so this file mounts a minimal
 * component that calls it with the same props App passes.
 */

function Harness({ liveMode }: { liveMode: boolean }) {
  useKeyboardShortcuts({
    liveMode,
    engineReady: true,
    panel: null,
    updatePanel: () => {},
    handlePresetSelection: () => {},
    handleShufflePreset: () => {},
    handlePreviousPreset: () => {},
    handleTogglePlayback: () => {},
    handleVisualSearch: async () => {},
    handleToggleFullscreen: () => {},
    setShowShortcuts: () => {},
  });
  return null;
}

let host: HTMLElement | null = null;

// Same declaration the frontend harness makes: this file drives React
// updates through act().
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStageUtilitiesForTests();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  releaseStageUtilities();
  resetStageUtilitiesForTests();
  if (host) {
    host.remove();
    host = null;
  }
});

function mount(liveMode = true) {
  const root = createRoot(host!);
  // Effects (the document key listeners) attach inside act, like the
  // SidePanel harness does; a bare render leaves them deferred.
  act(() => {
    root.render(createElement(Harness, { liveMode }));
  });
  return () => act(() => root.unmount());
}

function press(key: string, modifiers: Record<string, boolean> = {}) {
  const KeyboardEventCtor = window.KeyboardEvent ?? globalThis.KeyboardEvent;
  document.dispatchEvent(
    new KeyboardEventCtor('keydown', {
      key,
      bubbles: true,
      ...modifiers,
    }),
  );
}

function lift(key: string) {
  const KeyboardEventCtor = window.KeyboardEvent ?? globalThis.KeyboardEvent;
  document.dispatchEvent(
    new KeyboardEventCtor('keyup', { key, bubbles: true }),
  );
}

describe('stage utility key dispatch', () => {
  test('D holds the blackout until the keyup', () => {
    const unmount = mount();
    try {
      press('d');
      expect(stageUtilityMode()).toBe('blackout');
      lift('d');
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      unmount();
    }
  });

  test('a double-tap latches until the next press', () => {
    const unmount = mount();
    try {
      press('d');
      lift('d');
      press('d');
      lift('d');
      expect(stageUtilityMode()).toBe('blackout');
      press('d');
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      unmount();
    }
  });

  test('Y flashes for exactly the length of the key', () => {
    const unmount = mount();
    try {
      press('y');
      expect(stageUtilityMode()).toBe('flash');
      lift('y');
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      unmount();
    }
  });

  test('the utilities are live-stage keys: no session, no cut', () => {
    const unmount = mount(false);
    try {
      press('d');
      press('y');
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      unmount();
    }
  });

  test('losing the window releases the stage without a keyup', () => {
    const unmount = mount();
    try {
      press('d');
      expect(stageUtilityMode()).toBe('blackout');
      window.dispatchEvent(new Event('blur'));
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      unmount();
    }
  });

  test('the keyup releases even when focus sits in a text field', () => {
    // The keydown path ignores keys typed into inputs; the release must not
    // inherit that guard, or a hold that started before a click into a field
    // would latch the stage dark.
    const unmount = mount();
    const field = document.createElement('input');
    host!.appendChild(field);
    try {
      press('d');
      expect(stageUtilityMode()).toBe('blackout');
      const KeyboardEventCtor =
        window.KeyboardEvent ?? globalThis.KeyboardEvent;
      field.dispatchEvent(
        new KeyboardEventCtor('keyup', { key: 'd', bubbles: true }),
      );
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      field.remove();
      unmount();
    }
  });

  test('typing the key into a field never starts a cut', () => {
    const unmount = mount();
    const field = document.createElement('input');
    host!.appendChild(field);
    try {
      const KeyboardEventCtor =
        window.KeyboardEvent ?? globalThis.KeyboardEvent;
      field.dispatchEvent(
        new KeyboardEventCtor('keydown', { key: 'd', bubbles: true }),
      );
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      field.remove();
      unmount();
    }
  });

  test('the chords owned by other shortcuts do not cut the stage', () => {
    const unmount = mount();
    try {
      // Shift+D is live-performance mode; Cmd/Ctrl+D is the browser's.
      press('d', { shiftKey: true });
      press('d', { ctrlKey: true });
      press('d', { metaKey: true });
      press('D', { shiftKey: true });
      expect(stageUtilityMode()).toBe('normal');
    } finally {
      unmount();
    }
  });
});
