/**
 * The flash-safety controller: the plumbing between sampler, governor, and
 * the thing that dims the picture.
 *
 * The WCAG decision itself is proven in flash-governor.test.ts. What has to
 * be established here is that the loop around it is honest — in particular
 * that it CLOSES. The mitigation lands at composite time, so a naive
 * implementation reads back unmitigated pixels, never observes its own
 * effect, and escalates to the ceiling forever. The convergence test below
 * exists to catch exactly that.
 */
import { describe, expect, test } from 'bun:test';
import {
  createFlashController,
  type FlashSampler,
  RECOMMENDED_GRID,
} from '../src/index.ts';

const GRID = RECOMMENDED_GRID;
const FRAME_MS = 1000 / 60;

/** A sampler driven by a caller-supplied luminance, no DOM involved. */
function scriptedSampler(
  getLuminance: (frame: number) => number,
): FlashSampler & {
  advance: () => void;
} {
  const tiles = new Float32Array(GRID * GRID);
  let frame = 0;
  return {
    cols: GRID,
    rows: GRID,
    density: 1,
    offThread: false,
    capture: (_canvas, onGrid) => {
      tiles.fill(getLuminance(frame));
      frame += 1;
      onGrid(tiles);
      return true;
    },
    dispose: () => {},
    advance: () => {
      frame += 1;
    },
  };
}

/** A sampler that answers inside capture(), as the main-thread read does. */
function answering(read: () => Float32Array | null): FlashSampler {
  return {
    cols: GRID,
    rows: GRID,
    density: 1,
    offThread: false,
    capture: (_canvas, onGrid) => {
      onGrid(read());
      return true;
    },
    dispose: () => {},
  };
}

/**
 * A sampler that answers later, as the off-thread read does: one capture in
 * flight at a time, settled by the test.
 */
function deferred() {
  let waiting: ((tiles: Float32Array | null) => void) | null = null;
  let captures = 0;
  const sampler: FlashSampler = {
    cols: GRID,
    rows: GRID,
    density: 1,
    offThread: true,
    capture: (_canvas, onGrid) => {
      if (waiting) return false;
      captures += 1;
      waiting = onGrid;
      return true;
    },
    dispose: () => {},
  };
  return {
    sampler,
    captures: () => captures,
    pending: () => waiting !== null,
    settle: (luminance: number) => {
      const onGrid = waiting;
      waiting = null;
      onGrid?.(new Float32Array(GRID * GRID).fill(luminance));
    },
  };
}

function harness(getLuminance: (frame: number) => number, enabled = true) {
  const applied: number[] = [];
  const controller = createFlashController({
    canvas: {} as HTMLCanvasElement,
    sampler: scriptedSampler(getLuminance),
    isEnabled: () => enabled,
    applyLuminanceScale: (scale) => applied.push(scale),
    subscribeToFrames: () => () => {},
  });
  return { controller, applied };
}

const strobe = (frame: number) =>
  Math.floor(frame / 3) % 2 === 1 ? 0.95 : 0.02;

describe('flash safety controller', () => {
  test('engages on a strobe and dims the stage', () => {
    const { controller, applied } = harness(strobe);
    for (let i = 0; i < 120; i += 1) controller.tick(i * FRAME_MS);
    expect(applied.length).toBeGreaterThan(0);
    expect(Math.min(...applied)).toBeLessThan(1);
    expect(controller.getState().engaged).toBe(true);
  });

  test('the closed loop converges instead of escalating to the ceiling', () => {
    // With the sample scaled by the mitigation in force, the observed swing
    // shrinks until it stops qualifying, so the governor should settle well
    // short of its hard ceiling rather than pinning there.
    const { controller } = harness(strobe);
    for (let i = 0; i < 600; i += 1) controller.tick(i * FRAME_MS);
    const { hold } = controller.getState();
    expect(hold).toBeLessThan(0.97);
    expect(hold).toBeGreaterThan(0);
  });

  test('the feedback correction reads the whole filter, not just the governor', () => {
    // The governor reconstructs what the viewer sees by scaling its sample by
    // the mitigation in force. Once the visitor's brightness ceiling shares
    // that same CSS filter, "in force" means the composed value: a ceiling of
    // 0.5 has already halved the strobe before it reaches anyone's eyes.
    //
    // Correcting by the governor's own channel alone overstates what the
    // viewer sees, so it keeps counting flashes that are already suppressed
    // and clamps harder than the content warrants.
    const uncorrected = harness(strobe);
    // Mirrors stage-luminance's composition: the governor's own channel times
    // the visitor's ceiling. Reporting a bare constant here would be wrong in
    // a way worth naming — it drops the governor's own contribution, and the
    // loop that converges only because it can see its own effect would
    // escalate straight to the ceiling instead.
    let governorChannel = 1;
    const composed = createFlashController({
      canvas: {} as HTMLCanvasElement,
      sampler: scriptedSampler(strobe),
      isEnabled: () => true,
      applyLuminanceScale: (scale) => {
        governorChannel = scale;
      },
      compositedScale: () => governorChannel * 0.25,
      subscribeToFrames: () => () => {},
    });

    for (let i = 0; i < 600; i += 1) {
      uncorrected.controller.tick(i * FRAME_MS);
      composed.tick(i * FRAME_MS);
    }

    // Same content, but the viewer is already seeing a quarter of it, so the
    // governor should hold back further than the uncorrected loop does.
    expect(composed.getState().hold).toBeLessThan(
      uncorrected.controller.getState().hold,
    );
    composed.stop();
  });

  test('does nothing at all when the preference is off', () => {
    const { controller, applied } = harness(strobe, false);
    for (let i = 0; i < 120; i += 1) controller.tick(i * FRAME_MS);
    expect(applied).toEqual([]);
    expect(controller.getState().engaged).toBe(false);
  });

  test('calm content never dims the stage', () => {
    const { controller, applied } = harness(() => 0.5);
    for (let i = 0; i < 120; i += 1) controller.tick(i * FRAME_MS);
    expect(applied).toEqual([]);
  });

  test('only touches the DOM when the value actually moves', () => {
    const { controller, applied } = harness(strobe);
    for (let i = 0; i < 300; i += 1) controller.tick(i * FRAME_MS);
    // Sixty applies a second for an unchanged value would be the bug; the
    // count should be far below the number of frames observed.
    expect(applied.length).toBeLessThan(150);
  });

  test('stop() releases the dimming', () => {
    const { controller, applied } = harness(strobe);
    for (let i = 0; i < 120; i += 1) controller.tick(i * FRAME_MS);
    controller.stop();
    expect(applied[applied.length - 1]).toBe(1);
    expect(controller.getState().engaged).toBe(false);
  });

  test('a null sample is not treated as a calm frame', () => {
    let returnNull = false;
    const applied: number[] = [];
    const tiles = new Float32Array(GRID * GRID);
    const controller = createFlashController({
      canvas: {} as HTMLCanvasElement,
      sampler: answering(() => {
        if (returnNull) return null;
        tiles.fill(0.5);
        return tiles;
      }),
      isEnabled: () => true,
      applyLuminanceScale: (scale) => applied.push(scale),
      subscribeToFrames: () => () => {},
    });
    controller.tick(0);
    returnNull = true;
    expect(controller.tick(FRAME_MS)).toBeNull();
    expect(applied).toEqual([]);
  });

  test('samples once per drawn frame, from the render loop', () => {
    // Its own animation-frame loop read the canvas outside the draw: a
    // WebGPU canvas came back transparent and a WebGL one dimmed, so the
    // governor never saw what was on screen.
    const listeners = new Set<(now: number) => void>();
    let samples = 0;
    const controller = createFlashController({
      canvas: {} as HTMLCanvasElement,
      sampler: answering(() => {
        samples += 1;
        return new Float32Array(GRID * GRID);
      }),
      isEnabled: () => true,
      applyLuminanceScale: () => {},
      subscribeToFrames: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    controller.start();
    for (const listener of listeners) listener(0);
    for (const listener of listeners) listener(FRAME_MS);
    expect(samples).toBe(2);
    controller.stop();
    expect(listeners.size).toBe(0);
    expect(controller.isRunning()).toBe(false);
  });

  test('compares frames a 60Hz frame apart, whatever the display rate', () => {
    // On a 120Hz display, content that changes every frame alternates at
    // 60Hz, above flicker fusion. Compared frame to frame it reads as a
    // flash every frame; compared 16.7ms apart it reads as what it is.
    const HZ120 = 1000 / 120;
    const timed = (luminanceAt: (frame120: number) => number) => {
      let frame120 = 0;
      const tiles = new Float32Array(GRID * GRID);
      const controller = createFlashController({
        canvas: {} as HTMLCanvasElement,
        sampler: answering(() => tiles.fill(luminanceAt(frame120))),
        isEnabled: () => true,
        applyLuminanceScale: () => {},
        subscribeToFrames: () => () => {},
      });
      for (frame120 = 0; frame120 < 240; frame120 += 1) {
        controller.tick(frame120 * HZ120);
      }
      return controller.getState().engaged;
    };
    // Bright on even 120Hz frames, dark on odd: a 60Hz alternation.
    expect(timed((f) => (f % 2 === 0 ? 0.9 : 0.05))).toBe(false);
    // A 5Hz strobe on the same display: 12 frames on, 12 off.
    expect(timed((f) => (Math.floor(f / 12) % 2 === 1 ? 0.95 : 0.02))).toBe(
      true,
    );
  });

  test("the governor's own dimming is not mistaken for the content darkening", () => {
    // Content holds at 0.6, the governor clamps to 0.3 (primed, as it is for
    // content already measured), then the content brightens to 0.95.
    // On screen that is one step down, which the governor made, and one
    // step up, which the content made: no flash. Judging both frames at the
    // scale each was shown at read the clamp itself as a qualifying
    // darkening across the whole frame, paired it with the content's rise,
    // and counted a flash the content never made.
    const { controller } = harness((frame) => (frame < 30 ? 0.6 : 0.95));
    let flashes = 0;
    for (let i = 0; i < 60; i += 1) {
      if (i === 10) controller.prime(0.7);
      if (controller.tick(i * FRAME_MS)?.flashed) flashes += 1;
    }
    expect(controller.getState().luminanceScale).toBeCloseTo(0.3, 5);
    expect(flashes).toBe(0);
    expect(controller.getState().flashesInWindow).toBe(0);
  });

  test('a 60Hz display with jittery frame times is compared every frame', () => {
    // Frame timestamps wander around 16.7ms. Skipping the one that lands at
    // 15.5ms makes the next comparison span two frames, doubling the motion
    // it judges: content moving 0.06 a frame, under the 0.1 threshold, then
    // reads as 0.12 swings.
    let frame = 0;
    const tiles = new Float32Array(GRID * GRID);
    let sampled = 0;
    const controller = createFlashController({
      canvas: {} as HTMLCanvasElement,
      sampler: answering(() => {
        sampled += 1;
        // A field that rises then falls 0.06 a frame, in alternating
        // three-frame runs: never a flash at 60Hz.
        return tiles.fill(0.3 + 0.06 * Math.min(frame % 6, 6 - (frame % 6)));
      }),
      isEnabled: () => true,
      applyLuminanceScale: () => {},
      subscribeToFrames: () => () => {},
    });
    let now = 0;
    for (frame = 0; frame < 240; frame += 1) {
      controller.tick(now);
      now += frame % 2 === 0 ? 17.9 : 15.5;
    }
    expect(sampled).toBe(240);
    expect(controller.getState().flashesInWindow).toBe(0);
    expect(controller.getState().engaged).toBe(false);
  });

  describe('with a grid that arrives after the frame', () => {
    function deferredHarness() {
      let enabled = true;
      const applied: number[] = [];
      const source = deferred();
      const controller = createFlashController({
        canvas: {} as HTMLCanvasElement,
        sampler: source.sampler,
        isEnabled: () => enabled,
        applyLuminanceScale: (scale) => applied.push(scale),
        subscribeToFrames: () => () => {},
      });
      return {
        controller,
        applied,
        source,
        setEnabled: (next: boolean) => {
          enabled = next;
        },
      };
    }

    test('still engages on a strobe', () => {
      const { controller, applied, source } = deferredHarness();
      for (let i = 0; i < 120; i += 1) {
        expect(controller.tick(i * FRAME_MS)).toBeNull();
        source.settle(strobe(i));
      }
      expect(Math.min(...applied)).toBeLessThan(1);
      expect(controller.getState().engaged).toBe(true);
    });

    test('a frame drawn while the last grid is still out tries again next frame', () => {
      const { controller, source } = deferredHarness();
      controller.tick(0);
      // Still being read: refused, and not counted as this cadence's sample.
      controller.tick(FRAME_MS);
      expect(source.captures()).toBe(1);
      source.settle(0.5);
      // One display frame later, not a whole cadence later.
      controller.tick(FRAME_MS + 1);
      expect(source.captures()).toBe(2);
    });

    test('a grid still out when Reduce flashing goes off is dropped', () => {
      // Turned off and on again, the governor starts clean; the grid taken
      // before that must not count toward a flash after it.
      const run = (dropStale: boolean) => {
        const { controller, source, setEnabled } = deferredHarness();
        controller.tick(0); // bright frame captured, still being read
        setEnabled(false);
        controller.tick(FRAME_MS);
        setEnabled(true);
        if (dropStale) source.settle(0.95);
        else {
          // Control: the same bright frame captured after the reset.
          source.settle(0.95);
          controller.tick(2 * FRAME_MS);
          source.settle(0.95);
        }
        controller.tick(3 * FRAME_MS);
        source.settle(0.02);
        controller.tick(4 * FRAME_MS);
        source.settle(0.95);
        return controller.getState().flashesInWindow;
      };
      // bright, dark, bright is one flash when every sample counts...
      expect(run(false)).toBe(1);
      // ...and none when the bright one predates the reset.
      expect(run(true)).toBe(0);
    });
  });
});
