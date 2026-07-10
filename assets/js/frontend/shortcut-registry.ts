export type ShortcutActionId =
  | 'audio'
  | 'fullscreen'
  | 'browse'
  | 'settings'
  | 'editor'
  | 'shuffle'
  | 'previous'
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
  { id: 'audio', label: 'Demo audio / stop audio', defaultKeys: ['Space'] },
  { id: 'fullscreen', label: 'Fullscreen', defaultKeys: ['F'] },
  { id: 'browse', label: 'Browse panel', defaultKeys: ['B'] },
  { id: 'settings', label: 'Settings', defaultKeys: ['S'] },
  { id: 'editor', label: 'Editor', defaultKeys: ['E'] },
  { id: 'shuffle', label: 'Shuffle preset', defaultKeys: ['N', 'ArrowRight'] },
  { id: 'previous', label: 'Previous preset', defaultKeys: ['P', 'ArrowLeft'] },
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

export function writeShortcutOverrides(overrides: ShortcutOverrides) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(overrides));
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
