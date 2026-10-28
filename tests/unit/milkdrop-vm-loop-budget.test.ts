/**
 * Every program call in a frame shares one loop budget (vm.ts,
 * FRAME_LOOP_ITERATION_BUDGET). Per-pixel code runs once per mesh vertex, so
 * before the budget a `while(1)` there ran the per-call cap at every vertex:
 * the first step below took more than ten seconds and the test timed out.
 */
import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

const FRAME_BUDGET = 2_097_152;

describe('frame loop budget', () => {
  test('a runaway per-pixel loop spends one budget per frame, not one per vertex', () => {
    // megabuf is VM-wide, so it sums the iterations of every vertex; per_frame
    // runs before per_pixel and reads back the previous frame's total.
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Runaway per-pixel loop
per_frame_1=q1=megabuf(0);
per_pixel_1=while(1, megabuf(0) = megabuf(0) + 1;);
per_pixel_2=zoom=zoom+0;
      `.trim(),
      { id: 'runaway-per-pixel-loop' },
    );
    const vm = createMilkdropVM(preset);
    const tracker = createMilkdropSignalTracker();
    const step = (frame: number) =>
      vm.step(
        tracker.update({
          time: frame / 60,
          deltaMs: 1000 / 60,
          analyser: null,
          frequencyData: new Uint8Array(64),
          waveformData: new Uint8Array(64),
        }),
      );

    step(1);
    expect(step(2).variables.q1).toBe(FRAME_BUDGET);
    // Refilled when the next step starts.
    expect(step(3).variables.q1).toBe(2 * FRAME_BUDGET);
  });
});
