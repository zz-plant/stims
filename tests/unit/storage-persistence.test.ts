import { afterEach, describe, expect, test } from 'bun:test';
import {
  describePersistentStorage,
  ensurePersistentStorage,
  resetPersistentStorageRequest,
} from '../../src/js/frontend/storage-persistence.ts';

/**
 * This app keeps no accounts, so the browser's storage is the account: an
 * eviction takes the user's imported presets, favourites, drafts, rigs and
 * rebindings with nothing to restore from. The behaviour worth pinning is
 * that asking is cheap and happens once — Firefox turns `persist()` into a
 * permission prompt, and a dialog on every save would be worse than the
 * eviction risk it guards against.
 */

type StorageStub = {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
};

const nav = globalThis.navigator as unknown as Record<string, unknown>;
let priorStorage: PropertyDescriptor | undefined;
let installed = false;

function stubStorage(storage: StorageStub | undefined) {
  if (!installed) {
    priorStorage = Object.getOwnPropertyDescriptor(nav, 'storage');
    installed = true;
  }
  Object.defineProperty(nav, 'storage', {
    configurable: true,
    writable: true,
    value: storage,
  });
}

afterEach(() => {
  resetPersistentStorageRequest();
  if (!installed) return;
  if (priorStorage) Object.defineProperty(nav, 'storage', priorStorage);
  else Reflect.deleteProperty(nav, 'storage');
  installed = false;
});

describe('persistent storage request', () => {
  test('asks once per page load however the browser answers', async () => {
    let asked = 0;
    stubStorage({
      persisted: async () => false,
      persist: async () => {
        asked += 1;
        return false;
      },
    });

    // A refusal must not become a permission prompt on every later save.
    expect(await ensurePersistentStorage()).toBe(false);
    expect(await ensurePersistentStorage()).toBe(false);
    expect(await ensurePersistentStorage()).toBe(false);
    expect(asked).toBe(1);
  });

  test('does not re-ask when storage is already persisted', async () => {
    let asked = 0;
    stubStorage({
      persisted: async () => true,
      persist: async () => {
        asked += 1;
        return true;
      },
    });

    expect(await ensurePersistentStorage()).toBe(true);
    expect(asked).toBe(0);
    expect(await describePersistentStorage()).toBe('already-persisted');
  });

  test('reports a grant', async () => {
    stubStorage({ persisted: async () => false, persist: async () => true });
    expect(await ensurePersistentStorage()).toBe(true);
    expect(await describePersistentStorage()).toBe('granted');
  });

  test('treats a browser without the API as unsupported, not an error', async () => {
    stubStorage(undefined);
    expect(await ensurePersistentStorage()).toBe(false);
    expect(await describePersistentStorage()).toBe('unsupported');
  });

  test('survives a context that rejects outright', async () => {
    // Private windows and some embedded panes throw rather than answering.
    stubStorage({
      persisted: async () => {
        throw new Error('not allowed');
      },
      persist: async () => true,
    });

    expect(await ensurePersistentStorage()).toBe(false);
    expect(await describePersistentStorage()).toBe('unsupported');
  });
});
