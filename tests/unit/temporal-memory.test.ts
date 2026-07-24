import { afterEach, expect, test } from 'bun:test';
import {
  getSavedCheckpoints,
  saveCheckpoint,
} from '../../src/js/core/services/temporal-memory.ts';
import { replaceProperty } from '../test-helpers.ts';

let restoreLocalStorage = () => {};
let restoreCrypto = () => {};

afterEach(() => {
  restoreLocalStorage();
  restoreCrypto();
  restoreLocalStorage = () => {};
  restoreCrypto = () => {};
  window.localStorage.clear();
});

test('visual checkpoints tolerate unavailable storage and crypto UUIDs', () => {
  restoreLocalStorage = replaceProperty(globalThis, 'localStorage', {
    getItem: () => {
      throw new Error('storage blocked');
    },
    setItem: () => {
      throw new Error('storage blocked');
    },
  });
  restoreCrypto = replaceProperty(globalThis, 'crypto', {});

  expect(getSavedCheckpoints()).toEqual([]);
  expect(() => saveCheckpoint('A', 'B', 'preset')).not.toThrow();
});
