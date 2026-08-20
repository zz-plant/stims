import { describe, expect, test } from 'bun:test';
import { createSimulationAccumulator } from '../../src/js/core/simulation-accumulator.ts';

describe('createSimulationAccumulator', () => {
  test('ticks fixed delta increments deterministically', () => {
    const accumulator = createSimulationAccumulator({ targetHz: 60 });
    expect(accumulator.fixedDtSec).toBeCloseTo(1 / 60, 6);

    let tickCount = 0;
    let totalSimulatedSec = 0;

    // Simulate 10 frames at 30fps (each frame is ~0.0333s = 2 simulation ticks)
    for (let i = 0; i < 10; i++) {
      accumulator.advance(1 / 30, (dt) => {
        tickCount++;
        totalSimulatedSec += dt;
      });
    }

    expect(tickCount).toBe(20);
    expect(totalSimulatedSec).toBeCloseTo(10 * (1 / 30), 4);
  });

  test('calculates accurate sub-frame interpolation alpha', () => {
    const accumulator = createSimulationAccumulator({ targetHz: 60 });
    // Advance half of a 60Hz step (1/120s = 0.00833s)
    const alpha = accumulator.advance(1 / 120, () => {});
    expect(alpha).toBeCloseTo(0.5, 4);
  });

  test('clamps max sub-steps to prevent spiral of death on long lag pauses', () => {
    const accumulator = createSimulationAccumulator({
      targetHz: 60,
      maxSubSteps: 5,
    });

    let tickCount = 0;
    // Simulate a huge 2.0s stall (which would normally be 120 ticks)
    accumulator.advance(2.0, () => {
      tickCount++;
    });

    // Should be clamped to maxSubSteps = 5
    expect(tickCount).toBe(5);
  });

  test('reset clears accumulated time', () => {
    const accumulator = createSimulationAccumulator({ targetHz: 60 });
    accumulator.advance(1 / 120, () => {});
    accumulator.reset();
    const alpha = accumulator.advance(0, () => {});
    expect(alpha).toBe(0);
  });
});
