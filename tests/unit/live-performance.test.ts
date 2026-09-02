import { describe, expect, test } from 'bun:test';
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
 * Drive `requestAnimationFrame` and `performance.now` off a virtual clock.
 *
 * `ramp` derives its progress from wall-clock elapsed time, so controlling
 * frames alone is not enough — the clock has to advance with them or every
 * frame reports progress 0. Each frame advances the clock by `stepMs`, which
 * makes the sampled progress values exact and independent of how loaded the
 * machine running the suite happens to be.
 *
 * The ramp's watchdog still runs on real timers, and still wins if this driver
 * is never pumped.
 */
function driveFrames({ stepMs }: { stepMs: number }) {
  const realRaf = globalThis.requestAnimationFrame;
  const realNow = performance.now;
  let clock = 0;

  performance.now = () => clock;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    setTimeout(() => {
      clock += stepMs;
      cb(clock);
    }, 0);
    return 0;
  }) as typeof realRaf;

  return {
    now: () => clock,
    restore: () => {
      globalThis.requestAnimationFrame = realRaf;
      performance.now = realNow;
    },
  };
}

describe('live performance runtime', () => {
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
    // Frames and the clock are both driven here rather than taken from the
    // machine. Left to the real scheduler this asserted that a 2-core CI
    // runner delivers a rAF callback inside 120ms, which it does not always:
    // when the first frame lands after the window has already closed the ramp
    // legitimately snaps to its endpoint, no intermediate value is ever
    // applied, and the test fails for a reason that is about the runner
    // rather than the code. The sibling watchdog test below already stubs rAF
    // for the same reason.
    const { now, restore } = driveFrames({ stepMs: 30 });

    try {
      const { applied, live, uninstall } = harness();

      const result = await live.ramp({
        targets: { warp: 3 },
        durationMs: 120,
        curve: 'linear',
        from: { warp: 1 },
      });

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
      expect(now()).toBeGreaterThan(0);

      uninstall();
    } finally {
      restore();
    }
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
    const { restore } = driveFrames({ stepMs: 500 });

    try {
      const { applied, live, uninstall } = harness();

      const result = await live.ramp({
        targets: { warp: 3 },
        durationMs: 120,
        curve: 'linear',
        from: { warp: 1 },
      });

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
    } finally {
      restore();
    }
  });

  test('ramp moves multiple targets as one gesture', async () => {
    const { applied, live, uninstall } = harness();

    const result = await live.ramp({
      targets: { warp: 2, zoom: 1.1 },
      durationMs: 80,
      from: { warp: 1, zoom: 1 },
    });

    expect(result.targets.sort()).toEqual(['warp', 'zoom']);
    expect(applied.some(([target]) => target === 'warp')).toBe(true);
    expect(applied.some(([target]) => target === 'zoom')).toBe(true);
    expect(result.final).toEqual({ warp: 2, zoom: 1.1 });

    uninstall();
  });

  test('a new ramp supersedes one still in flight on the same target', async () => {
    const { applied, live, uninstall } = harness();

    const slow = live.ramp({
      targets: { warp: 100 },
      durationMs: 3000,
      from: { warp: 0 },
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await live.ramp({
      targets: { warp: 5 },
      durationMs: 60,
      from: { warp: 0 },
    });

    const afterOverride = applied.length;
    await new Promise((resolve) => setTimeout(resolve, 120));

    // The superseded ramp must stop driving the target rather than fighting
    // the new gesture frame by frame.
    const strayWrites = applied
      .slice(afterOverride)
      .filter(([, value]) => value > 5);
    expect(strayWrites).toEqual([]);

    await slow;
    uninstall();
  });

  test('setControl seeds the position a later ramp starts from', async () => {
    const { applied, live, uninstall } = harness();

    live.setControl('decay', 0.9);
    await live.ramp({ targets: { decay: 0.98 }, durationMs: 60 });

    const values = applied.map(([, value]) => value);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.9);
    expect(values.at(-1)).toBe(0.98);
    expect(live.getPositions().decay).toBe(0.98);

    uninstall();
  });

  test('ramping an untouched target sets it without inventing an origin', async () => {
    const { applied, live, uninstall } = harness();

    await live.ramp({ targets: { rot: 0.42 }, durationMs: 40 });

    expect(applied.every(([, value]) => value === 0.42)).toBe(true);

    uninstall();
  });

  test('the watchdog lands the value when rAF never fires', async () => {
    // The Browser pane reports document.hidden even when visible, which
    // suspends rAF. Without the watchdog a ramp would hang forever and leave
    // the instrument stuck mid-travel with no error.
    const realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof realRaf;

    try {
      const { applied, live, uninstall } = harness();

      const result = await live.ramp({
        targets: { warp: 4 },
        durationMs: 50,
        from: { warp: 1 },
      });

      expect(result.landing).toBe('watchdog');
      expect(result.forcedLanding).toBe(true);
      expect(result.final.warp).toBe(4);
      expect(applied.at(-1)).toEqual(['warp', 4]);

      uninstall();
    } finally {
      globalThis.requestAnimationFrame = realRaf;
    }
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
    const result = await live.runMacro('build');

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
    const fast = await live.runMacro('slow', { speed: 8 });

    expect(fast.elapsedMs).toBeLessThan(300);

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
    const recalled = await live.recallScene('look', { durationMs: 60 });

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

    const result = await live.listen({ durationMs: 150, intervalMs: 50 });

    // Mislabelling a frozen snapshot as a measurement is the exact failure
    // this field exists to prevent.
    expect(result.source).toBe('telemetry');
    expect(result.samples.length).toBeGreaterThan(0);

    uninstall();
  });
});
