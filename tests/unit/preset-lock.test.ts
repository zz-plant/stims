import { afterEach, expect, test } from 'bun:test';
import {
  isPresetLocked,
  resetPresetLock,
  setPresetLocked,
  subscribePresetLock,
  togglePresetLock,
} from '../../src/js/core/preset-lock.ts';

afterEach(() => resetPresetLock());

test('starts unlocked, so a fresh session auto-advances as configured', () => {
  expect(isPresetLocked()).toBe(false);
});

test('toggle reports the state it moved to', () => {
  expect(togglePresetLock()).toBe(true);
  expect(isPresetLocked()).toBe(true);
  expect(togglePresetLock()).toBe(false);
});

test('subscribers hear a change once, and not on a no-op set', () => {
  let calls = 0;
  const unsubscribe = subscribePresetLock(() => {
    calls += 1;
  });

  setPresetLocked(true);
  expect(calls).toBe(1);

  // The dock button and the `L` keybinding both write this store; setting it
  // to the value it already holds must not re-render every subscriber.
  setPresetLocked(true);
  expect(calls).toBe(1);

  unsubscribe();
  setPresetLocked(false);
  expect(calls).toBe(1);
});
