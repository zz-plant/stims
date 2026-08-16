import { describe, expect, test } from 'bun:test';
import { createContinuousDrsController } from '../../src/js/core/services/continuous-drs.ts';

describe('createContinuousDrsController', () => {
  test('initializes with target budget and default max scale', () => {
    const drs = createContinuousDrsController({
      targetFrameBudgetMs: 16.67,
      minScale: 0.65,
      maxScale: 1.0,
    });

    const state = drs.getState();
    expect(state.scale).toBe(1.0);
    expect(state.targetBudgetMs).toBe(16.67);
    expect(state.isStable).toBe(true);
  });

  test('stays steady when frame times land inside deadband ratio', () => {
    const drs = createContinuousDrsController({
      targetFrameBudgetMs: 16.67,
      deadbandRatio: 0.05, // ±5%
    });

    // 16.5ms is well inside deadband around 16.67ms
    for (let i = 0; i < 20; i++) {
      const scale = drs.update(16.5);
      expect(scale).toBe(1.0);
    }
    expect(drs.getState().isStable).toBe(true);
  });

  test('smoothly scales down under sustained load and recovers when load drops', () => {
    const drs = createContinuousDrsController({
      targetFrameBudgetMs: 16.67,
      minScale: 0.65,
      maxScale: 1.0,
      kp: 0.08,
      ki: 0.01,
      kd: 0.02,
    });

    // Sustained over-budget load (24ms)
    for (let i = 0; i < 40; i++) {
      drs.update(24.0);
    }

    const scaledDown = drs.getState().scale;
    expect(scaledDown).toBeLessThan(1.0);
    expect(scaledDown).toBeGreaterThanOrEqual(0.65);

    // Light workload arrives (10ms)
    for (let i = 0; i < 60; i++) {
      drs.update(10.0);
    }

    const recovered = drs.getState().scale;
    expect(recovered).toBeGreaterThan(scaledDown);
    expect(recovered).toBeCloseTo(1.0, 1);
  });

  test('reset restores initial scale and clears integral', () => {
    const drs = createContinuousDrsController({
      targetFrameBudgetMs: 16.67,
    });

    for (let i = 0; i < 30; i++) {
      drs.update(25.0);
    }
    expect(drs.getState().scale).toBeLessThan(1.0);

    drs.reset(1.0);
    expect(drs.getState().scale).toBe(1.0);
    expect(drs.getState().integral).toBe(0);
  });
});
