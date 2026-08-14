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

test('visual checkpoints discard malformed persisted entries', () => {
  window.localStorage.setItem(
    'stims:visual-checkpoints',
    JSON.stringify([
      null,
      { id: 'broken' },
      {
        id: 'valid',
        name: 'A',
        description: 'B',
        presetId: 'preset',
        timestamp: 42,
      },
    ]),
  );

  expect(getSavedCheckpoints()).toEqual([
    {
      id: 'valid',
      name: 'A',
      description: 'B',
      presetId: 'preset',
      timestamp: 42,
    },
  ]);

  window.localStorage.setItem('stims:visual-checkpoints', '{}');
  expect(getSavedCheckpoints()).toEqual([]);
  expect(() => saveCheckpoint('New', 'Description', 'preset')).not.toThrow();
  expect(getSavedCheckpoints()).toHaveLength(1);
});
