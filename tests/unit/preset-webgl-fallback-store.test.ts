import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  markPresetNeedsWebgl,
  presetNeedsWebgl,
} from '../../src/js/core/state/preset-webgl-fallback.ts';

/**
 * `markPresetNeedsWebgl` returning false is what stops the WebGPU->WebGL
 * failover from reloading into an unbounded loop, so the return value needs
 * coverage of its own — see backend-webgl-fallback.test.ts for the caller.
 *
 * The `sessionStorage` global is swapped here rather than `mock.module`'ing
 * the `browser-storage.ts` seam. `mock.module` is process-global *and*
 * permanent in Bun: the stub this file used to install was what every file
 * loaded after it saw, and it implemented only getItem/setItem/removeItem —
 * enough for these tests, but `reset-overrides.test.ts` (which sorts later)
 * then crashed on the missing `clear`, and `resetAllOverrides` itself
 * enumerates storage through the missing `length`/`key`. Both files passed
 * alone. A global swapped in `beforeEach` and restored in `afterEach` cannot
 * outlive this file.
 *
 * The two failure modes worth pinning are "touching the global throws"
 * (cross-origin embed with third-party storage blocked) and "setItem throws"
 * (Safari private mode quota). Modelling them on the global rather than on the
 * seam means the real `getBrowserSessionStorage()` swallow-to-null path is
 * exercised too instead of being stubbed away.
 */

type StorageMode = 'working' | 'unreachable' | 'quota-exceeded';

let mode: StorageMode = 'working';
let backing = new Map<string, string>();
let savedDescriptor: PropertyDescriptor | undefined;

function createFakeStorage(): Storage {
  return {
    get length() {
      return backing.size;
    },
    key: (index: number) => [...backing.keys()][index] ?? null,
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (mode === 'quota-exceeded') {
        throw new Error('QuotaExceededError');
      }
      backing.set(key, value);
    },
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
  } as unknown as Storage;
}

beforeEach(() => {
  mode = 'working';
  backing = new Map();
  savedDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'sessionStorage',
  );

  const storage = createFakeStorage();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      if (mode === 'unreachable') {
        // The property access itself throws, before any method is called —
        // which is what the helper's try/catch exists for.
        throw new Error('SecurityError: storage is not available');
      }
      return storage;
    },
  });
});

afterEach(() => {
  if (savedDescriptor) {
    Object.defineProperty(globalThis, 'sessionStorage', savedDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
  savedDescriptor = undefined;
});

describe('markPresetNeedsWebgl persistence reporting', () => {
  test('reports true when the write lands', () => {
    expect(markPresetNeedsWebgl('preset-a')).toBe(true);
    expect(presetNeedsWebgl('preset-a')).toBe(true);
  });

  test('reports true for an already-recorded preset', () => {
    expect(markPresetNeedsWebgl('preset-a')).toBe(true);
    // Already durable, so the caller may still reload.
    expect(markPresetNeedsWebgl('preset-a')).toBe(true);
  });

  test('reports false when session storage is unreachable', () => {
    mode = 'unreachable';
    // The helper console.debug()s each swallowed access. That is the
    // behaviour under test, not three "error: SecurityError" lines worth
    // printing into every suite run.
    const debug = console.debug;
    console.debug = () => {};

    try {
      expect(markPresetNeedsWebgl('preset-a')).toBe(false);
      // Which is exactly why the caller must not reload: the reload's
      // renderer selection reads this back and gets nothing.
      expect(presetNeedsWebgl('preset-a')).toBe(false);
    } finally {
      console.debug = debug;
    }
  });

  test('reports false when setItem throws on quota', () => {
    mode = 'quota-exceeded';

    expect(markPresetNeedsWebgl('preset-a')).toBe(false);
    expect(presetNeedsWebgl('preset-a')).toBe(false);
  });

  test('ignores an empty preset id', () => {
    expect(markPresetNeedsWebgl('')).toBe(false);
  });
});
