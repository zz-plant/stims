import { afterEach, describe, expect, test } from 'bun:test';
import {
  getFullscreenElement,
  subscribeToFullscreenChange,
  toggleElementFullscreen,
} from '../assets/js/frontend/fullscreen.ts';
import { replaceProperty } from './test-helpers.ts';

const restores: Array<() => void> = [];

function trackRestore(restore: () => void) {
  restores.push(restore);
}

afterEach(() => {
  while (restores.length > 0) {
    const restore = restores.pop();
    restore?.();
  }
});

describe('frontend fullscreen helpers', () => {
  test('enters fullscreen with the standard api when available', async () => {
    const element = document.createElement('div');
    let requests = 0;

    trackRestore(replaceProperty(document, 'fullscreenElement', null));
    trackRestore(
      replaceProperty(element, 'requestFullscreen', async () => {
        requests += 1;
      }),
    );

    await expect(toggleElementFullscreen(element, document)).resolves.toBe(
      true,
    );
    expect(requests).toBe(1);
  });

  test('falls back to webkit fullscreen entry when needed', async () => {
    const element = document.createElement('div');
    let requests = 0;

    trackRestore(replaceProperty(document, 'fullscreenElement', null));
    trackRestore(replaceProperty(element, 'requestFullscreen', undefined));
    trackRestore(
      replaceProperty(element, 'webkitRequestFullscreen', async () => {
        requests += 1;
      }),
    );

    await expect(toggleElementFullscreen(element, document)).resolves.toBe(
      true,
    );
    expect(requests).toBe(1);
  });

  test('falls back to webkit fullscreen exit when standard exit is missing', async () => {
    const element = document.createElement('div');
    let exits = 0;

    trackRestore(replaceProperty(document, 'fullscreenElement', null));
    trackRestore(replaceProperty(document, 'webkitFullscreenElement', element));
    trackRestore(replaceProperty(document, 'exitFullscreen', undefined));
    trackRestore(
      replaceProperty(document, 'webkitExitFullscreen', async () => {
        exits += 1;
      }),
    );

    await expect(toggleElementFullscreen(element, document)).resolves.toBe(
      true,
    );
    expect(exits).toBe(1);
  });

  test('reports the active fullscreen element from standard or webkit state', () => {
    const element = document.createElement('div');

    trackRestore(replaceProperty(document, 'fullscreenElement', null));
    trackRestore(replaceProperty(document, 'webkitFullscreenElement', element));

    expect(getFullscreenElement(document)).toBe(element);
  });

  test('listens to both fullscreen change event variants', () => {
    let calls = 0;
    const unsubscribe = subscribeToFullscreenChange(() => {
      calls += 1;
    }, document);

    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(calls).toBe(2);

    unsubscribe();
    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(calls).toBe(2);
  });
});
