/**
 * Per-frame luminance sampling for the flash governor.
 *
 * The governor needs one thing, every frame, as cheaply as possible: a small
 * grid of WCAG relative luminance read from the presented canvas.
 *
 * The grid is RECOMMENDED_GRID square rather than the canvas aspect. The
 * visual-field window is defined as a fraction of each axis, so a square grid
 * keeps the window square in tile space no matter how wide the canvas is; the
 * alternative is a window that stops approximating 10 degrees on ultrawide
 * displays.
 *
 * Cost is the reason this is worth reading carefully, and the reason it was
 * measured rather than assumed: a per-frame GPU->CPU round trip nobody timed
 * is how a safety feature becomes a frame-rate bug.
 *
 * A first benchmark put this at 10us per sample (16x16 grid, 1217x760). It
 * read on its own animation frame, after the frame had been presented: on
 * WebGPU it read transparent pixels and on WebGL a copy the browser already
 * held, so neither waited for the GPU. Reading the frame that is actually on
 * screen means reading inside the draw, and that read waits for the GPU to
 * finish the frame. Measured 2026-10-06, M1 Max, 1280x720, headless
 * Chromium:
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
 * The worker is `readback.worker.ts`, published as `flash-guard/worker`. The
 * default loads it with `new URL('./readback.worker.js', import.meta.url)`,
 * which every modern bundler understands; pass `createWorker` to load it
 * some other way.
 */
import { RECOMMENDED_GRID } from './governor.ts';
import { relativeLuminance } from './thresholds.ts';

/** Receives a captured frame's luminance grid, or null if it could not be read. */
export type FlashGridCallback = (tiles: Float32Array | null) => void;

export type FlashSampler = {
  /**
   * Snapshots the canvas now, so call it inside the draw, and hands its luminance grid to `onGrid`, either
   * before returning or once a worker has read it. Returns false, capturing
   * nothing, while the previous capture is still being read. The grid is
   * reused by the next capture: read it in the callback.
   */
  capture: (canvas: HTMLCanvasElement, onGrid: FlashGridCallback) => boolean;
  readonly cols: number;
  readonly rows: number;
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

function fillLuminance(target: Float32Array, pixels: Uint8ClampedArray) {
  for (let i = 0; i < target.length; i += 1) {
    const idx = i * 4;
    target[i] = relativeLuminance(
      pixels[idx] as number,
      pixels[idx + 1] as number,
      pixels[idx + 2] as number,
    );
  }
  return target;
}

/**
 * Reads the canvas on the calling thread and waits for the GPU to finish
 * the frame. The fallback, and what the off-thread path is measured against.
 */
export function createMainThreadFlashReader(grid: number = RECOMMENDED_GRID) {
  const cols = Math.max(1, Math.floor(grid));
  const rows = cols;
  const luminance = new Float32Array(cols * rows);

  let scratch: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;

  function ensureContext(): CanvasRenderingContext2D | null {
    if (context) return context;
    if (typeof document === 'undefined') return null;
    scratch = document.createElement('canvas');
    scratch.width = cols;
    scratch.height = rows;
    // willReadFrequently keeps the surface CPU-side, which is what makes the
    // repeated getImageData cheap rather than a fresh map every frame.
    context = scratch.getContext('2d', { willReadFrequently: true });
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
      ctx.drawImage(canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, cols, rows);
      pixels = ctx.getImageData(0, 0, cols, rows).data;
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

  return { read, cols, rows, dispose };
}

function canReadOffThread() {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

export type FlashSamplerOptions = {
  /** Grid size (square), in tiles. Defaults to `RECOMMENDED_GRID`. */
  grid?: number;
  /**
   * Builds the readback worker. Defaults to loading `./readback.worker.js`
   * relative to this module, which bundlers resolve from the `new URL`
   * pattern. Return null to force the main-thread read.
   */
  createWorker?: () => Worker | null;
};

function defaultWorker(): Worker {
  return new Worker(new URL('./readback.worker.js', import.meta.url), {
    type: 'module',
    name: 'flash-guard-readback',
  });
}

export function createFlashSampler(
  options: FlashSamplerOptions | number = {},
): FlashSampler {
  const resolved = typeof options === 'number' ? { grid: options } : options;
  const grid = resolved.grid ?? RECOMMENDED_GRID;
  const createWorker = resolved.createWorker ?? defaultWorker;
  const mainThread = createMainThreadFlashReader(grid);
  const { cols, rows } = mainThread;
  const luminance = new Float32Array(cols * rows);

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
      worker = createWorker();
    } catch {
      return null;
    }
    if (!worker) return null;
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
      // later. 'low' matches the main-thread read's drawImage downscale.
      snapshot = createImageBitmap(canvas, {
        resizeWidth: cols,
        resizeHeight: rows,
        resizeQuality: 'low',
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
        target.postMessage({ bitmap, cols, rows }, [bitmap]);
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
    get offThread() {
      return offThread;
    },
    dispose,
  };
}
