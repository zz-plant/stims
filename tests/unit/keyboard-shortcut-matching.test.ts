/**
 * Guards the shortcut matcher's modifier handling.
 *
 * Matching on `event.key` alone meant every single-letter binding also fired
 * on its Cmd/Ctrl equivalent, and because the handler calls preventDefault(),
 * the browser's own Save, Find, Print and Select-all stopped working while
 * Stims held focus. The same gap made 'Cmd+Enter' — the one binding that
 * declares a modifier — impossible to ever trigger.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isCanvasConsumedKey } from '../../src/js/core/unified-input.ts';
import {
  ariaKeyShortcutsFor,
  eventMatchesShortcut,
  eventMatchesShortcutSpec,
  parseShortcut,
  SHORTCUT_REGISTRY,
  shortcutHintFor,
} from '../../src/js/frontend/shortcut-registry.ts';

type Mods = {
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};
const press = (key: string, mods: Mods = {}) =>
  ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  }) as KeyboardEvent;

describe('modifier isolation', () => {
  // Each pair is a binding and the browser command its Cmd chord owns.
  const LETTER_BINDINGS = [
    ['s', 'settings'],
    ['f', 'fullscreen'],
    ['b', 'browse'],
    ['e', 'editor'],
    ['p', 'previous'],
    ['a', 'favorite'],
    ['n', 'shuffle'],
  ] as const;

  test.each(LETTER_BINDINGS)('plain %s triggers %s', (key, id) => {
    expect(eventMatchesShortcut(press(key), id)).toBe(true);
  });

  test.each(LETTER_BINDINGS)('Cmd+%s does not trigger %s', (key, id) => {
    expect(eventMatchesShortcut(press(key, { metaKey: true }), id)).toBe(false);
  });

  test.each(LETTER_BINDINGS)('Ctrl+%s does not trigger %s', (key, id) => {
    expect(eventMatchesShortcut(press(key, { ctrlKey: true }), id)).toBe(false);
  });

  test.each(LETTER_BINDINGS)('Alt+%s does not trigger %s', (key, id) => {
    expect(eventMatchesShortcut(press(key, { altKey: true }), id)).toBe(false);
  });
});

describe('bindings that declare a modifier', () => {
  test('Cmd+Enter compiles, bare Enter does not', () => {
    expect(
      eventMatchesShortcut(press('Enter', { metaKey: true }), 'compile'),
    ).toBe(true);
    expect(eventMatchesShortcut(press('Enter'), 'compile')).toBe(false);
  });

  test('Ctrl stands in for Cmd, so one binding covers both platforms', () => {
    expect(
      eventMatchesShortcut(press('Enter', { ctrlKey: true }), 'compile'),
    ).toBe(true);
  });

  test('the command palette is reachable and registered', () => {
    expect(eventMatchesShortcut(press('k', { metaKey: true }), 'palette')).toBe(
      true,
    );
    expect(eventMatchesShortcut(press('k'), 'palette')).toBe(false);
  });
});

describe('key spelling', () => {
  test('the space bar matches a "Space" binding', () => {
    expect(eventMatchesShortcut(press(' '), 'audio')).toBe(true);
  });

  test('arrow aliases still reach preset navigation', () => {
    expect(eventMatchesShortcut(press('ArrowRight'), 'shuffle')).toBe(true);
    expect(eventMatchesShortcut(press('ArrowLeft'), 'previous')).toBe(true);
  });

  test('Esc and Escape are one key', () => {
    expect(eventMatchesShortcutSpec(press('Escape'), 'Esc')).toBe(true);
  });
});

describe('shift', () => {
  test('? reaches help even though it arrives shifted', () => {
    expect(eventMatchesShortcut(press('?', { shiftKey: true }), 'help')).toBe(
      true,
    );
  });

  test('Shift+letter is a distinct binding from the bare letter', () => {
    expect(
      eventMatchesShortcutSpec(press('S', { shiftKey: true }), 'Shift+S'),
    ).toBe(true);
    // The bare binding must not also fire, or one press runs two actions.
    expect(
      eventMatchesShortcut(press('S', { shiftKey: true }), 'settings'),
    ).toBe(false);
  });
});

describe('registry integrity', () => {
  test('no two actions claim the same chord', () => {
    const seen = new Map<string, string>();
    for (const entry of SHORTCUT_REGISTRY) {
      for (const spec of entry.defaultKeys) {
        if (spec === '1–9') continue; // display-only pseudo-key
        const parsed = parseShortcut(spec);
        const chord = `${parsed.mod ? 'mod+' : ''}${parsed.alt ? 'alt+' : ''}${parsed.shift ? 'shift+' : ''}${parsed.key}`;
        expect(
          seen.has(chord) ? `${chord} also used by ${seen.get(chord)}` : chord,
        ).toBe(chord);
        seen.set(chord, entry.id);
      }
    }
  });

  test('every registry action is uniquely identified', () => {
    const ids = SHORTCUT_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('palette-dispatched bindings', () => {
  const APP_SOURCE = readFileSync(
    new URL('../../src/js/frontend/App.tsx', import.meta.url),
    'utf8',
  );
  const dispatched = SHORTCUT_REGISTRY.filter((e) => e.dispatchViaPalette);

  test('there is at least one, so the wiring is exercised', () => {
    expect(dispatched.length).toBeGreaterThan(0);
  });

  test.each(
    dispatched.map((e) => [e.id, e.paletteActionId as string] as const),
  )('%s targets a palette action that exists (%s)', (_id, paletteActionId) => {
    expect(APP_SOURCE).toContain(`id: '${paletteActionId}',`);
  });

  // Bindings gated in the hook must not also be reachable through the generic
  // palette dispatch, which would bypass the gate.
  test.each([['shuffle'], ['previous']] as const)(
    '%s corresponds to a palette action but is not dispatched through it',
    (id) => {
      const entry = SHORTCUT_REGISTRY.find((e) => e.id === id);
      expect(entry?.paletteActionId).toBeTruthy();
      expect(entry?.dispatchViaPalette).toBeFalsy();
    },
  );
});

describe('hints are derived, not copied', () => {
  const APP_SOURCE = readFileSync(
    new URL('../../src/js/frontend/App.tsx', import.meta.url),
    'utf8',
  );

  test('no surface hardcodes a shortcut hint', () => {
    // Every literal here was a copy of a registry default that went stale the
    // moment the user rebound the key.
    expect(APP_SOURCE).not.toMatch(/shortcutHint: '/);
  });

  test('a bound action resolves to its key', () => {
    expect(shortcutHintFor('open-browse', {})).toBe('B');
    expect(shortcutHintFor('open-settings', {})).toBe('S');
    expect(shortcutHintFor('queue-add', {})).toBe('U');
  });

  test('an unbound action resolves to nothing', () => {
    expect(shortcutHintFor('share-link', {})).toBeUndefined();
  });

  test('a rebind changes the hint every surface shows', () => {
    expect(shortcutHintFor('open-browse', { browse: ['Y'] })).toBe('Y');
  });

  test('aria-keyshortcuts publishes both platform modifiers', () => {
    expect(ariaKeyShortcutsFor('open-palette', {})).toBe('Meta+K Control+K');
    expect(ariaKeyShortcutsFor('open-browse', {})).toBe('B');
    expect(ariaKeyShortcutsFor('previous-preset', {})).toBe('P ArrowLeft');
  });
});

describe('bindings land on keys that actually reach the shell', () => {
  // Three layers consume keys before useKeyboardShortcuts runs, and only the
  // registry is visible from shortcut-registry.ts. A binding on a consumed
  // key is not a conflict that surfaces anywhere — it is a dead key.
  const OVERLAY_CLAIMED = new Set([
    'r',
    'backspace',
    'h',
    'w',
    'l',
    'i',
    'j',
    'o',
    'q',
  ]);
  const dispatched = SHORTCUT_REGISTRY.filter((e) => e.dispatchViaPalette);

  test.each(dispatched.map((e) => [e.id, e.defaultKeys[0]] as const))(
    '%s (%s) is not swallowed by the MilkDrop overlay',
    (_id, spec) => {
      expect(OVERLAY_CLAIMED.has(parseShortcut(spec).key)).toBe(false);
    },
  );

  test.each(dispatched.map((e) => [e.id, e.defaultKeys[0]] as const))(
    '%s (%s) is not swallowed by the focused canvas',
    (_id, spec) => {
      expect(isCanvasConsumedKey(parseShortcut(spec).key)).toBe(false);
    },
  );

  // Verified in the browser, not inferred: once the engine is live the canvas
  // carries tabindex="0" and unified-input focuses it on pointerdown, so a
  // single click on the stage — the most natural thing to do — silently kills
  // these six. S stops opening Settings and ArrowRight stops changing preset,
  // while a non-consumed binding like T keeps working.
  //
  // Not fixed here because the collision is between two real features:
  // interaction-response.ts feeds these same keys to presets as
  // action_mode_next / action_remix / accent pulses. Deciding which side wins
  // is a product call, so this pins the blast radius instead of hiding it.
  test('the known pre-existing canvas overlaps have not grown', () => {
    const overlapping = SHORTCUT_REGISTRY.filter((entry) =>
      entry.defaultKeys.some((spec) => {
        const parsed = parseShortcut(spec);
        return !parsed.mod && isCanvasConsumedKey(parsed.key);
      }),
    ).map((entry) => String(entry.id));

    expect(overlapping.sort()).toEqual(
      ['audio', 'editor', 'favorite', 'previous', 'settings', 'shuffle'].sort(),
    );
  });
});
