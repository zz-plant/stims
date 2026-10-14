/**
 * The flash sampler's off-thread readback queue.
 *
 * What is checked here is the bookkeeping around the worker, with the worker
 * and the snapshot faked: a
 * readback slower than a frame must delay a sample, not drop the next one,
 * and samples must reach the governor in the order their frames were drawn.
 *
 * Dropping was not harmless. With one capture in flight, every slow readback
 * made the governor compare frames 33ms apart, and on a busy MilkDrop preset
 * every flash it counted was across a comparison that spanned two frames.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createFlashSampler,
  type FlashRedField,
  isSaturatedRed,
  MAX_CAPTURES_IN_FLIGHT,
  redFlashValue,
  relativeLuminance,
} from '../src/index.ts';

type Request = { id: number; cols: number; rows: number };

class FakeWorker {
  static current: FakeWorker | null = null;
  requests: Request[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWorker.current = this;
  }
  postMessage(request: Request) {
    this.requests.push(request);
  }
  terminate() {}
  /** Answers a request with a uniform field of the given sRGB byte. */
  answer(request: Request, byte: number) {
    this.answerRgb(request, [byte, byte, byte]);
  }
  /** Answers a request with a uniform field of one opaque colour. */
  answerRgb(request: Request, [r, g, b]: readonly [number, number, number]) {
    const pixels = new Uint8ClampedArray(request.cols * request.rows * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
    this.onmessage?.({ data: { id: request.id, pixels } });
  }
}

const saved = {
  Worker: globalThis.Worker,
  OffscreenCanvas: globalThis.OffscreenCanvas,
  createImageBitmap: globalThis.createImageBitmap,
};

beforeEach(() => {
  FakeWorker.current = null;
  Object.assign(globalThis, {
    Worker: FakeWorker,
    OffscreenCanvas: class {},
    createImageBitmap: async () => ({ close() {} }),
  });
});

afterEach(() => {
  Object.assign(globalThis, saved);
});

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;

/** Lets the faked snapshots resolve and reach the worker. */
const settleSnapshots = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('flash sampler readback queue', () => {
  test('a readback slower than a frame delays the next sample instead of dropping it', async () => {
    const sampler = createFlashSampler();
    const received: number[] = [];
    const onGrid = (field: Float32Array | null) => {
      if (field) received.push(field[0] as number);
    };

    expect(sampler.capture(canvas, onGrid)).toBe(true);
    // The next frame is drawn before the first readback comes back.
    expect(sampler.capture(canvas, onGrid)).toBe(true);
    await settleSnapshots();

    const worker = FakeWorker.current as FakeWorker;
    expect(worker.requests).toHaveLength(2);
    worker.answer(worker.requests[0] as Request, 255);
    worker.answer(worker.requests[1] as Request, 0);
    expect(received).toEqual([1, 0]);
    sampler.dispose();
  });

  test('samples arrive in the order their frames were drawn', async () => {
    const sampler = createFlashSampler();
    const order: string[] = [];
    sampler.capture(canvas, () => order.push('first'));
    sampler.capture(canvas, () => order.push('second'));
    await settleSnapshots();

    const worker = FakeWorker.current as FakeWorker;
    // The worker answers the later frame first.
    worker.answer(worker.requests[1] as Request, 0);
    expect(order).toEqual([]);
    worker.answer(worker.requests[0] as Request, 0);
    expect(order).toEqual(['first', 'second']);
    sampler.dispose();
  });

  test('a stalled worker is not queued without bound', async () => {
    const sampler = createFlashSampler();
    for (let i = 0; i < MAX_CAPTURES_IN_FLIGHT; i += 1) {
      expect(sampler.capture(canvas, () => {})).toBe(true);
    }
    expect(sampler.capture(canvas, () => {})).toBe(false);
    await settleSnapshots();

    const worker = FakeWorker.current as FakeWorker;
    worker.answer(worker.requests[0] as Request, 0);
    expect(sampler.capture(canvas, () => {})).toBe(true);
    sampler.dispose();
  });

  test('the red-flash field is read from the same pixels as the luminance', async () => {
    const sampler = createFlashSampler();
    const seen: Array<{ luminance: number; value: number; saturated: number }> =
      [];
    const onGrid = (field: Float32Array | null, red?: FlashRedField) => {
      if (!field || !red) return;
      // Every sample of a uniform answer is the same; the last one proves
      // the whole field was filled, not just its first entry.
      const last = field.length - 1;
      seen.push({
        luminance: field[last] as number,
        value: red.values[last] as number,
        saturated: red.saturated[last] as number,
      });
    };
    sampler.capture(canvas, onGrid);
    sampler.capture(canvas, onGrid);
    await settleSnapshots();

    const worker = FakeWorker.current as FakeWorker;
    worker.answerRgb(worker.requests[0] as Request, [80, 0, 0]);
    worker.answerRgb(worker.requests[1] as Request, [120, 60, 60]);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.luminance).toBeCloseTo(relativeLuminance(80, 0, 0), 6);
    expect(seen[0]?.value).toBeCloseTo(redFlashValue(80, 0, 0), 4);
    expect(seen[0]?.saturated).toBe(1);
    // A reddish grey has a red-flash value but is not a saturated red.
    expect(isSaturatedRed(120, 60, 60)).toBe(false);
    expect(seen[1]?.value).toBeCloseTo(redFlashValue(120, 60, 60), 4);
    expect(seen[1]?.saturated).toBe(0);
    sampler.dispose();
  });
});
