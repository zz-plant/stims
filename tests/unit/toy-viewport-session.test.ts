import { afterEach, expect, mock, test } from 'bun:test';
import { createToyViewportSession } from '../../src/js/core/toy-viewport-session.ts';
import { replaceProperty } from '../test-helpers.ts';

let restoreMatchMedia = () => {};

afterEach(() => {
  restoreMatchMedia();
  restoreMatchMedia = () => {};
});

test('toy viewport session supports legacy MediaQueryList listeners', () => {
  const addListener = mock();
  const removeListener = mock();
  restoreMatchMedia = replaceProperty(window, 'matchMedia', () => ({
    matches: true,
    media: '(resolution: 1dppx)',
    onchange: null,
    addListener,
    removeListener,
    dispatchEvent: () => false,
  }));

  const session = createToyViewportSession({
    container: null,
    onResize: mock(),
  });

  expect(addListener).toHaveBeenCalledTimes(1);
  session.dispose();
  expect(removeListener).toHaveBeenCalledTimes(1);
});

/**
 * Harness for the resize-path tests: synchronous rAF, controllable
 * performance.now, a matchMedia stub that records every query created and
 * the change handlers attached to it, and writable window metrics.
 */
function setupViewportHarness() {
  const restores: Array<() => void> = [];
  const queries: Array<{ media: string; handlers: Array<() => void> }> = [];
  restores.push(
    replaceProperty(window, 'matchMedia', (media: string) => {
      const entry = { media, handlers: [] as Array<() => void> };
      queries.push(entry);
      return {
        matches: true,
        media,
        onchange: null,
        addEventListener: (_type: string, handler: () => void) => {
          entry.handlers.push(handler);
        },
        removeEventListener: (_type: string, handler: () => void) => {
          entry.handlers = entry.handlers.filter((h) => h !== handler);
        },
        dispatchEvent: () => false,
      };
    }),
  );
  restores.push(
    // Synchronous rAF. Returns null so the session's one-scheduled-frame
    // guard (`resizeFrameId !== null`) stays clear for the next event —
    // the callback has already run by the time the id is assigned.
    replaceProperty(window, 'requestAnimationFrame', (cb: () => void) => {
      cb();
      return null;
    }),
  );
  let now = 10_000;
  restores.push(replaceProperty(performance, 'now', () => now));
  const setMetrics = ({ width, dpr }: { width?: number; dpr?: number }) => {
    if (width !== undefined) {
      restores.push(replaceProperty(window, 'innerWidth', width));
    }
    if (dpr !== undefined) {
      restores.push(replaceProperty(window, 'devicePixelRatio', dpr));
    }
  };
  return {
    queries,
    setMetrics,
    advanceNow: (ms: number) => {
      now += ms;
    },
    restore: () => {
      for (const r of restores.reverse()) r();
    },
  };
}

test('a DPR-only change still reaches onResize', () => {
  const harness = setupViewportHarness();
  harness.setMetrics({ width: 800, dpr: 1 });
  const onResize = mock();
  const session = createToyViewportSession({ container: null, onResize });
  try {
    expect(onResize).not.toHaveBeenCalled();

    harness.setMetrics({ dpr: 2 });
    const activeQuery = harness.queries[harness.queries.length - 1];
    for (const handler of [...activeQuery.handlers]) handler();

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0][0].dpr).toBe(2);
    expect(onResize.mock.calls[0][0].cssWidth).toBe(800);
  } finally {
    session.dispose();
    harness.restore();
  }
});

test('the DPR media query is re-created after each change', () => {
  const harness = setupViewportHarness();
  harness.setMetrics({ width: 800, dpr: 1 });
  const session = createToyViewportSession({
    container: null,
    onResize: mock(),
  });
  try {
    expect(harness.queries.map((q) => q.media)).toEqual([
      '(resolution: 1dppx)',
    ]);

    harness.setMetrics({ dpr: 2 });
    for (const handler of [...harness.queries[0].handlers]) handler();
    // The stale query must be released and a query for the NEW ratio bound,
    // otherwise a second display move (2 -> 3) never fires.
    expect(harness.queries[0].handlers).toHaveLength(0);
    expect(harness.queries.map((q) => q.media)).toEqual([
      '(resolution: 1dppx)',
      '(resolution: 2dppx)',
    ]);

    harness.advanceNow(1000);
    harness.setMetrics({ dpr: 3 });
    for (const handler of [...harness.queries[1].handlers]) handler();
    expect(harness.queries.map((q) => q.media)).toEqual([
      '(resolution: 1dppx)',
      '(resolution: 2dppx)',
      '(resolution: 3dppx)',
    ]);
  } finally {
    session.dispose();
    harness.restore();
  }
});

test('a resize burst coalesces into leading + settled onResize calls', async () => {
  const harness = setupViewportHarness();
  harness.setMetrics({ width: 800, dpr: 1 });
  const onResize = mock();
  const session = createToyViewportSession({ container: null, onResize });
  try {
    // Leading edge applies immediately.
    harness.setMetrics({ width: 810 });
    session.scheduleResize();
    expect(onResize).toHaveBeenCalledTimes(1);

    // A per-frame burst (iOS URL bar, window drag) defers to the settle
    // timer instead of resizing the drawing buffer every tick.
    for (let i = 1; i <= 10; i++) {
      harness.advanceNow(16);
      harness.setMetrics({ width: 810 + i * 10 });
      session.scheduleResize();
    }
    expect(onResize).toHaveBeenCalledTimes(1);

    // After the settle window the timer re-measures and the final size lands.
    harness.advanceNow(300);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onResize.mock.calls[1][0].cssWidth).toBe(910);
  } finally {
    session.dispose();
    harness.restore();
  }
});
