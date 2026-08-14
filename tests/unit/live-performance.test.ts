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
    const { applied, live, uninstall } = harness();

    const result = await live.ramp({
      targets: { warp: 3 },
      durationMs: 120,
      curve: 'linear',
      from: { warp: 1 },
    });

    expect(result.final.warp).toBe(3);
    expect(applied.at(-1)).toEqual(['warp', 3]);

    // The point of a ramp: values between the endpoints, not just the endpoint.
    const midway = applied.filter(
      ([, value]) => value > 1.0001 && value < 2.9999,
    );
    expect(midway.length).toBeGreaterThan(0);

    const values = applied.map(([, value]) => value);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...values)).toBeLessThanOrEqual(3);

    uninstall();
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
