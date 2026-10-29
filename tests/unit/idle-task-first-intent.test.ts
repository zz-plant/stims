/**
 * The decorative attract render starts on the first intent gesture or the
 * idle fallback, whichever comes first. These tests pin the trigger, the
 * one-shot behaviour and the cleanup so the listener cannot leak.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { scheduleOnFirstIntent } from '../../src/js/utils/browser/idle-task.ts';

type Listener = { fn: () => void; capture: boolean };

class FakeWindow {
  readonly listeners = new Map<string, Listener[]>();

  addEventListener(
    type: string,
    fn: () => void,
    options?: boolean | { capture?: boolean },
  ) {
    const capture =
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture });
    this.listeners.set(type, list);
  }

  removeEventListener(
    type: string,
    fn: () => void,
    options?: boolean | { capture?: boolean },
  ) {
    const capture =
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((entry) => entry.fn !== fn || entry.capture !== capture),
    );
  }

  dispatch(type: string) {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      entry.fn();
    }
  }

  count() {
    let total = 0;
    for (const list of this.listeners.values()) total += list.length;
    return total;
  }
}

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe('scheduleOnFirstIntent', () => {
  test('a key gesture runs the callback once and removes every listener', () => {
    const fake = new FakeWindow();
    (globalThis as { window?: unknown }).window = fake;
    let calls = 0;

    scheduleOnFirstIntent(() => {
      calls += 1;
    });

    expect(fake.count()).toBeGreaterThan(0);
    fake.dispatch('keydown');
    expect(calls).toBe(1);
    expect(fake.count()).toBe(0);
  });

  test('a scroll or click also counts as intent', () => {
    for (const gesture of ['scroll', 'pointerdown', 'wheel', 'touchstart']) {
      const fake = new FakeWindow();
      (globalThis as { window?: unknown }).window = fake;
      let calls = 0;
      scheduleOnFirstIntent(() => {
        calls += 1;
      });
      fake.dispatch(gesture);
      expect(calls).toBe(1);
    }
  });

  test('the grace period runs when nobody interacts', async () => {
    const fake = new FakeWindow();
    (globalThis as { window?: unknown }).window = fake;
    let calls = 0;

    scheduleOnFirstIntent(
      () => {
        calls += 1;
      },
      { fallbackDelay: 0 },
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(1);
    expect(fake.count()).toBe(0);
  });

  test('cancelling before either trigger removes the listeners and never runs', async () => {
    const fake = new FakeWindow();
    (globalThis as { window?: unknown }).window = fake;
    let calls = 0;

    const cancel = scheduleOnFirstIntent(
      () => {
        calls += 1;
      },
      { fallbackDelay: 0 },
    );
    cancel();
    fake.dispatch('keydown');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(0);
    expect(fake.count()).toBe(0);
  });
});
