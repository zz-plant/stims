export type ShortcutActionId =
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
  | 'compile';

export type ShortcutDefinition = {
  id: ShortcutActionId;
  label: string;
  defaultKeys: string[];
  configurable?: boolean;
};

export const SHORTCUT_STORAGE_KEY = 'stims:keyboard-shortcuts:v1';

export const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  {
    id: 'audio',
    label: 'Playback choices / stop audio',
    defaultKeys: ['Space'],
  },
  { id: 'fullscreen', label: 'Fullscreen', defaultKeys: ['F'] },
  { id: 'browse', label: 'Browse presets', defaultKeys: ['B'] },
  { id: 'settings', label: 'Settings', defaultKeys: ['S'] },
  { id: 'editor', label: 'Edit preset code', defaultKeys: ['E'] },
  { id: 'refine', label: 'Refine with AI', defaultKeys: ['G'] },
  { id: 'visualsearch', label: 'Find a preset', defaultKeys: ['M'] },
  {
    id: 'shuffle',
    label: 'Next preset (random)',
    defaultKeys: ['N', 'ArrowRight'],
  },
  { id: 'previous', label: 'Previous preset', defaultKeys: ['P', 'ArrowLeft'] },
  {
    id: 'favorite',
    label: 'Save current preset',
    // Not L: the standalone MilkDrop overlay's own keybinding layer
    // (src/js/milkdrop/runtime/ui-bridge.ts) already owns L for preset-lock,
    // among a wide set of single-letter nudges (I/O/J/Q, H, W, R) it deals
    // with independently of this registry. Confirmed unused there and here.
    defaultKeys: ['A'],
  },
  {
    id: 'quick-select',
    label: 'Quick-select preset',
    defaultKeys: ['1–9'],
    configurable: false,
  },
  { id: 'help', label: 'This help', defaultKeys: ['?'] },
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

export function readShortcutOverrides(): ShortcutOverrides {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}',
    ) as ShortcutOverrides;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Returns false (instead of throwing) when the write could not persist. */
export function writeShortcutOverrides(overrides: ShortcutOverrides): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(overrides));
    return true;
  } catch (error) {
    // A quota/private-browsing failure here runs inside a keydown handler;
    // letting it throw would take down the whole app via the error boundary
    // for what is only a rebind that fails to persist.
    console.warn('[shortcuts] Could not save shortcut overrides:', error);
    return false;
  }
}

export function eventMatchesShortcut(
  event: KeyboardEvent,
  id: ShortcutActionId,
  overrides: ShortcutOverrides = {},
) {
  const key = event.key === ' ' ? 'Space' : event.key;
  const normalized = key.toLowerCase();
  return getShortcutKeys(id, overrides).some(
    (candidate) => normalizeKey(candidate).toLowerCase() === normalized,
  );
}
