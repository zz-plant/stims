/**
 * The Stims side of the flash governor: `core/services/flash-safety.ts`.
 *
 * The controller itself (sampler, governor, the loop between them) is the
 * `flash-guard` package and is tested there (packages/flash-guard/tests).
 * What this adapter adds is the gate: it follows the visitor's Reduce
 * flashing preference by default, and turning that preference off must give
 * the stage back at once rather than on the next strobe.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type FlashSampler, RECOMMENDED_GRID } from 'flash-guard';
import {
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import { createFlashSafetyController } from '../../src/js/core/services/flash-safety.ts';

const FRAME_MS = 1000 / 60;

/** A full-field 10Hz strobe, answered inside capture() as the main-thread read does. */
function strobeSampler(): FlashSampler {
  const field = new Float32Array(RECOMMENDED_GRID * RECOMMENDED_GRID);
  let frame = 0;
  return {
    cols: RECOMMENDED_GRID,
    rows: RECOMMENDED_GRID,
    density: 1,
    offThread: false,
    capture: (_canvas, onGrid) => {
      field.fill(Math.floor(frame / 3) % 2 === 1 ? 0.95 : 0.02);
      frame += 1;
      onGrid(field);
      return true;
    },
    dispose: () => {},
  };
}

function strobedController() {
  const applied: number[] = [];
  const controller = createFlashSafetyController({
    canvas: {} as HTMLCanvasElement,
    sampler: strobeSampler(),
    applyLuminanceScale: (scale) => applied.push(scale),
    subscribeToFrames: () => () => {},
  });
  const run = (frames: number) => {
    for (let i = 0; i < frames; i += 1) controller.tick(i * FRAME_MS);
  };
  return { controller, applied, run };
}

beforeEach(() => {
  resetAccessibilityPreferenceState();
});

afterEach(() => {
  resetAccessibilityPreferenceState();
});

describe('flash safety adapter', () => {
  test('dims a strobe while Reduce flashing is on', () => {
    setAccessibilityPreference({ reduceFlashing: true });
    const { controller, applied, run } = strobedController();
    run(120);
    expect(Math.min(...applied)).toBeLessThan(1);
    expect(controller.getState().engaged).toBe(true);
    controller.stop();
  });

  test('leaves the stage alone while Reduce flashing is off', () => {
    setAccessibilityPreference({ reduceFlashing: false });
    const { controller, applied, run } = strobedController();
    run(120);
    expect(applied).toEqual([]);
    expect(controller.getState().engaged).toBe(false);
    controller.stop();
  });

  test('turning Reduce flashing off gives the stage back at once', () => {
    setAccessibilityPreference({ reduceFlashing: true });
    const { controller, applied, run } = strobedController();
    run(120);
    expect(controller.getState().engaged).toBe(true);

    // No further frame is drawn: the release must come from the preference
    // change itself, not from the next tick noticing the gate is shut.
    setAccessibilityPreference({ reduceFlashing: false });
    expect(applied.at(-1)).toBe(1);
    expect(controller.getState().engaged).toBe(false);
    controller.stop();
  });

  test('stop() stops listening to the preference', () => {
    setAccessibilityPreference({ reduceFlashing: true });
    const { controller, applied, run } = strobedController();
    run(120);
    controller.stop();
    const appliedAtStop = applied.length;
    setAccessibilityPreference({ reduceFlashing: false });
    setAccessibilityPreference({ reduceFlashing: true });
    expect(applied.length).toBe(appliedAtStop);
  });
});
