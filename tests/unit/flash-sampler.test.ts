/**
 * The flash sampler's off-thread readback queue.
 *
 * The browser half (that a snapshot holds the frame the draw produced) is
 * tests/e2e/flash-sampler-readback.test.ts. What is checked here is the
 * bookkeeping around the worker, with the worker and the snapshot faked: a
 * readback slower than a frame must delay a sample, not drop the next one,
 * and samples must reach the governor in the order their frames were drawn.
 *
 * Dropping was not harmless. With one capture in flight, every slow readback
 * made the governor compare frames 33ms apart, and on the first-run preset
 * every flash it counted was across a comparison that spanned two frames.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createFlashSampler,
  MAX_CAPTURES_IN_FLIGHT,
} from '../../src/js/core/services/flash-sampler.ts';

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
    const pixels = new Uint8ClampedArray(request.cols * request.rows * 4).fill(
      byte,
    );
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
});
