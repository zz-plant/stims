import { describe, expect, test } from 'bun:test';
import { createLazyFactory } from '../../src/js/frontend/use-lazy-factory.ts';

type Instance = { id: string; disposed: boolean };

/**
 * Mirrors how workspace-hooks drives the factory: refs that survive across
 * calls, plus the deferred teardown that nulls them.
 */
function createHarness() {
  const slots: {
    ref: Instance | null;
    promise: Promise<Instance> | null;
    disposed: boolean;
  } = { ref: null, promise: null, disposed: false };

  const built: Instance[] = [];
  const installed: Instance[] = [];

  // A queue, not a single slot: two sessions can each have a factory in flight,
  // and settling one must not strand the other.
  const deferreds: Array<{
    resolve: (instance: Instance) => void;
    reject: (error: Error) => void;
  }> = [];

  const ensure = createLazyFactory<Instance>({
    name: 'TestAdapter',
    factory: () =>
      new Promise<Instance>((resolve, reject) => {
        deferreds.push({
          resolve: (instance) => {
            built.push(instance);
            resolve(instance);
          },
          reject,
        });
      }),
    getRef: () => slots.ref,
    setRef: (value) => {
      slots.ref = value;
    },
    getPromiseRef: () => slots.promise,
    setPromiseRef: (value) => {
      slots.promise = value;
    },
    install: (instance) => {
      installed.push(instance);
    },
    cleanup: (instance) => {
      instance.disposed = true;
    },
    isDisposed: () => slots.disposed,
  });

  return {
    slots,
    built,
    installed,
    ensure,
    /** Settle the Nth still-pending factory call (default: the oldest). */
    resolveWith(id: string, index = 0) {
      const instance: Instance = { id, disposed: false };
      deferreds.splice(index, 1)[0]?.resolve(instance);
      return instance;
    },
    rejectWith(message: string, index = 0) {
      deferreds.splice(index, 1)[0]?.reject(new Error(message));
    },
    pendingCount: () => deferreds.length,
    /** What workspace-hooks' deferred cleanup does. */
    tearDown() {
      slots.disposed = true;
      slots.ref = null;
      slots.promise = null;
    },
  };
}

describe('createLazyFactory', () => {
  test('builds once and caches the instance for later calls', async () => {
    const h = createHarness();
    const first = h.ensure();
    h.resolveWith('a');
    const instance = await first;

    expect(instance.id).toBe('a');
    expect(await h.ensure()).toBe(instance);
    expect(h.built).toHaveLength(1);
    expect(h.installed).toEqual([instance]);
  });

  test('concurrent callers join one in-flight promise instead of building twice', async () => {
    const h = createHarness();
    const a = h.ensure();
    const b = h.ensure();
    h.resolveWith('a');

    expect(await a).toBe(await b);
    expect(h.built).toHaveLength(1);
    expect(h.installed).toHaveLength(1);
  });

  test('a StrictMode remount that joins the parked promise still installs', async () => {
    const h = createHarness();
    const first = h.ensure();

    // Cleanup ran and the remount reset the flag before the timer fired, so the
    // refs were never cleared.
    h.slots.disposed = true;
    h.slots.disposed = false;
    const second = h.ensure();

    h.resolveWith('a');
    const instance = await second;

    expect(await first).toBe(instance);
    expect(instance.disposed).toBe(false);
    expect(h.slots.ref).toBe(instance);
    expect(h.installed).toEqual([instance]);
  });

  test('an instance resolving after teardown disposes itself and does not install', async () => {
    const h = createHarness();
    const inFlight = h.ensure();
    h.tearDown();
    const instance = h.resolveWith('a');

    await expect(inFlight).rejects.toThrow(/superseded/u);
    expect(instance.disposed).toBe(true);
    expect(h.slots.ref).toBeNull();
    expect(h.installed).toEqual([]);
  });

  test('a stale instance never installs over a newer live session', async () => {
    const h = createHarness();
    const stale = h.ensure();

    // Session ends, then a new session starts its own build.
    h.tearDown();
    h.slots.disposed = false;
    const fresh = h.ensure();
    expect(h.pendingCount()).toBe(2);

    // Settle the newer build (index 1) while the stale one is still in flight.
    const freshInstance = h.resolveWith('fresh', 1);
    await fresh;

    expect(h.slots.ref).toBe(freshInstance);

    // Only now does the first session's factory settle.
    const staleInstance = h.resolveWith('stale', 0);
    await expect(stale).rejects.toThrow(/superseded/u);

    expect(staleInstance.disposed).toBe(true);
    // The live session is untouched: still installed, still referenced.
    expect(h.slots.ref).toBe(freshInstance);
    expect(freshInstance.disposed).toBe(false);
    expect(h.installed).toEqual([freshInstance]);
  });

  test('a failure clears the slot so the next call can retry', async () => {
    const h = createHarness();
    const attempt = h.ensure();
    h.rejectWith('import blew up');

    await expect(attempt).rejects.toThrow(/import blew up/u);
    expect(h.slots.promise).toBeNull();

    const retry = h.ensure();
    h.resolveWith('b');
    expect((await retry).id).toBe('b');
  });

  test('a stale failure does not clear a newer session slot', async () => {
    const h = createHarness();
    const stale = h.ensure();

    h.tearDown();
    h.slots.disposed = false;
    const fresh = h.ensure();
    const freshPromise = h.slots.promise;
    expect(h.pendingCount()).toBe(2);

    // Fail the stale build (index 0); the newer slot must survive it.
    h.rejectWith('stale import blew up', 0);
    await expect(stale).rejects.toThrow();

    expect(h.slots.promise).toBe(freshPromise);

    h.resolveWith('fresh', 0);
    await expect(fresh).resolves.toMatchObject({ id: 'fresh' });
  });
});
