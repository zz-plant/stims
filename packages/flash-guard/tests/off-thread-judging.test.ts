/**
 * The controller and sampler judging in a worker. The worker here runs the
 * shipped handler; only the thread boundary, the clock and the canvas are
 * faked. What has to hold is that moving the judging changes where the work
 * happens and nothing the viewer sees.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createFields, fillFields } from '../src/fields.ts';
import {
  createFlashController,
  createFlashSampler,
  type FlashSampler,
  MAX_CAPTURES_IN_FLIGHT,
  RECOMMENDED_GRID,
  RECOMMENDED_SAMPLE_DENSITY,
} from '../src/index.ts';
import type { FlashWorkerRequest } from '../src/worker-core.ts';
import { createFlashWorkerHandler } from '../src/worker-core.ts';

const FRAME_MS = 1000 / 60;
const SAMPLES = (RECOMMENDED_GRID * RECOMMENDED_SAMPLE_DENSITY) ** 2;
const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;

let now = 0;
let picture: readonly [number, number, number] = [0, 0, 0];

function pixelsOf([r, g, b]: readonly [number, number, number]) {
  const pixels = new Uint8ClampedArray(SAMPLES * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
  return pixels;
}

/** Runs the real handler, answering a task later as a real worker does. */
class CoreWorker {
  static all: CoreWorker[] = [];
  static throwOnCreate = false;
  posted: FlashWorkerRequest[] = [];
  silent = false;
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  #handle = createFlashWorkerHandler({
    readBitmap: () => pixelsOf(picture),
    reply: (data) => {
      setTimeout(() => {
        if (!this.silent && !this.terminated) this.onmessage?.({ data });
      }, 0);
    },
  });
  constructor() {
    if (CoreWorker.throwOnCreate) throw new Error('blocked');
    CoreWorker.all.push(this);
  }
  postMessage(request: FlashWorkerRequest) {
    this.posted.push(request);
    this.#handle(request);
  }
  terminate() {
    this.terminated = true;
  }
  ofType(type: string) {
    return this.posted.filter((request) => request.type === type);
  }
}

const saved = {
  Worker: globalThis.Worker,
  OffscreenCanvas: globalThis.OffscreenCanvas,
  createImageBitmap: globalThis.createImageBitmap,
};
let clock: ReturnType<typeof spyOn>;

beforeEach(() => {
  now = 0;
  picture = [0, 0, 0];
  CoreWorker.all = [];
  CoreWorker.throwOnCreate = false;
  Object.assign(globalThis, {
    Worker: CoreWorker,
    OffscreenCanvas: class {},
    createImageBitmap: async () => ({ close() {} }),
  });
  clock = spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  clock.mockRestore();
  Object.assign(globalThis, saved);
});

/** Lets snapshots reach the worker and its replies come back, in task order. */
async function settle() {
  for (let task = 0; task < 3; task += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** White and black swapping every few frames: a strobe well over the limit. */
function strobe(frame: number): readonly [number, number, number] {
  return Math.floor(frame / 4) % 2 === 0 ? [255, 255, 255] : [0, 0, 0];
}

/** A sampler answering inside capture, as the main-thread read does. */
function answeringSampler(): FlashSampler {
  const fields = createFields(SAMPLES);
  return {
    cols: RECOMMENDED_GRID,
    rows: RECOMMENDED_GRID,
    density: RECOMMENDED_SAMPLE_DENSITY,
    offThread: false,
    capture: (_canvas, onGrid) => {
      fillFields(fields, pixelsOf(picture));
      onGrid(fields.luminance, fields.red);
      return true;
    },
    dispose() {},
  };
}

async function runStrobe(
  controller: ReturnType<typeof createFlashController>,
  frames: number,
  start = 0,
) {
  for (let frame = start; frame < start + frames; frame += 1) {
    picture = strobe(frame);
    now = frame * FRAME_MS;
    controller.tick(now);
    await settle();
  }
}

describe('a controller judging in the worker', () => {
  test('dims exactly as the same controller judging on the main thread', async () => {
    const remoteScales: number[] = [];
    const remote = createFlashController({
      canvas,
      sampler: createFlashSampler(),
      applyLuminanceScale: (scale) => remoteScales.push(scale),
    });
    await runStrobe(remote, 120);

    const localScales: number[] = [];
    const local = createFlashController({
      canvas,
      sampler: answeringSampler(),
      applyLuminanceScale: (scale) => localScales.push(scale),
    });
    await runStrobe(local, 120);

    expect(CoreWorker.all[0]?.ofType('judge').length).toBeGreaterThan(100);
    expect(localScales.length).toBeGreaterThan(0);
    expect(remoteScales).toEqual(localScales);
    expect(remote.getState()).toEqual(local.getState());
  });

  test('keeps the picture dim when the worker is lost mid-strobe', async () => {
    const scales: number[] = [];
    const controller = createFlashController({
      canvas,
      sampler: createFlashSampler(),
      applyLuminanceScale: (scale) => scales.push(scale),
    });
    await runStrobe(controller, 120);
    const held = controller.getState().hold;
    expect(held).toBeGreaterThan(0);

    (CoreWorker.all[0] as CoreWorker).silent = true;
    picture = [0, 0, 0];
    await runStrobe(controller, 3, 120);
    now += 1500;
    controller.tick(now);
    now += 150;
    controller.tick(now);
    await settle();

    expect(CoreWorker.all[0]?.terminated).toBe(true);
    expect(controller.getState().hold).toBeCloseTo(held, 6);
    expect(scales.at(-1)).toBeLessThan(1);
  });

  test('a worker coming back resumes from the current hold', async () => {
    const controller = createFlashController({
      canvas,
      sampler: createFlashSampler(),
      applyLuminanceScale: () => {},
    });
    await runStrobe(controller, 120);
    const held = controller.getState().hold;
    (CoreWorker.all[0] as CoreWorker).silent = true;
    await runStrobe(controller, 3, 120);
    now += 1500;
    controller.tick(now);
    now += 150;
    controller.tick(now);
    await settle();

    now += 30_000;
    controller.tick(now);
    await settle();

    const next = CoreWorker.all[1] as CoreWorker;
    expect(next.posted[0]?.type).toBe('configure');
    const primes = next.ofType('prime') as Array<{ hold: number }>;
    expect(primes[0]?.hold).toBeCloseTo(held, 6);
    expect(controller.getState().hold).toBeGreaterThan(0);
  });

  test('releasing discards a decision still on its way', async () => {
    const scales: number[] = [];
    const controller = createFlashController({
      canvas,
      sampler: createFlashSampler(),
      applyLuminanceScale: (scale) => scales.push(scale),
    });
    await runStrobe(controller, 120);
    expect(scales.at(-1)).toBeLessThan(1);

    picture = strobe(120);
    now = 120 * FRAME_MS;
    controller.tick(now);
    controller.release();
    await settle();

    expect(scales.at(-1)).toBe(1);
    expect(controller.getState().hold).toBe(0);
    expect(CoreWorker.all[0]?.ofType('reset').length).toBe(1);
  });

  test('a closed gate does not message the worker every frame', async () => {
    let enabled = true;
    const controller = createFlashController({
      canvas,
      sampler: createFlashSampler(),
      applyLuminanceScale: () => {},
      isEnabled: () => enabled,
    });
    await runStrobe(controller, 10);
    enabled = false;
    await runStrobe(controller, 30, 10);
    expect(CoreWorker.all[0]?.ofType('reset').length).toBe(1);
  });

  test('a page that forbids workers still judges on the main thread', () => {
    CoreWorker.throwOnCreate = true;
    const reported: boolean[] = [];
    const sampler = createFlashSampler({
      onOffThreadChange: (offThread) => reported.push(offThread),
    });
    expect(sampler.judging?.active).toBe(false);
    expect(sampler.offThread).toBe(false);
    now = 10 * 60_000;
    expect(sampler.judging?.active).toBe(false);
    expect(reported).toEqual([]);
  });
});

describe('the sampler watching its worker', () => {
  const frame = { nowMs: 0, viewScale: 1 };

  function judged() {
    const reported: boolean[] = [];
    const sampler = createFlashSampler({
      onOffThreadChange: (offThread) => reported.push(offThread),
    });
    const judging = sampler.judging as NonNullable<FlashSampler['judging']>;
    expect(judging.active).toBe(true);
    return { sampler, judging, reported };
  }

  test('posts judged frames in capture order when snapshots resolve out of order', async () => {
    const release: Array<() => void> = [];
    Object.assign(globalThis, {
      createImageBitmap: () =>
        new Promise((resolve) => {
          release.push(() => resolve({ close() {} }));
        }),
    });
    const { judging } = judged();
    const decided: string[] = [];
    judging.capture(canvas, frame, () => decided.push('first'));
    judging.capture(canvas, frame, () => decided.push('second'));
    release[1]?.();
    await settle();
    expect(CoreWorker.all[0]?.ofType('judge')).toHaveLength(0);

    release[0]?.();
    await settle();
    const worker = CoreWorker.all[0] as CoreWorker;
    const ids = (worker.ofType('judge') as Array<{ id: number }>).map(
      (request) => request.id,
    );
    expect(ids).toEqual([0, 1]);
    await settle();
    expect(decided).toEqual(['first', 'second']);
  });

  test('refuses a capture while the queue is full', () => {
    const { judging } = judged();
    for (let i = 0; i < MAX_CAPTURES_IN_FLIGHT; i += 1) {
      expect(judging.capture(canvas, frame, () => {})).toBe(true);
    }
    expect(judging.capture(canvas, frame, () => {})).toBe(false);
  });

  test('a blocked page does not cost it the worker', async () => {
    const { judging } = judged();
    judging.capture(canvas, frame, () => {});
    // The first frame after a long block sees the capture overdue, with the
    // worker's reply still queued behind it.
    now = 1500;
    expect(judging.active).toBe(true);
    await settle();
    now = 1700;
    expect(judging.active).toBe(true);
    expect(CoreWorker.all).toHaveLength(1);
  });

  test('a worker that stays silent is given up on, and reported', async () => {
    const { sampler, judging, reported } = judged();
    const decisions: unknown[] = [];
    (CoreWorker.all[0] as CoreWorker).silent = true;
    judging.capture(canvas, frame, (decision) => decisions.push(decision));
    await settle();
    now = 1100;
    expect(judging.active).toBe(true);
    now = 1250;
    expect(judging.active).toBe(false);
    expect(sampler.offThread).toBe(false);
    expect(decisions).toEqual([null]);
    expect(reported).toEqual([false]);
  });

  test('a worker that errors is retried later, backing off', async () => {
    const { judging, reported } = judged();
    (CoreWorker.all[0] as CoreWorker).onerror?.();
    expect(judging.active).toBe(false);

    now = 29_000;
    expect(judging.active).toBe(false);
    now = 30_000;
    expect(judging.active).toBe(true);
    expect(CoreWorker.all).toHaveLength(2);
    expect(CoreWorker.all[1]?.posted[0]?.type).toBe('configure');
    expect(reported).toEqual([false, true]);

    // It failed again soon after: the wait doubles.
    now = 31_000;
    (CoreWorker.all[1] as CoreWorker).onerror?.();
    now = 61_000;
    expect(judging.active).toBe(false);
    now = 91_000;
    expect(judging.active).toBe(true);
  });

  test('a worker that served a while starts the backoff over', () => {
    const { judging } = judged();
    (CoreWorker.all[0] as CoreWorker).onerror?.();
    now = 30_000;
    expect(judging.active).toBe(true);
    now = 100_000;
    (CoreWorker.all[1] as CoreWorker).onerror?.();
    now = 130_000;
    expect(judging.active).toBe(true);
  });
});
