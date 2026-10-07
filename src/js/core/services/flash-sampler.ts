/**
 * Per-frame luminance sampling for the flash governor.
 *
 * `visual-embedding.ts` already downsamples a canvas for its frame stats, but
 * that path runs on demand (agent captures, preset switches) and computes a
 * histogram, edge density, and motion estimate. The governor needs one thing,
 * every frame, as cheaply as possible: a small field of WCAG relative
 * luminance. Sharing the embedding path would mean paying for three
 * statistics to use none of them.
 *
 * The tile grid is RECOMMENDED_GRID square rather than the canvas aspect. The
 * visual-field window is defined as a fraction of each axis, so a square grid
 * keeps the window square in tile space no matter how wide the canvas is; the
 * alternative is a window that stops approximating 10 degrees on ultrawide
 * displays.
 *
 * Each tile is read as RECOMMENDED_SAMPLE_DENSITY squared single pixels, not
 * as one value: the downscale is nearest neighbour to a 128x128 field, so
 * every sample is one pixel of the frame, the same pixel every frame, which
 * is how the offline audit samples too. The governor thresholds each one
 * before counting area; `RECOMMENDED_SAMPLE_DENSITY` has why a single value
 * per tile made the first-run preset read as a strobe.
 *
 * Cost is the reason this is worth reading carefully, and the reason it was
 * measured rather than assumed — the compute-VM benchmark (d3e47f70) is the
 * cautionary tale for a per-frame GPU->CPU round trip nobody timed.
 *
 * `bun run lab:flash-sampler-bench` once put this at 10us per sample (16x16,
 * 1217x760). That bench runs in agent mode and the sampler then read on its
 * own animation frame, after the frame had been presented: on WebGPU it
 * read transparent pixels and on WebGL a copy the browser already held, so
 * neither waited for the GPU. Reading the frame that is actually on screen
 * means reading inside the draw (see `core/frame-drawn.ts`), and that read
 * waits for the GPU to finish the frame. Measured 2026-10-06, M1 Max,
 * 1280x720, headless Chromium:
 *
 *     backend   median   p95
 *     WebGPU    1.8ms    2.3ms
 *     WebGL     2.9ms    3.9ms
 *
 * A GPU-backed scratch canvas (`willReadFrequently: false`) moved WebGPU to
 * 1.6ms: the cost is the wait, not the bytes. Sampling less often is not the
 * answer either, because at 15Hz a 30Hz strobe aliases away.
 *
 * So the wait moves off the main thread. `createImageBitmap` snapshots the
 * canvas synchronously, inside the draw, already downscaled to the grid; the
 * bitmap goes to a worker (`flash-readback.worker.ts`) whose readback does
 * the waiting. Per sample at the 16x16 grid, same machine, two sessions
 * (`bun run lab:flash-sampler-bench` prints the comparison):
 *
 *     backend   main thread before   main thread now   grid arrives after
 *     WebGPU    1.9-2.3ms            0.1ms             2.1-2.3ms
 *     WebGL     2.7-3.6ms            0.1ms             2.8-3.2ms
 *
 * The snapshot's grid matched the same-task synchronous read exactly (max
 * difference 0 over 12 frames on each backend), so the governor sees the
 * same numbers a frame or so later. Where the off-thread pieces are missing
 * the synchronous read is used, as before.
 *
 * Reading the 128x128 field rather than a 16x16 grid moved none of that:
 * re-measured 2026-10-07, the capture still costs 0.1ms of main thread and
 * the field arrives 3.0-3.5ms later on either backend, as it does at 16x16
 * on the same (heavily loaded) machine. What the larger field adds is work
 * when it arrives: converting 16k pixels to luminance (about 0.1ms) and
 * judging them (`governor.sample`: 0.09ms mean on a still frame, 0.24ms on
 * busy texture, 0.49ms on a strobe that solves a clamp every flash). Load
 * average was near 40 for every one of those numbers, so they are ceilings.
 */
import { linearizeChannel } from '../flash-thresholds.ts';
import {
  RECOMMENDED_GRID,
  RECOMMENDED_SAMPLE_DENSITY,
} from './flash-governor.ts';

/** Receives a captured frame's luminance field, or null if it could not be read. */
export type FlashGridCallback = (tiles: Float32Array | null) => void;

export type FlashSampler = {
  /**
   * Snapshots the canvas now, so call it inside the draw (see
   * `core/frame-drawn.ts`), and hands its luminance grid to `onGrid`, either
   * before returning or once a worker has read it. Returns false, capturing
   * nothing, while the previous capture is still being read. The grid is
   * reused by the next capture: read it in the callback.
   */
  capture: (canvas: HTMLCanvasElement, onGrid: FlashGridCallback) => boolean;
  /** Tiles across and down. */
  readonly cols: number;
  readonly rows: number;
  /**
   * Samples along each tile edge: the grid handed to `onGrid` is
   * `cols * density` by `rows * density` (see `FlashSampleOptions`).
   */
  readonly density: number;
  /** Whether captures are read off the main thread right now. */
  readonly offThread: boolean;
  dispose: () => void;
};

/**
 * A capture the worker never answers within this long is abandoned and the
 * sampler falls back to reading on the main thread: a governor waiting
 * forever on a lost message would be blind without saying so.
 */
const READBACK_TIMEOUT_MS = 1000;

/**
 * sRGB byte -> linear light, tabulated: a 128x128 field is 49k channel
 * conversions a frame, and `linearizeChannel` is a pow() each.
 */
const LINEAR = Float32Array.from({ length: 256 }, (_, byte) =>
  linearizeChannel(byte),
);

function fillLuminance(target: Float32Array, pixels: Uint8ClampedArray) {
  for (let i = 0; i < target.length; i += 1) {
    const idx = i * 4;
    target[i] =
      0.2126 * (LINEAR[pixels[idx] as number] as number) +
      0.7152 * (LINEAR[pixels[idx + 1] as number] as number) +
      0.0722 * (LINEAR[pixels[idx + 2] as number] as number);
  }
  return target;
}

/**
 * Reads the canvas on the calling thread and waits for the GPU to finish
 * the frame. The fallback, and what the off-thread path is measured against.
 */
export function createMainThreadFlashReader(
  grid: number = RECOMMENDED_GRID,
  density: number = RECOMMENDED_SAMPLE_DENSITY,
) {
  const cols = Math.max(1, Math.floor(grid));
  const rows = cols;
  const samplesPerEdge = Math.max(1, Math.floor(density));
  const width = cols * samplesPerEdge;
  const height = rows * samplesPerEdge;
  const luminance = new Float32Array(width * height);

  let scratch: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;

  function ensureContext(): CanvasRenderingContext2D | null {
    if (context) return context;
    if (typeof document === 'undefined') return null;
    scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    // willReadFrequently keeps the surface CPU-side, which is what makes the
    // repeated getImageData cheap rather than a fresh map every frame.
    context = scratch.getContext('2d', { willReadFrequently: true });
    // Nearest neighbour: each sample is one pixel, as in the offline audit,
    // and the same pixel every frame. Smoothing would blend a browser-chosen
    // neighbourhood, which is neither a pixel nor a tile mean.
    if (context) context.imageSmoothingEnabled = false;
    return context;
  }

  function read(canvas: HTMLCanvasElement): Float32Array | null {
    const sourceWidth = canvas.width;
    const sourceHeight = canvas.height;
    if (sourceWidth <= 0 || sourceHeight <= 0) return null;

    const ctx = ensureContext();
    if (!ctx) return null;

    let pixels: Uint8ClampedArray;
    try {
      ctx.drawImage(
        canvas,
        0,
        0,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height,
      );
      pixels = ctx.getImageData(0, 0, width, height).data;
    } catch {
      // A tainted or zero-sized canvas throws; a governor that cannot see
      // must not guess, so the caller treats null as "no sample this frame"
      // rather than as a calm frame.
      return null;
    }
    return fillLuminance(luminance, pixels);
  }

  function dispose() {
    context = null;
    if (scratch) {
      scratch.width = 0;
      scratch.height = 0;
      scratch = null;
    }
  }

  return {
    read,
    cols,
    rows,
    density: samplesPerEdge,
    width,
    height,
    dispose,
  };
}

function canReadOffThread() {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

export function createFlashSampler(
  grid: number = RECOMMENDED_GRID,
  density: number = RECOMMENDED_SAMPLE_DENSITY,
): FlashSampler {
  const mainThread = createMainThreadFlashReader(grid, density);
  const { cols, rows, width, height } = mainThread;
  const luminance = new Float32Array(width * height);

  let offThread = canReadOffThread();
  let worker: Worker | null = null;
  let pending: FlashGridCallback | null = null;
  let pendingSince = 0;
  let disposed = false;

  function settle(pixels: Uint8ClampedArray | null) {
    const onGrid = pending;
    pending = null;
    if (!onGrid || disposed) return;
    onGrid(pixels ? fillLuminance(luminance, pixels) : null);
  }

  function abandonOffThread() {
    offThread = false;
    worker?.terminate();
    worker = null;
    settle(null);
  }

  function ensureWorker(): Worker | null {
    if (worker) return worker;
    try {
      worker = new Worker(
        new URL('./flash-readback.worker.ts', import.meta.url),
        { type: 'module', name: 'stims-flash-readback' },
      );
    } catch {
      return null;
    }
    worker.onmessage = (event: MessageEvent<Uint8ClampedArray | null>) => {
      settle(event.data);
    };
    worker.onerror = () => abandonOffThread();
    return worker;
  }

  function capture(
    canvas: HTMLCanvasElement,
    onGrid: FlashGridCallback,
  ): boolean {
    if (pending && performance.now() - pendingSince > READBACK_TIMEOUT_MS) {
      abandonOffThread();
    }
    if (pending) return false;
    if (canvas.width <= 0 || canvas.height <= 0) {
      onGrid(null);
      return true;
    }

    const target = offThread ? ensureWorker() : null;
    if (!target) {
      offThread = false;
      onGrid(mainThread.read(canvas));
      return true;
    }

    let snapshot: Promise<ImageBitmap>;
    try {
      // The snapshot is taken now, in the draw; only the bitmap resolves
      // later. 'pixelated' is nearest neighbour, matching the main-thread
      // read with smoothing off.
      snapshot = createImageBitmap(canvas, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'pixelated',
      });
    } catch {
      onGrid(null);
      return true;
    }
    pending = onGrid;
    pendingSince = performance.now();
    snapshot.then(
      (bitmap) => {
        if (disposed || worker !== target) {
          bitmap.close();
          return;
        }
        target.postMessage({ bitmap, cols: width, rows: height }, [bitmap]);
      },
      () => settle(null),
    );
    return true;
  }

  function dispose() {
    disposed = true;
    pending = null;
    worker?.terminate();
    worker = null;
    mainThread.dispose();
  }

  return {
    capture,
    cols,
    rows,
    density: mainThread.density,
    get offThread() {
      return offThread;
    },
    dispose,
  };
}
