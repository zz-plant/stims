/**
 * Author-named versions of a preset, kept in the browser.
 *
 * The History tab has only ever held the last eight automatic checkpoints, in
 * memory, taken before an AI edit or a restore. That is a safety net, not
 * version control: close the tab and it is gone, and the author cannot say
 * "this one, before I broke the warp". A named version is the author's own
 * bookmark, and it survives a reload.
 *
 * Storage is injected so this stays a pure module, and every failure mode of
 * browser storage (blocked, full, corrupt JSON, another schema) degrades to
 * "no versions" or "could not save" instead of throwing into the editor.
 */

export type NamedVersion = {
  id: string;
  name: string;
  source: string;
  savedAt: number;
};

export type VersionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type SaveResult =
  | { ok: true; version: NamedVersion }
  | { ok: false; reason: 'empty-source' | 'too-large' | 'storage-failed' };

export type VersionStoreOptions = {
  /** Oldest versions are dropped past this many per preset. */
  maxPerPreset?: number;
  /** A single version larger than this is refused rather than half-stored. */
  maxSourceChars?: number;
  now?: () => number;
};

const KEY_PREFIX = 'stims:versions:v1:';

function isVersion(value: unknown): value is NamedVersion {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.source === 'string' &&
    typeof v.savedAt === 'number' &&
    Number.isFinite(v.savedAt)
  );
}

export function createVersionStore(
  storage: VersionStorage | null,
  {
    maxPerPreset = 30,
    maxSourceChars = 500_000,
    now = Date.now,
  }: VersionStoreOptions = {},
) {
  const keyFor = (presetKey: string) => `${KEY_PREFIX}${presetKey}`;

  const read = (presetKey: string): NamedVersion[] => {
    if (!storage) return [];
    try {
      const raw = storage.getItem(keyFor(presetKey));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isVersion) : [];
    } catch {
      return [];
    }
  };

  const write = (presetKey: string, versions: NamedVersion[]): boolean => {
    if (!storage) return false;
    try {
      storage.setItem(keyFor(presetKey), JSON.stringify(versions));
      return true;
    } catch {
      return false;
    }
  };

  let counter = 0;

  return {
    /** Newest first. */
    list(presetKey: string): NamedVersion[] {
      return read(presetKey).sort((a, b) => b.savedAt - a.savedAt);
    },

    save(presetKey: string, name: string, source: string): SaveResult {
      if (!source.trim()) return { ok: false, reason: 'empty-source' };
      if (source.length > maxSourceChars) {
        return { ok: false, reason: 'too-large' };
      }
      const existing = read(presetKey);
      const savedAt = now();
      counter += 1;
      const version: NamedVersion = {
        id: `${savedAt.toString(36)}-${counter}`,
        name: name.trim() || `Version ${existing.length + 1}`,
        source,
        savedAt,
      };
      const next = [...existing, version]
        .sort((a, b) => a.savedAt - b.savedAt)
        .slice(-maxPerPreset);
      return write(presetKey, next)
        ? { ok: true, version }
        : { ok: false, reason: 'storage-failed' };
    },

    remove(presetKey: string, id: string): boolean {
      const existing = read(presetKey);
      const next = existing.filter((version) => version.id !== id);
      if (next.length === existing.length) return false;
      return write(presetKey, next);
    },
  };
}

/** `localStorage` if this browser lets us touch it, otherwise nothing. */
export function browserVersionStorage(): VersionStorage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // Some private modes expose the object but throw on first write.
    const probe = `${KEY_PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
