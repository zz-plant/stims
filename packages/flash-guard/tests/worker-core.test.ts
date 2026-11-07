/**
 * The flash worker's protocol, run without a browser: `readBitmap` stands in
 * for OffscreenCanvas and everything else is the shipped handler.
 */
import { describe, expect, test } from 'bun:test';
import { createFields, fillFields } from '../src/fields.ts';
import {
  createFlashGovernor,
  type FlashGovernorDecision,
} from '../src/governor.ts';
import {
  createFlashWorkerHandler,
  type FlashWorkerReply,
} from '../src/worker-core.ts';

const GRID = 4;
const DENSITY = 2;
const SAMPLES = GRID * DENSITY * (GRID * DENSITY);

/** A uniform frame of one sRGB colour, as a readback would return it. */
function frame([r, g, b]: readonly [number, number, number]) {
  const pixels = new Uint8ClampedArray(SAMPLES * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
  return pixels;
}

function harness() {
  const replies: FlashWorkerReply[] = [];
  let next: Uint8ClampedArray | null = frame([0, 0, 0]);
  const handle = createFlashWorkerHandler({
    readBitmap: () => next,
    reply: (message) => replies.push(message),
  });
  const bitmap = { close() {} } as unknown as ImageBitmap;
  return {
    handle,
    replies,
    setFrame(pixels: Uint8ClampedArray | null) {
      next = pixels;
    },
    configure(generation = 0) {
      handle({
        type: 'configure',
        cols: GRID,
        rows: GRID,
        density: DENSITY,
        generation,
      });
    },
    judge(id: number, nowMs: number, viewScale = 1, generation = 0) {
      handle({ type: 'judge', id, bitmap, nowMs, viewScale, generation });
      const reply = replies.at(-1) as { decision: FlashGovernorDecision };
      return reply.decision;
    },
  };
}

/** A strobe that alternates white, black and saturated red. */
function strobeColour(i: number): readonly [number, number, number] {
  const phase = i % 8;
  if (phase < 3) return [255, 255, 255];
  if (phase < 6) return [0, 0, 0];
  return [200, 0, 0];
}

describe('judging in the worker', () => {
  test('makes the same decisions as the governor on the main thread', () => {
    const worker = harness();
    worker.configure();
    const local = createFlashGovernor();
    const fields = createFields(SAMPLES);
    let viewScale = 1;
    let engaged = false;

    for (let i = 0; i < 240; i += 1) {
      const pixels = frame(strobeColour(i));
      const nowMs = i * (1000 / 60);
      worker.setFrame(pixels);
      const remote = worker.judge(i, nowMs, viewScale);
      fillFields(fields, pixels);
      const direct = local.sample(nowMs, fields.luminance, GRID, GRID, {
        density: DENSITY,
        viewScale,
        red: fields.red,
      });
      expect(remote).toEqual(direct);
      engaged ||= direct.engaged;
      viewScale = direct.luminanceScale;
    }
    // A sequence that never engaged would prove nothing about the clamp.
    expect(engaged).toBe(true);
  });

  test('a frame from before a reset is not judged', () => {
    const worker = harness();
    worker.configure();
    worker.handle({ type: 'reset', generation: 1 });
    expect(worker.judge(0, 0, 1, 0)).toBeNull();
    expect(worker.judge(1, 17, 1, 1)).not.toBeNull();
  });

  test('a frame it cannot read gets a null decision, not a calm one', () => {
    const worker = harness();
    worker.configure();
    worker.setFrame(null);
    expect(worker.judge(0, 0)).toBeNull();
  });

  test('priming carries the hold into the first decision', () => {
    const worker = harness();
    worker.configure();
    worker.handle({ type: 'prime', hold: 0.4 });
    expect(worker.judge(0, 0).hold).toBeCloseTo(0.4, 6);
  });

  test('a capture before configuration closes its bitmap', () => {
    let closed = 0;
    const replies: FlashWorkerReply[] = [];
    const handle = createFlashWorkerHandler({
      readBitmap: () => null,
      reply: (message) => replies.push(message),
    });
    handle({
      type: 'judge',
      id: 7,
      bitmap: {
        close: () => {
          closed += 1;
        },
      } as unknown as ImageBitmap,
      nowMs: 0,
      viewScale: 1,
      generation: 0,
    });
    expect(closed).toBe(1);
    expect(replies).toEqual([{ id: 7, decision: null }]);
  });

  test('a plain readback still returns the pixels', () => {
    const worker = harness();
    const pixels = frame([9, 9, 9]);
    worker.setFrame(pixels);
    worker.handle({
      id: 3,
      bitmap: { close() {} } as unknown as ImageBitmap,
      cols: GRID * DENSITY,
      rows: GRID * DENSITY,
    });
    expect(worker.replies).toEqual([{ id: 3, pixels }]);
  });
});
