import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  bind,
  getModulationHealth,
  installModulation,
  listModulators,
  type ModulationDeps,
  unbind,
  unbindAll,
} from '../../src/js/frontend/live-modulation.ts';
import { installAnimationFrameController } from '../environment/animation-frame.ts';

function rig(centres: Record<string, number> = {}) {
  const applied: Array<[string, number]> = [];
  const positions = new Map(Object.entries(centres));
  const deps: ModulationDeps = {
    setTarget: (target, value) => {
      applied.push([target, value]);
    },
    getCenter: (target) => positions.get(target),
    getCps: () => 0.5,
  };
  return { applied, positions, uninstall: installModulation(deps) };
}

const settle = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  // The modulation loop is frame-locked on the shared animation-frame
  // controller. A prior file in the same process can leave that singleton's
  // auto-advance timer in a stale state, starving the loop; a fresh install
  // gives every test its own clean frame queue and rAF globals.
  installAnimationFrameController();
});

afterEach(() => {
  unbindAll();
});

describe('modulation engine', () => {
  test('an LFO swings the target around its centre', async () => {
    const { applied, uninstall } = rig({ warp: 2 });
    bind({ target: 'warp', depth: 1, source: { kind: 'lfo', hz: 8 } });

    await settle();

    expect(applied.length).toBeGreaterThan(2);
    const values = applied.map(([, value]) => value);
    // Centre 2, depth 1 — everything must land inside the excursion, and the
    // target must actually move rather than sit at the centre.
    expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...values)).toBeLessThanOrEqual(3);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.05);

    uninstall();
  });

  test('modulators never write back into the position map', async () => {
    const { positions, uninstall } = rig({ warp: 2 });
    bind({ target: 'warp', depth: 1, source: { kind: 'lfo', hz: 8 } });

    await settle();

    // The centre is the ramp's territory. If modulation fed back into it the
    // resting value would drift away on its own.
    expect(positions.get('warp')).toBe(2);

    uninstall();
  });

  test('a ramped centre moves the whole modulated range with it', async () => {
    const { applied, positions, uninstall } = rig({ warp: 2 });
    bind({ target: 'warp', depth: 0.5, source: { kind: 'lfo', hz: 8 } });

    await settle();
    const before = applied.length;
    positions.set('warp', 10);
    await settle();

    const after = applied.slice(before).map(([, value]) => value);
    expect(after.length).toBeGreaterThan(0);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(9.5);
    expect(Math.max(...after)).toBeLessThanOrEqual(10.5);

    uninstall();
  });

  test('modulators sharing a target sum their offsets', async () => {
    const { applied, uninstall } = rig({ warp: 0 });
    bind({
      target: 'warp',
      depth: 1,
      source: { kind: 'lfo', shape: 'square' },
    });
    bind({
      target: 'warp',
      depth: 1,
      source: { kind: 'lfo', shape: 'square' },
    });

    await settle();

    expect(listModulators()).toHaveLength(2);
    // Two square LFOs at depth 1 reach ±2 together; one alone could not.
    const peak = Math.max(...applied.map(([, value]) => Math.abs(value)));
    expect(peak).toBeGreaterThan(1.5);

    uninstall();
  });

  test('min and max clamp the modulated result', async () => {
    const { applied, uninstall } = rig({ zoom: 1 });
    bind({
      target: 'zoom',
      depth: 5,
      min: 0.9,
      max: 1.1,
      source: { kind: 'lfo', hz: 8 },
    });

    await settle();

    for (const [, value] of applied) {
      expect(value).toBeGreaterThanOrEqual(0.9);
      expect(value).toBeLessThanOrEqual(1.1);
    }

    uninstall();
  });

  test('unbinding hands the target back to its centre', async () => {
    const { applied, uninstall } = rig({ warp: 2 });
    bind({ target: 'warp', depth: 1, source: { kind: 'lfo', hz: 8 } });
    await settle();

    const removed = unbind({ target: 'warp' });

    expect(removed).toHaveLength(1);
    // A stuck offset looks exactly like a broken preset, so the last write
    // must be the resting value.
    expect(applied.at(-1)).toEqual(['warp', 2]);
    expect(listModulators()).toHaveLength(0);

    uninstall();
  });

  test('an audio modulator with no signal contributes nothing', async () => {
    const { applied, uninstall } = rig({ warp: 2 });
    bind({ target: 'warp', depth: 1, source: { kind: 'audio', band: 'bass' } });

    await settle();

    // Silence must read as "no offset", not as an invented value.
    expect(applied.length).toBeGreaterThan(0);
    for (const [, value] of applied) expect(value).toBeCloseTo(2, 5);

    uninstall();
  });

  test('modulators survive a reinstall', async () => {
    // Regression: the workspace effect re-runs whenever the engine identity
    // changes (which happens while a preset loads). Clearing on teardown
    // silently deleted anything bound during startup after the tool had
    // already reported success.
    const first = rig({ warp: 2 });
    bind({ target: 'warp', depth: 1, source: { kind: 'lfo', hz: 8 } });
    expect(listModulators()).toHaveLength(1);

    first.uninstall();
    const second = rig({ warp: 2 });

    expect(listModulators()).toHaveLength(1);
    await settle();
    expect(second.applied.length).toBeGreaterThan(0);

    second.uninstall();
  });

  test('health reports a stalled loop when frames stop', async () => {
    const realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof realRaf;

    try {
      const { uninstall } = rig({ warp: 2 });
      bind({ target: 'warp', depth: 1, source: { kind: 'lfo', hz: 8 } });

      await new Promise((resolve) => setTimeout(resolve, 550));

      const health = getModulationHealth();
      expect(health.count).toBe(1);
      // Scheduled but never ticking — the case an agent would otherwise read
      // as "active" while nothing moves.
      expect(health.stalled).toBe(true);

      uninstall();
    } finally {
      globalThis.requestAnimationFrame = realRaf;
    }
  });
});
