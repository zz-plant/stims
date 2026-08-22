export type ShortcutActionId =
  | 'palette'
  | 'audio'
  | 'fullscreen'
  | 'browse'
  | 'settings'
  | 'editor'
  | 'refine'
  | 'visualsearch'
  | 'shuffle'
  | 'previous'
  | 'favorite'
  | 'quick-select'
  | 'help'
  | 'close'
  | 'compile'
  | 'queue-add'
  | 'autoplay'
  | 'live-performance'
  | 'record'
  | 'generate'
  | 'theme';

export type ShortcutDefinition = {
  id: ShortcutActionId;
  label: string;
  defaultKeys: string[];
  configurable?: boolean;
  /**
   * The command-palette action this binding corresponds to.
   *
   * Set on every binding that has a palette equivalent, whether or not the
   * palette is what runs it — it is the join that lets any surface showing
   * that action look up its key (see shortcutHintFor).
   */
  paletteActionId?: string;
  /**
   * Dispatch by running `paletteActionId` instead of a bespoke handler in
   * useKeyboardShortcuts.
   *
   * Kept separate from paletteActionId because several bindings correspond to
   * a palette action but must NOT be dispatched through it: 'shuffle' and
   * 'previous' are gated on liveMode in the hook, and routing them here would
   * quietly bypass that gate and call the engine before it is mounted.
   */
  dispatchViaPalette?: boolean;
};

export const SHORTCUT_STORAGE_KEY = 'stims:keyboard-shortcuts:v1';

export const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  {
    // The most-reached-for shortcut in the app was the one the help dialog
    // never mentioned: it lived as a hardcoded Cmd+K handler inside
    // CommandPalette.tsx, outside this registry, so it appeared in no list
    // and could not be rebound. The palette is also the only route to the
    // ~20 actions that have no key of their own, which made it the worst
    // possible thing to leave undiscoverable.
    id: 'palette',
    label: 'Command palette (everything else)',
    defaultKeys: ['Cmd+K'],
    paletteActionId: 'open-palette',
  },
  {
    id: 'audio',
    label: 'Playback choices / stop audio',
    defaultKeys: ['Space'],
    // Space stops audio while live and opens playback choices otherwise; the
    // stop action is the one the palette lists, so that is what it annotates.
    paletteActionId: 'stop-audio',
  },
  {
    id: 'fullscreen',
    label: 'Fullscreen',
    defaultKeys: ['F'],
    paletteActionId: 'toggle-fullscreen',
  },
  {
    id: 'browse',
    label: 'Browse presets',
    defaultKeys: ['B'],
    paletteActionId: 'open-browse',
  },
  {
    id: 'settings',
    label: 'Settings',
    defaultKeys: ['S'],
    paletteActionId: 'open-settings',
  },
  {
    id: 'editor',
    label: 'Edit preset code',
    defaultKeys: ['E'],
    paletteActionId: 'open-editor',
  },
  {
    id: 'refine',
    label: 'Refine with AI',
    defaultKeys: ['G'],
    paletteActionId: 'open-refine',
  },
  {
    id: 'visualsearch',
    label: 'Find a preset',
    defaultKeys: ['M'],
    paletteActionId: 'find-similar',
  },
  {
    id: 'shuffle',
    label: 'Next preset (random)',
    defaultKeys: ['N', 'ArrowRight'],
    paletteActionId: 'next-preset',
  },
  {
    id: 'previous',
    label: 'Previous preset',
    defaultKeys: ['P', 'ArrowLeft'],
    paletteActionId: 'previous-preset',
  },
  {
    id: 'favorite',
    label: 'Save current preset',
    // Not L: the standalone MilkDrop overlay's own keybinding layer
    // (src/js/milkdrop/runtime/ui-bridge.ts) already owns L for preset-lock,
    // among a wide set of single-letter nudges (I/O/J/Q, H, W, R) it deals
    // with independently of this registry. Confirmed unused there and here.
    defaultKeys: ['A'],
    paletteActionId: 'save-preset',
  },
  {
    id: 'quick-select',
    label: 'Quick-select preset',
    defaultKeys: ['1–9'],
    configurable: false,
  },
  {
    id: 'help',
    label: 'This help',
    defaultKeys: ['?'],
    paletteActionId: 'open-shortcuts',
  },
  {
    id: 'close',
    label: 'Close panels / dismiss',
    defaultKeys: ['Esc'],
    configurable: false,
  },
  {
    id: 'compile',
    label: 'Compile in editor',
    defaultKeys: ['Cmd+Enter'],
    configurable: false,
  },
  // Bound by dispatching the palette action of the same name.
  //
  // A letter has to clear three claimants, and only the first is visible from
  // this file:
  //   1. this registry;
  //   2. the MilkDrop overlay's document handler (runtime/ui-bridge.ts) —
  //      H, L, R, W plus the I/J/O/Q nudge map, which preventDefault()s and
  //      returns, so useKeyboardShortcuts never sees the key at all;
  //   3. the focused-canvas surface (core/unified-input.ts), which
  //      stopPropagation()s its pointer (WASD), gesture and performance
  //      (E/X/Q/Z/R/space/1-3/brackets) keys.
  // That leaves C, T, U, V and Y. Q reads better for 'queue' and D for
  // 'dark', and both were tried first — they are silently dead keys.
  {
    id: 'queue-add',
    label: 'Add this preset to the queue',
    // Not Q: the overlay's nudge map owns q (and the canvas takes it too).
    defaultKeys: ['U'],
    paletteActionId: 'queue-add',
    dispatchViaPalette: true,
  },
  {
    // Shift+L: L alone is close enough to the preset-navigation keys that a
    // mis-hit during a set would be costly, and this is a mode you set once.
    id: 'live-performance',
    label: 'Toggle live performance mode',
    defaultKeys: ['Shift+L'],
    paletteActionId: 'toggle-live-performance',
    dispatchViaPalette: true,
  },
  {
    id: 'autoplay',
    label: 'Toggle autoplay',
    defaultKeys: ['T'],
    paletteActionId: 'toggle-autoplay',
    dispatchViaPalette: true,
  },
  {
    // C, not R: the overlay layer owns R.
    id: 'record',
    label: 'Record video',
    defaultKeys: ['C'],
    paletteActionId: 'open-record',
    dispatchViaPalette: true,
  },
  {
    // Shift+G pairs with G (refine): both are the AI panels, and the shifted
    // variant reads as the heavier of the two.
    id: 'generate',
    label: 'Generate with AI',
    defaultKeys: ['Shift+G'],
    paletteActionId: 'open-generate',
    dispatchViaPalette: true,
  },
  {
    id: 'theme',
    label: 'Cycle theme (dark / light / system)',
    // Not D: the canvas uses W/A/S/D for the virtual pointer.
    defaultKeys: ['V'],
    paletteActionId: 'cycle-theme',
    dispatchViaPalette: true,
  },
];

export type ShortcutOverrides = Partial<Record<ShortcutActionId, string[]>>;

function normalizeKey(key: string) {
  return key.trim();
}

export function getShortcutKeys(
  id: ShortcutActionId,
  overrides: ShortcutOverrides = {},
) {
  const def = SHORTCUT_REGISTRY.find((entry) => entry.id === id);
  return overrides[id]?.filter(Boolean) ?? def?.defaultKeys ?? [];
}

// Reads happen on every document keydown (useKeyboardShortcuts), so the
// parsed overrides are cached; writes go through writeShortcutOverrides
// below, and cross-tab edits invalidate via the storage event.
let overridesCache: ShortcutOverrides | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === SHORTCUT_STORAGE_KEY || event.key === null) {
      overridesCache = null;
    }
  });
}

export function readShortcutOverrides(): ShortcutOverrides {
  if (overridesCache) return overridesCache;
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}',
    ) as ShortcutOverrides;
    overridesCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    overridesCache = {};
  }
  return overridesCache;
}

/** Returns false (instead of throwing) when the write could not persist. */
export function writeShortcutOverrides(overrides: ShortcutOverrides): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(overrides));
    overridesCache = overrides;
    return true;
  } catch (error) {
    // A quota/private-browsing failure here runs inside a keydown handler;
    // letting it throw would take down the whole app via the error boundary
    // for what is only a rebind that fails to persist.
    console.warn('[shortcuts] Could not save shortcut overrides:', error);
    return false;
  }
}

type ParsedShortcut = {
  /** Cmd on Apple, Ctrl elsewhere — matched against either. */
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
};

/** Aliases so 'Esc', 'Escape', 'Space', 'Return' all land on one spelling. */
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  ' ': 'space',
  spacebar: 'space',
  del: 'delete',
};

function canonicalKey(key: string): string {
  // The space bar arrives as ' ', which trims away to nothing — resolve it
  // before normalizeKey() can erase it.
  if (key === ' ') return 'space';
  const lower = normalizeKey(key).toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Parses 'Cmd+Enter' / 'Shift+/' / 'B' into modifiers plus a key.
 *
 * 'Cmd', 'Ctrl', 'Control', 'Command' and 'Mod' all collapse to one flag:
 * a binding written for one desktop platform should work on the other, and
 * nothing here wants to distinguish Cmd from Ctrl.
 */
export function parseShortcut(spec: string): ParsedShortcut {
  const parts = normalizeKey(spec).split('+');
  const key = canonicalKey(parts.pop() ?? '');
  const parsed: ParsedShortcut = { mod: false, alt: false, shift: false, key };
  for (const part of parts) {
    switch (part.trim().toLowerCase()) {
      case 'cmd':
      case 'command':
      case 'ctrl':
      case 'control':
      case 'meta':
      case 'mod':
        parsed.mod = true;
        break;
      case 'alt':
      case 'option':
        parsed.alt = true;
        break;
      case 'shift':
        parsed.shift = true;
        break;
      default:
        break;
    }
  }
  return parsed;
}

/**
 * True when `event` is exactly the chord `spec` describes.
 *
 * The modifier comparison is the point. Matching on `event.key` alone meant
 * every single-letter binding also fired on its Cmd/Ctrl equivalent, and
 * because the handler calls preventDefault(), that took the browser's own
 * Save, Find, Print and Select-all down with it. A binding that declares no
 * modifier now requires that none of Cmd/Ctrl/Alt are held.
 *
 * Shift is compared only for keys where it is a real distinction. Letters,
 * digits and named keys must match exactly, so 'Shift+X' and 'X' stay
 * separate bindings rather than both firing on one press. Punctuation is
 * exempt: '?' already arrives as '?' with Shift held on a US layout, so
 * demanding shift === false there would make the help key unreachable.
 */
export function eventMatchesShortcutSpec(
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
  >,
  spec: string,
): boolean {
  const parsed = parseShortcut(spec);
  if (!parsed.key) return false;
  if (canonicalKey(event.key) !== parsed.key) return false;

  const mod = event.metaKey || event.ctrlKey;
  if (parsed.mod !== mod) return false;
  if (parsed.alt !== event.altKey) return false;
  // Punctuation reaches us already shifted; letters/digits/named keys do not.
  const shiftIsSignificant = !(
    parsed.key.length === 1 && !/[a-z0-9]/.test(parsed.key)
  );
  if (shiftIsSignificant && parsed.shift !== event.shiftKey) return false;
  if (!shiftIsSignificant && parsed.shift && !event.shiftKey) return false;
  return true;
}

export function eventMatchesShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
  >,
  id: ShortcutActionId,
  overrides: ShortcutOverrides = {},
) {
  return getShortcutKeys(id, overrides).some((candidate) =>
    eventMatchesShortcutSpec(event, candidate),
  );
}

const APPLE_PLATFORM =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');

/**
 * Renders a binding for display: 'Cmd+K' on Apple, 'Ctrl+K' everywhere else.
 *
 * Specs are authored with 'Cmd' because that is what the matcher treats as
 * interchangeable with Ctrl, but showing a Windows user "Cmd" names a key
 * their keyboard does not have.
 */
export function formatShortcutForDisplay(spec: string): string {
  if (APPLE_PLATFORM) return spec;
  return spec.replace(/\b(cmd|command|meta|mod)\b/gi, 'Ctrl');
}

function definitionForPaletteAction(paletteActionId: string) {
  return SHORTCUT_REGISTRY.find(
    (entry) => entry.paletteActionId === paletteActionId,
  );
}

/**
 * The key to show next to a command-palette action, wherever that action is
 * listed — the palette, the stage dock's menu, a button tooltip.
 *
 * Reads through overrides rather than returning the default. Every hint used
 * to be a hardcoded literal at its call site, which meant that rebinding a
 * shortcut in the shortcuts dialog left every other surface advertising the
 * old key. Returns undefined when the action has no binding.
 */
export function shortcutHintFor(
  paletteActionId: string,
  overrides: ShortcutOverrides = readShortcutOverrides(),
): string | undefined {
  const def = definitionForPaletteAction(paletteActionId);
  if (!def) return undefined;
  const [first] = getShortcutKeys(def.id, overrides);
  return first ? formatShortcutForDisplay(first) : undefined;
}

/**
 * The same binding as an `aria-keyshortcuts` value.
 *
 * A tooltip reading "Previous (P)" is invisible to a screen reader; this is
 * the attribute that announces the key on the control itself. Modifier names
 * follow the attribute's own vocabulary (Alt/Control/Meta/Shift), and a
 * Cmd-or-Ctrl binding is published as both so neither platform's user is told
 * about a key they do not have.
 */
export function ariaKeyShortcutsFor(
  paletteActionId: string,
  overrides: ShortcutOverrides = readShortcutOverrides(),
): string | undefined {
  const def = definitionForPaletteAction(paletteActionId);
  if (!def) return undefined;
  const specs = getShortcutKeys(def.id, overrides).flatMap((spec) => {
    const parsed = parseShortcut(spec);
    if (!parsed.key) return [];
    // The attribute wants real key names ('ArrowLeft', 'Escape'), so take the
    // spelling as authored rather than the lowercased form the matcher uses.
    const authored = spec.split('+').pop()?.trim() ?? '';
    const key = authored.length === 1 ? authored.toUpperCase() : authored;
    const suffix = [
      parsed.alt ? 'Alt' : null,
      parsed.shift ? 'Shift' : null,
      key,
    ]
      .filter(Boolean)
      .join('+');
    return parsed.mod ? [`Meta+${suffix}`, `Control+${suffix}`] : [suffix];
  });
  return specs.length > 0 ? specs.join(' ') : undefined;
}
