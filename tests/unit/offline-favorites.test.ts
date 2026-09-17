import { afterEach, describe, expect, test } from 'bun:test';
import { warmFavoriteForOffline } from '../../src/js/frontend/offline-favorites.ts';

/**
 * The shell tells the user offline party mode keeps saved presets working.
 * What backed that was the service worker caching whatever had already been
 * fetched, so a preset saved from a browse tile and never played was not
 * offline at all. Saving is the signal; saving fetches.
 */

const restore: Array<() => void> = [];

function stub(name: string, value: unknown) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  restore.push(() => {
    if (prior) Object.defineProperty(globalThis, name, prior);
    else Reflect.deleteProperty(globalThis, name);
  });
}

/** Runs the deferred work straight away so the test does not wait on it. */
function runWarmImmediately() {
  stub('requestIdleCallback', (cb: () => void) => {
    cb();
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

describe('warming a saved preset for offline', () => {
  test('fetches the preset source and its thumbnail', async () => {
    runWarmImmediately();
    const fetched: string[] = [];
    stub('fetch', async (input: unknown) => {
      fetched.push(String(input));
      return new Response(null, { status: 200 });
    });
    const asked: string[] = [];

    warmFavoriteForOffline('geiss-bipolar-x', async (id) => {
      asked.push(id);
      return null;
    });
    await settle();

    // The source goes through the app's ordinary read path, which is what
    // both warms the worker's cache and compiles it on the way past.
    expect(asked).toEqual(['geiss-bipolar-x']);
    expect(fetched).toEqual(['/milkdrop-presets/previews/geiss-bipolar-x.png']);
  });

  test('survives being offline at the moment of saving', async () => {
    runWarmImmediately();
    stub('fetch', async () => {
      throw new Error('offline');
    });

    // The save itself has already succeeded; there is nothing to tell the
    // user, and an unhandled rejection here would be the session's first
    // logged error.
    expect(() =>
      warmFavoriteForOffline('geiss-bipolar-x', async () => {
        throw new Error('offline');
      }),
    ).not.toThrow();
    await settle();
  });

  test('does nothing without a preset id', async () => {
    runWarmImmediately();
    const fetched: string[] = [];
    stub('fetch', async (input: unknown) => {
      fetched.push(String(input));
      return new Response(null, { status: 200 });
    });
    const asked: string[] = [];

    warmFavoriteForOffline('   ', async (id) => {
      asked.push(id);
      return null;
    });
    await settle();

    expect(asked).toEqual([]);
    expect(fetched).toEqual([]);
  });

  test('defers off the click that triggered it', async () => {
    // A live stage never goes idle, so the deadline is what fires — but the
    // work must not land on the frame that handled the press either way.
    let deferred: (() => void) | null = null;
    stub('requestIdleCallback', (cb: () => void) => {
      deferred = cb;
    });
    const asked: string[] = [];

    warmFavoriteForOffline('geiss-bipolar-x', async (id) => {
      asked.push(id);
      return null;
    });

    expect(asked).toEqual([]);
    expect(deferred).not.toBeNull();
  });
});
