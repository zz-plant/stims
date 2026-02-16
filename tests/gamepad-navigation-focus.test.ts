import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { initGamepadNavigation } from '../assets/js/utils/gamepad-navigation.ts';

describe('gamepad navigation focus initialization and restoration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  test('focuses the first interactive element when no active focus exists', () => {
    const first = document.createElement('button');
    first.id = 'first';
    first.textContent = 'First';
    const second = document.createElement('button');
    second.textContent = 'Second';
    document.body.append(first, second);

    const cleanup = initGamepadNavigation();

    expect(document.activeElement).toBe(first);
    cleanup();
  });

  test('restores the previous focused element from session storage', () => {
    const first = document.createElement('button');
    first.id = 'first';
    const second = document.createElement('button');
    second.id = 'second';
    document.body.append(first, second);

    const storageKey = `stims:last-focus:${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ selector: '#second', index: 1 }),
    );

    const cleanup = initGamepadNavigation({
      focusStorageKey: 'stims:last-focus',
    });

    expect(document.activeElement).toBe(second);
    cleanup();
  });
});
