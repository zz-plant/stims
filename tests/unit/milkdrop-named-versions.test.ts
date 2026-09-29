import { describe, expect, test } from 'bun:test';
import {
  createVersionStore,
  type VersionStorage,
} from '../../src/js/milkdrop/named-versions.ts';

const memoryStorage = (): VersionStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

describe('named versions', () => {
  test('saves, lists newest first, and survives a new store on the same storage', () => {
    const storage = memoryStorage();
    let t = 1000;
    const store = createVersionStore(storage, { now: () => (t += 10) });
    store.save('p1', 'first', 'zoom=1\n');
    store.save('p1', 'second', 'zoom=2\n');

    const reopened = createVersionStore(storage);
    expect(reopened.list('p1').map((v) => v.name)).toEqual(['second', 'first']);
    expect(reopened.list('p1')[0]?.source).toBe('zoom=2\n');
  });

  test('versions belong to their preset', () => {
    const store = createVersionStore(memoryStorage());
    store.save('p1', 'a', 'zoom=1\n');
    expect(store.list('p2')).toEqual([]);
  });

  test('an empty name gets a numbered default', () => {
    const store = createVersionStore(memoryStorage());
    store.save('p1', 'kept', 'zoom=1\n');
    const result = store.save('p1', '   ', 'zoom=2\n');
    expect(result.ok && result.version.name).toBe('Version 2');
  });

  test('keeps only the newest N and drops the oldest', () => {
    let t = 0;
    const store = createVersionStore(memoryStorage(), {
      maxPerPreset: 3,
      now: () => (t += 1),
    });
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      store.save('p1', name, `zoom=${name}\n`);
    }
    expect(store.list('p1').map((v) => v.name)).toEqual(['e', 'd', 'c']);
  });

  test('remove deletes one version and reports a miss', () => {
    const store = createVersionStore(memoryStorage());
    const a = store.save('p1', 'a', 'zoom=1\n');
    store.save('p1', 'b', 'zoom=2\n');
    expect(a.ok && store.remove('p1', a.version.id)).toBe(true);
    expect(store.list('p1').map((v) => v.name)).toEqual(['b']);
    expect(store.remove('p1', 'nope')).toBe(false);
  });

  test('refuses an empty or oversized source instead of storing it', () => {
    const store = createVersionStore(memoryStorage(), { maxSourceChars: 10 });
    expect(store.save('p1', 'x', '   \n')).toEqual({
      ok: false,
      reason: 'empty-source',
    });
    expect(store.save('p1', 'x', 'a'.repeat(11))).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(store.list('p1')).toEqual([]);
  });

  test('a full or blocked storage reports failure and never throws', () => {
    const failing: VersionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(createVersionStore(failing).save('p1', 'x', 'zoom=1\n')).toEqual({
      ok: false,
      reason: 'storage-failed',
    });
    expect(createVersionStore(null).save('p1', 'x', 'zoom=1\n')).toEqual({
      ok: false,
      reason: 'storage-failed',
    });
    expect(createVersionStore(null).list('p1')).toEqual([]);
  });

  test('corrupt or foreign data reads as no versions, and bad rows are skipped', () => {
    const storage = memoryStorage();
    storage.data.set('stims:versions:v1:p1', '{not json');
    storage.data.set('stims:versions:v1:p2', JSON.stringify({ not: 'array' }));
    storage.data.set(
      'stims:versions:v1:p3',
      JSON.stringify([
        { id: 'ok', name: 'good', source: 'zoom=1', savedAt: 5 },
        { id: 'bad', name: 3, source: 'zoom=1', savedAt: 5 },
        null,
      ]),
    );
    const store = createVersionStore(storage);
    expect(store.list('p1')).toEqual([]);
    expect(store.list('p2')).toEqual([]);
    expect(store.list('p3').map((v) => v.name)).toEqual(['good']);
  });
});
