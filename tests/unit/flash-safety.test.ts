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
import { RECOMMENDED_GRID } from '../../src/js/core/services/flash-governor.ts';
import { createFlashSafetyController } from '../../src/js/core/services/flash-safety.ts';
import type { FlashSampler } from '../../src/js/core/services/flash-sampler.ts';

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
    sample: () => {
      tiles.fill(getLuminance(frame));
      frame += 1;
      return tiles;
    },
    dispose: () => {},
    advance: () => {
      frame += 1;
    },
  };
}

function harness(getLuminance: (frame: number) => number, enabled = true) {
  const applied: number[] = [];
  const controller = createFlashSafetyController({
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
    const composed = createFlashSafetyController({
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
    const controller = createFlashSafetyController({
      canvas: {} as HTMLCanvasElement,
      sampler: {
        cols: GRID,
        rows: GRID,
        sample: () => {
          if (returnNull) return null;
          tiles.fill(0.5);
          return tiles;
        },
        dispose: () => {},
      },
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
    const controller = createFlashSafetyController({
      canvas: {} as HTMLCanvasElement,
      sampler: {
        cols: GRID,
        rows: GRID,
        sample: () => {
          samples += 1;
          return new Float32Array(GRID * GRID);
        },
        dispose: () => {},
      },
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
      const controller = createFlashSafetyController({
        canvas: {} as HTMLCanvasElement,
        sampler: {
          cols: GRID,
          rows: GRID,
          sample: () => tiles.fill(luminanceAt(frame120)),
          dispose: () => {},
        },
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
});
