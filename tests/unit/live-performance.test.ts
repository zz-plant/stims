import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import {
  installLivePerformance,
  type LivePerformanceApi,
  type LivePerformanceDeps,
} from '../../src/js/frontend/live-performance.ts';

function harness(overrides: Partial<LivePerformanceDeps> = {}) {
  const applied: Array<[string, number]> = [];
  const deps: LivePerformanceDeps = {
    setTarget: (target, value) => {
      applied.push([target, value]);
    },
    injectMidiCC: () => {},
    nextPreset: () => {},
    previousPreset: () => {},
    startStreamAudio: async () => {},
    ...overrides,
  };
  const uninstall = installLivePerformance(deps);
  const live = window.__stims_live as LivePerformanceApi;
  return { applied, live, uninstall };
}

/**
 * Advance the virtual timeline until `pending` settles.
 *
 * Fires one timer at a time and drains microtasks in between, so a macro's
 * next step is scheduled before time moves past it. Fails instead of hanging
 * when the promise outlives every timer that could settle it.
 */
async function settle<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  pending.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let turn = 0; !done; turn += 1) {
    if (turn === 10_000) {
      throw new Error('settle: promise still pending after 10000 turns');
    }
    await Promise.resolve();
    if (!done && jest.getTimerCount() > 0) jest.advanceTimersToNextTimer();
  }
  return pending;
}

describe('live performance runtime', () => {
  /**
   * Frames, the clock and the ramp's watchdog all run on one virtual timeline.
   *
   * `ramp` steps on rAF, reads its progress from `performance.now`, and arms a
   * `window.setTimeout` watchdog for `durationMs + 120`; whichever of the last
   * frame and the watchdog comes first decides `landing`. Bun's fake timers
   * cover `performance.now` and the global `setTimeout` that happy-dom's
   * `window.setTimeout` delegates to, so delivering each frame as a fake timer
   * `frameMs` later puts all three on one clock. The race is then decided by
   * virtual deadlines, not by how busy the machine running the suite is.
   *
   * Frames used to be real zero-delay timers racing a real watchdog: at load
   * average ~157, a 300ms ramp's ten frame hops took longer than its 420ms
   * watchdog and a healthy glide reported `landing: 'watchdog'`.
   *
   * Time moves only when a test moves it: `settle` for anything awaited,
   * `jest.advanceTimersByTime` to stop part-way.
   */
  let frameMs: number | null = 30;
  let realRaf: typeof requestAnimationFrame;

  beforeEach(() => {
    frameMs = 30;
    realRaf = globalThis.requestAnimationFrame;
    jest.useFakeTimers();
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      // null models a hidden tab, where rAF never fires.
      if (frameMs !== null) {
        setTimeout(() => callback(performance.now()), frameMs);
      }
      return 0;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    jest.useRealTimers();
  });

  test('installs the performance API on window and tears down cleanly', () => {
    const { live, uninstall } = harness();

    expect(typeof live.ramp).toBe('function');
    expect(typeof live.playPattern).toBe('function');
    expect(typeof live.listen).toBe('function');

    uninstall();
    expect(window.__stims_live).toBeUndefined();
  });

  test('a later install survives an earlier teardown', () => {
    // Guards the HMR/remount ordering trap: React runs the new effect before
    // the old cleanup, so an unconditional teardown would unpublish its own
    // successor and leave the page with no runtime.
    const first = harness();
    const second = harness();

    first.uninstall();

    expect(window.__stims_live).toBeDefined();
    second.uninstall();
  });

  test('ramp glides through intermediate values and lands exactly', async () => {
    // Left to the real scheduler this asserted that a 2-core CI runner
    // delivers a rAF callback inside 120ms, which it does not always: when the
    // first frame lands after the window has already closed the ramp
    // legitimately snaps to its endpoint, no intermediate value is ever
    // applied, and the test fails for a reason that is about the runner
    // rather than the code. The virtual timeline delivers a frame every 30ms.
    const { applied, live, uninstall } = harness();

    const result = await settle(
      live.ramp({
        targets: { warp: 3 },
        durationMs: 120,
        curve: 'linear',
        from: { warp: 1 },
      }),
    );

    expect(result.final.warp).toBe(3);
    expect(applied.at(-1)).toEqual(['warp', 3]);
    // Frames arrived inside the window, so this was a real glide.
    expect(result.landing).toBe('glided');
    expect(result.forcedLanding).toBe(false);

    // The point of a ramp: values between the endpoints, not just the
    // endpoint. At 30ms steps over 120ms that is progress .25/.5/.75.
    const midway = applied.filter(
      ([, value]) => value > 1.0001 && value < 2.9999,
    );
    expect(midway.length).toBeGreaterThan(0);

    const values = applied.map(([, value]) => value);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...values)).toBeLessThanOrEqual(3);

    uninstall();
  });

  test('a zero-duration ramp is an instant set, not a failed glide', async () => {
    // The third way to arrive without gliding, and the one that is not a
    // fault: durationMs 0 asks for an immediate set. Reporting it as a forced
    // landing would cry wolf on every deliberate snap.
    const { applied, live, uninstall } = harness();

    const result = await live.ramp({
      targets: { warp: 2 },
      durationMs: 0,
      from: { warp: 1 },
    });

    expect(result.landing).toBe('instant');
    expect(result.forcedLanding).toBe(false);
    expect(result.final.warp).toBe(2);
    expect(applied.at(-1)).toEqual(['warp', 2]);

    uninstall();
  });

  test('a ramp starved of frames reports that it did not glide', async () => {
    // The other side of the contract above, and the case that used to be
    // silent: when the first frame arrives after the whole duration has
    // elapsed there is nothing left to travel, so the ramp snaps to its
    // destination. It still lands exactly — but it did not glide, and saying
    // otherwise would tell a caller the gesture was smooth when it was a
    // teleport.
    //
    // The first frame comes at 200ms: after the 120ms window has closed, but
    // before the watchdog at 240ms. A frame later than the watchdog would
    // lose to it, so this is the only gap a starved landing can come from.
    frameMs = 200;
    const { applied, live, uninstall } = harness();

    const result = await settle(
      live.ramp({
        targets: { warp: 3 },
        durationMs: 120,
        curve: 'linear',
        from: { warp: 1 },
      }),
    );

    expect(result.final.warp).toBe(3);
    expect(applied.at(-1)).toEqual(['warp', 3]);
    // 'starved', not 'watchdog': the frame loop did run, it was just too
    // late to travel. The watchdog never fired, and saying it did would
    // point a reader at a hidden tab that was not the problem.
    expect(result.landing).toBe('starved');
    expect(result.forcedLanding).toBe(true);
    expect(
      applied.filter(([, value]) => value > 1.0001 && value < 2.9999),
    ).toHaveLength(0);

    uninstall();
  });

  test('ramp moves multiple targets as one gesture', async () => {
    const { applied, live, uninstall } = harness();

    const result = await settle(
      live.ramp({
        targets: { warp: 2, zoom: 1.1 },
        durationMs: 80,
        from: { warp: 1, zoom: 1 },
      }),
    );

    expect(result.targets.sort()).toEqual(['warp', 'zoom']);
    expect(applied.some(([target]) => target === 'warp')).toBe(true);
    expect(applied.some(([target]) => target === 'zoom')).toBe(true);
    expect(result.final).toEqual({ warp: 2, zoom: 1.1 });

    uninstall();
  });

  test('a new ramp takes over a target in flight, and the old one settles at once', async () => {
    const { applied, live, uninstall } = harness();

    // Every value the slow ramp writes is >= 50 and every value the new one
    // writes is <= 5, so a stray write from the slow ramp is visible.
    const slow = live.ramp({
      targets: { warp: 100 },
      durationMs: 3000,
      from: { warp: 50 },
    });
    // Two frames of travel before the takeover.
    jest.advanceTimersByTime(60);
    const takeover = applied.length;
    const takeoverAt = performance.now();
    const fast = live.ramp({
      targets: { warp: 5 },
      durationMs: 60,
      from: { warp: 0 },
    });

    const result = await settle(slow);
    expect(result).toMatchObject({
      landing: 'superseded',
      forcedLanding: false,
      superseded: ['warp'],
    });
    // It never reached 100, so it does not claim to have landed there.
    expect(result.final).toEqual({});
    // Settled when the new ramp started, not when its own 3000ms ran out.
    expect(performance.now()).toBe(takeoverAt);

    await settle(fast);
    // The superseded ramp stopped driving the target rather than fighting
    // the new gesture frame by frame.
    expect(applied.slice(takeover).filter(([, value]) => value > 5)).toEqual(
      [],
    );
    expect(applied.at(-1)).toEqual(['warp', 5]);

    uninstall();
  });

  test('a ramp that loses one target lands the rest and lists the one it lost', async () => {
    const { live, uninstall } = harness();

    const both = live.ramp({
      targets: { warp: 2, zoom: 1.5 },
      durationMs: 300,
      from: { warp: 1, zoom: 1 },
    });
    // One frame of travel before the takeover.
    jest.advanceTimersByTime(30);
    await live.ramp({ targets: { warp: 4 }, durationMs: 0 });

    const result = await settle(both);
    expect(result.landing).toBe('glided');
    expect(result.final).toEqual({ zoom: 1.5 });
    expect(result.superseded).toEqual(['warp']);
    expect(live.getPositions()).toMatchObject({ warp: 4, zoom: 1.5 });

    uninstall();
  });

  test('a superseded ramp settles even when frames never arrive', async () => {
    // A hidden tab never runs rAF, so noticing the takeover on the next frame
    // would leave the old ramp waiting for its watchdog.
    frameMs = null;
    const { live, uninstall } = harness();

    const stalled = live.ramp({
      targets: { warp: 100 },
      durationMs: 1000,
      from: { warp: 50 },
    });
    await live.ramp({ targets: { warp: 5 }, durationMs: 0 });

    expect(await settle(stalled)).toMatchObject({
      landing: 'superseded',
      superseded: ['warp'],
    });

    uninstall();
  });

  test('setControl seeds the position a later ramp starts from', async () => {
    const { applied, live, uninstall } = harness();

    live.setControl('decay', 0.9);
    await settle(live.ramp({ targets: { decay: 0.98 }, durationMs: 60 }));

    const values = applied.map(([, value]) => value);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.9);
    expect(values.at(-1)).toBe(0.98);
    expect(live.getPositions().decay).toBe(0.98);

    uninstall();
  });

  test('ramping an untouched target sets it without inventing an origin', async () => {
    const { applied, live, uninstall } = harness();

    await settle(live.ramp({ targets: { rot: 0.42 }, durationMs: 40 }));

    expect(applied.every(([, value]) => value === 0.42)).toBe(true);

    uninstall();
  });

  test('the watchdog lands the value when rAF never fires', async () => {
    // The Browser pane reports document.hidden even when visible, which
    // suspends rAF. Without the watchdog a ramp would hang forever and leave
    // the instrument stuck mid-travel with no error.
    frameMs = null;
    const { applied, live, uninstall } = harness();

    const result = await settle(
      live.ramp({
        targets: { warp: 4 },
        durationMs: 50,
        from: { warp: 1 },
      }),
    );

    expect(result.landing).toBe('watchdog');
    expect(result.forcedLanding).toBe(true);
    expect(result.final.warp).toBe(4);
    expect(applied.at(-1)).toEqual(['warp', 4]);

    uninstall();
  });

  test('a macro runs its steps in order and awaits ramps', async () => {
    const { applied, live, uninstall } = harness();

    live.defineMacro({
      name: 'build',
      steps: [
        { set: { decay: 0.9 } },
        { ramp: { targets: { decay: 0.98 }, durationMs: 60 } },
        { set: { warp: 3 } },
      ],
    });
    const result = await settle(live.runMacro('build'));

    expect(result.stepsRun).toBe(3);
    // Order matters: a macro is a timeline, so the final set must land last
    // rather than racing the ramp it follows.
    expect(applied.at(-1)).toEqual(['warp', 3]);
    expect(live.getPositions().decay).toBe(0.98);

    live.deleteMacro('build');
    uninstall();
  });

  test('macro speed scales its durations', async () => {
    const { live, uninstall } = harness();

    live.defineMacro({
      name: 'slow',
      steps: [{ ramp: { targets: { warp: 2 }, durationMs: 400 } }],
    });
    const fast = await settle(live.runMacro('slow', { speed: 8 }));

    // Virtual milliseconds, so this is exact rather than a bet on the host:
    // unscaled, the ramp alone would take 400.
    expect(fast.elapsedMs).toBeLessThan(400);

    live.deleteMacro('slow');
    uninstall();
  });

  test('running an unknown macro names the ones that exist', async () => {
    const { live, uninstall } = harness();

    await expect(live.runMacro('nope')).rejects.toThrow(
      /No macro named "nope"/,
    );

    uninstall();
  });

  test('a scene captures positions and restores them on recall', async () => {
    const { live, uninstall } = harness();

    live.setControl('warp', 2.5);
    live.setControl('decay', 0.97);
    const saved = live.saveScene('look', 'test');
    expect(saved.positions.warp).toBe(2.5);

    live.setControl('warp', 0.1);
    const recalled = await settle(live.recallScene('look', { durationMs: 60 }));

    // A scene snapshots every target the runtime has driven, not just the
    // two set here, so assert containment rather than an exact set.
    expect(recalled.targets).toContain('warp');
    expect(recalled.targets).toContain('decay');
    expect(live.getPositions().warp).toBe(2.5);

    live.deleteScene('look');
    uninstall();
  });

  test('scenes and macros persist across a reinstall', async () => {
    const first = harness();
    first.live.setControl('warp', 4);
    first.live.saveScene('kept');
    first.live.defineMacro({ name: 'kept-macro', steps: [{ waitMs: 1 }] });
    first.uninstall();

    const second = harness();

    // The performer's own vocabulary should outlive a remount.
    expect(second.live.listScenes().map((s) => s.name)).toContain('kept');
    expect(second.live.listMacros().map((m) => m.name)).toContain('kept-macro');

    second.live.deleteScene('kept');
    second.live.deleteMacro('kept-macro');
    second.uninstall();
  });

  test('listen reports telemetry as its source when no stream is attached', async () => {
    const { live, uninstall } = harness();
    live.attachStream(null);

    const result = await settle(
      live.listen({ durationMs: 150, intervalMs: 50 }),
    );

    // Mislabelling a frozen snapshot as a measurement is the exact failure
    // this field exists to prevent.
    expect(result.source).toBe('telemetry');
    expect(result.samples.length).toBeGreaterThan(0);

    uninstall();
  });
});
