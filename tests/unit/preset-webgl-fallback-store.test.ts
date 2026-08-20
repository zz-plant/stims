import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * `markPresetNeedsWebgl` returning false is what stops the WebGPU->WebGL
 * failover from reloading into an unbounded loop, so the return value needs
 * coverage of its own — see backend-webgl-fallback.test.ts for the caller.
 *
 * The storage seam is mocked rather than the `sessionStorage` global: the
 * failure modes worth pinning are "the global throws on access" and "setItem
 * throws", and both are only observable through this helper.
 */

type StorageMode = 'working' | 'unreachable' | 'quota-exceeded';

let mode: StorageMode = 'working';
let backing = new Map<string, string>();

mock.module('../../src/js/core/state/browser-storage.ts', () => ({
  getBrowserStorage: () => null,
  getBrowserSessionStorage: () => {
    // Mirrors the real helper: a global that throws on access (cross-origin
    // embed with third-party storage blocked) is swallowed into null.
    if (mode === 'unreachable') return null;
    return {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (mode === 'quota-exceeded') {
          throw new Error('QuotaExceededError');
        }
        backing.set(key, value);
      },
      removeItem: (key: string) => void backing.delete(key),
    } as unknown as Storage;
  },
}));

const STORE = '../../src/js/core/state/preset-webgl-fallback.ts';

beforeEach(() => {
  mode = 'working';
  backing = new Map();
});

describe('markPresetNeedsWebgl persistence reporting', () => {
  test('reports true when the write lands', async () => {
    const { markPresetNeedsWebgl, presetNeedsWebgl } = await import(STORE);

    expect(markPresetNeedsWebgl('preset-a')).toBe(true);
    expect(presetNeedsWebgl('preset-a')).toBe(true);
  });

  test('reports true for an already-recorded preset', async () => {
    const { markPresetNeedsWebgl } = await import(STORE);

    expect(markPresetNeedsWebgl('preset-a')).toBe(true);
    // Already durable, so the caller may still reload.
    expect(markPresetNeedsWebgl('preset-a')).toBe(true);
  });

  test('reports false when session storage is unreachable', async () => {
    mode = 'unreachable';
    const { markPresetNeedsWebgl, presetNeedsWebgl } = await import(STORE);

    expect(markPresetNeedsWebgl('preset-a')).toBe(false);
    // Which is exactly why the caller must not reload: the reload's renderer
    // selection reads this back and gets nothing.
    expect(presetNeedsWebgl('preset-a')).toBe(false);
  });

  test('reports false when setItem throws on quota', async () => {
    mode = 'quota-exceeded';
    const { markPresetNeedsWebgl, presetNeedsWebgl } = await import(STORE);

    expect(markPresetNeedsWebgl('preset-a')).toBe(false);
    expect(presetNeedsWebgl('preset-a')).toBe(false);
  });

  test('ignores an empty preset id', async () => {
    const { markPresetNeedsWebgl } = await import(STORE);

    expect(markPresetNeedsWebgl('')).toBe(false);
  });
});
