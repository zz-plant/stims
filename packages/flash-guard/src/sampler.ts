/**
 * Per-frame luminance sampling for the flash governor.
 *
 * The governor needs one thing, every frame, as cheaply as possible: a small
 * field of WCAG relative luminance read from the presented canvas. The same
 * pixels also give the red-flash field (`FlashRedField`), so the governor
 * can apply the red-flash criterion the offline analysis applies.
 *
 * Each of the RECOMMENDED_GRID x RECOMMENDED_GRID tiles is read as
 * RECOMMENDED_SAMPLE_DENSITY squared single pixels, not as one value: the
 * downscale is nearest neighbour to a 128x128 field, so every sample is one
 * pixel of the frame, the same pixel every frame, which is how the offline
 * analysis samples too. The governor thresholds each one before counting
 * area; `RECOMMENDED_SAMPLE_DENSITY` has why one value per tile read moving
 * texture as a strobe.
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
 * Reading the 128x128 field rather than a 16x16 grid moved none of that:
 * re-measured 2026-10-07, the capture still costs 0.1ms of main thread and
 * the field arrives 3.0-3.5ms later on either backend. What the larger field
 * adds is work when it arrives: converting 16k pixels to luminance (about
 * 0.1ms) and judging them (`governor.sample`: 0.09ms mean on a still frame,
 * 0.24ms on busy texture, 0.49ms on a strobe that solves a clamp every
 * flash). Load average was near 40 for all of those, so they are ceilings.
 *
 * Reading the red-flash field from the same pixels, and judging it, costs
 * little next to that. On synthetic 128x128 fields in headless Chromium (M1
 * Max, 2026-10-13), converting a field went from 0.055ms to 0.060ms, and
 * `governor.sample` added 0.06ms on a still frame and on random noise alike.
 *
 * The worker is `readback.worker.ts`, published as `flash-guard/worker`. The
 * default loads it with `new URL('./readback.worker.js', import.meta.url)`,
 * which every modern bundler understands; pass `createWorker` to load it
 * some other way.
 */
import {
  type FlashRedField,
  RECOMMENDED_GRID,
  RECOMMENDED_SAMPLE_DENSITY,
} from './governor.ts';
import {
  isSaturatedRed,
  LINEAR_CHANNEL_LUT,
  redFlashValue,
} from './thresholds.ts';

/**
 * Receives a captured frame's luminance field, or null if it could not be
 * read, and the same samples' red-flash field. Pass both to
 * `governor.sample` (the red one as `options.red`).
 */
export type FlashGridCallback = (
  field: Float32Array | null,
  red?: FlashRedField,
) => void;

export type FlashSampler = {
  /**
   * Snapshots the canvas now, so call it inside the draw, and hands its
   * luminance and red-flash fields to `onGrid`, either before returning or
   * once a worker has read it, in the order captures were taken. Returns
   * false, capturing nothing, while MAX_CAPTURES_IN_FLIGHT captures are
   * still being read. The fields are reused by the next capture: read them
   * in the callback.
   */
  capture: (canvas: HTMLCanvasElement, onGrid: FlashGridCallback) => boolean;
  /** Tiles across and down. */
  readonly cols: number;
  readonly rows: number;
  /**
   * Samples along each tile edge: the field handed to `onGrid` is
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

/** A luminance field and the red-flash field read from the same pixels. */
type SampledFields = {
  luminance: Float32Array;
  red: { values: Float32Array; saturated: Uint8Array };
};

function createFields(count: number): SampledFields {
  return {
    luminance: new Float32Array(count),
    red: { values: new Float32Array(count), saturated: new Uint8Array(count) },
  };
}

function fillFields(target: SampledFields, pixels: Uint8ClampedArray) {
  const { luminance, red } = target;
  const redValues = red.values;
  const redSaturated = red.saturated;
  const len = luminance.length;
  let idx = 0;
  for (let i = 0; i < len; i += 1) {
    const r = pixels[idx] as number;
    const g = pixels[idx + 1] as number;
    const b = pixels[idx + 2] as number;
    idx += 4;
    luminance[i] =
      0.2126 * (LINEAR_CHANNEL_LUT[r] as number) +
      0.7152 * (LINEAR_CHANNEL_LUT[g] as number) +
      0.0722 * (LINEAR_CHANNEL_LUT[b] as number);
    redValues[i] = redFlashValue(r, g, b);
    redSaturated[i] = isSaturatedRed(r, g, b) ? 1 : 0;
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
  const fields = createFields(width * height);

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
    // Nearest neighbour: each sample is one pixel, the same pixel every
    // frame. Smoothing would blend a browser-chosen neighbourhood, which is
    // neither a pixel nor a tile mean.
    if (context) context.imageSmoothingEnabled = false;
    return context;
  }

  /**
   * The luminance field, or null if the canvas could not be read. The
   * red-flash field of the same read is `red`.
   */
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
    return fillFields(fields, pixels).luminance;
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
    /** The red-flash field of the last successful `read`. */
    red: fields.red,
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

export type FlashSamplerOptions = {
  /** Grid size (square), in tiles. Defaults to `RECOMMENDED_GRID`. */
  grid?: number;
  /** Samples along each tile edge. Defaults to `RECOMMENDED_SAMPLE_DENSITY`. */
  density?: number;
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

/**
 * Captures that may wait on the worker at once.
 *
 * One at a time refused the next frame's capture whenever a readback
 * outlasted a frame, so the governor compared frames 33ms apart instead of
 * 16.7ms, which doubles the motion in each comparison. Under load (readback
 * 13ms median, 20ms p95), 348 of 1,154 comparisons in 25s spanned two
 * frames, from this and from too tight a sampling gate (see
 * `MIN_SAMPLE_INTERVAL_MS` in controller.ts), and every flash the governor
 * counted was across one; no comparison of consecutive frames qualified.
 * Letting a few captures queue turns a slow readback into a late sample
 * instead of a missing one; the cap keeps a stalled worker from queueing
 * without bound.
 */
export const MAX_CAPTURES_IN_FLIGHT = 3;

type InFlightCapture = {
  id: number;
  onGrid: FlashGridCallback;
  since: number;
  /** Undefined until the worker answers; null if it could not read it. */
  pixels?: Uint8ClampedArray | null;
};

export function createFlashSampler(
  options: FlashSamplerOptions | number = {},
): FlashSampler {
  const resolved = typeof options === 'number' ? { grid: options } : options;
  const createWorker = resolved.createWorker ?? defaultWorker;
  const mainThread = createMainThreadFlashReader(
    resolved.grid ?? RECOMMENDED_GRID,
    resolved.density ?? RECOMMENDED_SAMPLE_DENSITY,
  );
  const { cols, rows, width, height } = mainThread;
  const fields = createFields(width * height);

  let offThread = canReadOffThread();
  let worker: Worker | null = null;
  /** Oldest first: answers are handed on in the order frames were taken. */
  const inFlight: InFlightCapture[] = [];
  let nextId = 0;
  let disposed = false;

  function deliver() {
    while (inFlight.length > 0 && inFlight[0]?.pixels !== undefined) {
      const { onGrid, pixels } = inFlight.shift() as InFlightCapture;
      if (disposed) return;
      if (pixels) {
        fillFields(fields, pixels);
        onGrid(fields.luminance, fields.red);
      } else {
        onGrid(null);
      }
    }
  }

  function settle(id: number, pixels: Uint8ClampedArray | null) {
    const capture = inFlight.find((entry) => entry.id === id);
    if (!capture) return;
    capture.pixels = pixels;
    deliver();
  }

  function abandonOffThread() {
    offThread = false;
    worker?.terminate();
    worker = null;
    for (const capture of inFlight) {
      if (capture.pixels === undefined) capture.pixels = null;
    }
    deliver();
  }

  function ensureWorker(): Worker | null {
    if (worker) return worker;
    try {
      worker = createWorker();
    } catch {
      return null;
    }
    if (!worker) return null;
    worker.onmessage = (
      event: MessageEvent<{ id: number; pixels: Uint8ClampedArray | null }>,
    ) => {
      settle(event.data.id, event.data.pixels);
    };
    worker.onerror = () => abandonOffThread();
    return worker;
  }

  function capture(
    canvas: HTMLCanvasElement,
    onGrid: FlashGridCallback,
  ): boolean {
    const oldest = inFlight[0];
    if (oldest && performance.now() - oldest.since > READBACK_TIMEOUT_MS) {
      abandonOffThread();
    }
    if (inFlight.length >= MAX_CAPTURES_IN_FLIGHT) return false;
    if (canvas.width <= 0 || canvas.height <= 0) {
      onGrid(null);
      return true;
    }

    const target = offThread ? ensureWorker() : null;
    if (!target) {
      offThread = false;
      const field = mainThread.read(canvas);
      if (field) onGrid(field, mainThread.red);
      else onGrid(null);
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
    const id = nextId;
    nextId += 1;
    inFlight.push({ id, onGrid, since: performance.now() });
    snapshot.then(
      (bitmap) => {
        if (disposed || worker !== target) {
          bitmap.close();
          return;
        }
        target.postMessage({ id, bitmap, cols: width, rows: height }, [bitmap]);
      },
      () => settle(id, null),
    );
    return true;
  }

  function dispose() {
    disposed = true;
    inFlight.length = 0;
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
