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
import {
  createFlashSafetyController,
  createStageCompositedScale,
} from '../../src/js/core/services/flash-safety.ts';
import { notePresetShown } from '../../src/js/core/services/preset-telemetry.ts';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../src/js/core/services/stage-luminance.ts';
import { resetTelemetryContextForTests } from '../../src/js/core/services/telemetry-context.ts';

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
  test('tells dwell telemetry its gate and where it reads pixels', async () => {
    const beacons: string[] = [];
    const originalLocation = Object.getOwnPropertyDescriptor(
      globalThis,
      'location',
    );
    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      'navigator',
    );
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'toil.fyi', origin: 'https://toil.fyi' },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        sendBeacon: (_url: string, blob: Blob) => {
          void blob.text().then((text) => beacons.push(text));
          return true;
        },
      },
    });
    try {
      setAccessibilityPreference({ reduceFlashing: true });
      strobedController();
      notePresetShown('guarded', 'webgl');
      notePresetShown('unguarded', 'webgl');
      setAccessibilityPreference({ reduceFlashing: false });
      notePresetShown('after', 'webgl');
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const [guarded, unguarded] = beacons.map((text) => JSON.parse(text));
      expect(guarded).toMatchObject({
        flashGuard: 'on',
        flashSampler: 'main',
      });
      expect(unguarded.flashGuard).toBe('off');
    } finally {
      if (originalLocation) {
        Object.defineProperty(globalThis, 'location', originalLocation);
      } else {
        delete (globalThis as { location?: unknown }).location;
      }
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      }
    }
  });

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

  test('the governor feedback excludes the comfort ceiling', () => {
    // A recording carries the governor and the blackout but not the ceiling,
    // so the governor must decide against that same content: a swing the
    // ceiling made sub-threshold would otherwise read as already mitigated
    // and pass through undimmed into the file.
    const stage = document.createElement('div');
    setStageLuminanceChannel(stage, 'ceiling', 0.3);
    setStageLuminanceChannel(stage, 'governor', 0.5);
    setStageLuminanceChannel(stage, 'presentation', 0.25);

    const composited = createStageCompositedScale(stage);
    // governor × presentation, no ceiling.
    expect(composited()).toBeCloseTo(0.5 * 0.25, 5);

    resetStageLuminance(stage);
  });
});

describe('the sampler giving up on its worker', () => {
  class ErroringWorker {
    static current: ErroringWorker | null = null;
    onmessage: unknown = null;
    onerror: (() => void) | null = null;
    constructor() {
      ErroringWorker.current = this;
    }
    postMessage() {}
    terminate() {}
  }

  const saved = {
    Worker: globalThis.Worker,
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  let beacons: Promise<string>[] = [];

  beforeEach(() => {
    beacons = [];
    resetTelemetryContextForTests();
    Object.assign(globalThis, {
      Worker: ErroringWorker,
      OffscreenCanvas: class {},
      createImageBitmap: async () => ({ close() {} }),
    });
    // Local hosts never post; production's does.
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'toil.fyi', origin: 'https://toil.fyi' },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        sendBeacon: (_url: string, blob: Blob) => {
          beacons.push(blob.text());
          return true;
        },
      },
    });
  });

  afterEach(() => {
    Object.assign(globalThis, {
      Worker: saved.Worker,
      OffscreenCanvas: saved.OffscreenCanvas,
      createImageBitmap: saved.createImageBitmap,
    });
    for (const key of ['location', 'navigator'] as const) {
      const descriptor = saved[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    resetTelemetryContextForTests();
  });

  test('reports the move to the main thread, once', async () => {
    const controller = createFlashSafetyController({
      canvas: { width: 640, height: 360 } as HTMLCanvasElement,
      applyLuminanceScale: () => {},
      isEnabled: () => true,
      subscribeToFrames: () => () => {},
    });
    controller.tick(0);
    ErroringWorker.current?.onerror?.();
    ErroringWorker.current?.onerror?.();

    const events = (await Promise.all(beacons)).map(
      (text) => JSON.parse(text).event,
    );
    expect(events).toEqual(['substitution-flash-sampler-main-thread']);
    controller.stop();
  });
});
