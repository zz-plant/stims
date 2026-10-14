import { afterEach, describe, expect, test } from 'bun:test';
import { importFresh } from '../test-helpers.ts';

type DisplayModule =
  typeof import('../../src/js/core/services/external-display-service.ts');

const load = () =>
  importFresh<DisplayModule>(
    '../../src/js/core/services/external-display-service.ts',
  );

/**
 * happy-dom defines `getScreenDetails` on the window prototype, so `delete`
 * cannot remove it — the property has to be shadowed with undefined to
 * simulate a browser that lacks the API.
 */
function setGlobal(key: string, value: unknown) {
  Object.defineProperty(window, key, {
    value,
    configurable: true,
    writable: true,
  });
}

function cleanupGlobals() {
  setGlobal('PresentationRequest', undefined);
  setGlobal('getScreenDetails', undefined);
}

afterEach(cleanupGlobals);

describe('external display service — capability detection', () => {
  test('reports no capability on a browser with neither API', async () => {
    cleanupGlobals();
    const mod = await load();
    expect(mod.isCastSupported()).toBe(false);
    expect(mod.isSecondScreenSupported()).toBe(false);
  });

  test('detects the cast and window-management APIs independently', async () => {
    cleanupGlobals();
    setGlobal('PresentationRequest', function PresentationRequest() {});
    const mod = await load();
    expect(mod.isCastSupported()).toBe(true);
    // Neither implies the other — a laptop can cast with one screen, and a
    // desk with two monitors need not have any cast target.
    expect(mod.isSecondScreenSupported()).toBe(false);
  });
});

describe('external display service — casting', () => {
  test('records the connection and target once a cast starts', async () => {
    let closeListener: undefined | (() => void);
    setGlobal(
      'PresentationRequest',
      function PresentationRequest(this: unknown, urls: string[]) {
        expect(urls).toEqual(['https://example.test/?sync=room1']);
        return {
          start: async () => ({
            close: () => {},
            terminate: () => {},
            addEventListener: (type: string, listener: () => void) => {
              if (type === 'close') closeListener = listener;
            },
          }),
        };
      },
    );

    const mod = await load();
    await mod.startCast('https://example.test/?sync=room1');
    expect(mod.getExternalDisplayState().mode).toBe('cast');

    // Ending the cast from the device must clear the app's own state.
    closeListener?.();
    expect(mod.getExternalDisplayState().mode).toBeNull();
  });

  test('a dismissed picker is a cancel, not an error', async () => {
    setGlobal('PresentationRequest', function PresentationRequest() {
      return {
        start: async () => {
          throw new DOMException('cancelled', 'NotAllowedError');
        },
      };
    });

    const mod = await load();
    await mod.startCast('https://example.test/');
    const state = mod.getExternalDisplayState();
    expect(state.mode).toBeNull();
    expect(state.error).toBeNull();
  });

  test('a real failure surfaces an error and rethrows', async () => {
    setGlobal('PresentationRequest', function PresentationRequest() {
      return {
        start: async () => {
          throw new Error('receiver exploded');
        },
      };
    });

    const mod = await load();
    await expect(mod.startCast('https://example.test/')).rejects.toThrow(
      /receiver exploded/,
    );
    expect(mod.getExternalDisplayState().error).toBeTruthy();
  });
});

describe('external display service — finding a second screen', () => {
  test('reports the work area of the screen that is not the current one', async () => {
    const current = {
      availLeft: 0,
      availTop: 0,
      availWidth: 1440,
      availHeight: 900,
      isPrimary: true,
    };
    const external = {
      availLeft: 1440,
      availTop: 0,
      availWidth: 1920,
      availHeight: 1080,
      isPrimary: false,
      label: 'Projector',
    };
    setGlobal('getScreenDetails', async () => ({
      screens: [current, external],
      currentScreen: current,
    }));

    const mod = await load();
    // The placement is the entire point: the external screen's own
    // coordinates, not the primary's.
    expect(await mod.findSecondScreen()).toEqual({
      ok: true,
      screen: {
        left: 1440,
        top: 0,
        width: 1920,
        height: 1080,
        label: 'Projector',
      },
    });
  });

  test('says so when the machine has only one screen', async () => {
    const only = {
      availLeft: 0,
      availTop: 0,
      availWidth: 1440,
      availHeight: 900,
      isPrimary: true,
    };
    setGlobal('getScreenDetails', async () => ({
      screens: [only],
      currentScreen: only,
    }));

    const mod = await load();
    const found = await mod.findSecondScreen();
    expect(found.ok).toBe(false);
    expect(found.ok ? '' : found.error).toMatch(/second screen/i);
  });

  test('a denied window-management permission reports actionable guidance', async () => {
    setGlobal('getScreenDetails', async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const mod = await load();
    const found = await mod.findSecondScreen();
    expect(found.ok ? '' : found.error).toMatch(/site settings/i);
  });

  test('a browser without the API says it cannot place a window', async () => {
    const mod = await load();
    const found = await mod.findSecondScreen();
    expect(found.ok ? '' : found.error).toMatch(/cannot place a window/i);
  });
});
