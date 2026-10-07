/**
 * Per-frame luminance sampling for the flash governor.
 *
 * `visual-embedding.ts` already downsamples a canvas for its frame stats, but
 * that path runs on demand (agent captures, preset switches) and computes a
 * histogram, edge density, and motion estimate. The governor needs one thing,
 * every frame, as cheaply as possible: a small grid of WCAG relative
 * luminance. Sharing the embedding path would mean paying for three
 * statistics to use none of them.
 *
 * The grid is RECOMMENDED_GRID square rather than the canvas aspect. The
 * visual-field window is defined as a fraction of each axis, so a square grid
 * keeps the window square in tile space no matter how wide the canvas is; the
 * alternative is a window that stops approximating 10 degrees on ultrawide
 * displays.
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
 * answer either, because at 15Hz a 30Hz strobe aliases away. The fix that
 * removes the wait is an asynchronous downscaled readback in the renderer;
 * until then this is why Reduce flashing stays opt-in rather than on for
 * everyone.
 */
import { relativeLuminance } from '../flash-thresholds.ts';
import { RECOMMENDED_GRID } from './flash-governor.ts';

export type FlashSampler = {
  /** Fills and returns the luminance grid, or null if sampling failed. */
  sample: (canvas: HTMLCanvasElement) => Float32Array | null;
  readonly cols: number;
  readonly rows: number;
  dispose: () => void;
};

export function createFlashSampler(
  grid: number = RECOMMENDED_GRID,
): FlashSampler {
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

  function sample(canvas: HTMLCanvasElement): Float32Array | null {
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

    for (let i = 0; i < luminance.length; i += 1) {
      const idx = i * 4;
      luminance[i] = relativeLuminance(
        pixels[idx] as number,
        pixels[idx + 1] as number,
        pixels[idx + 2] as number,
      );
    }
    return luminance;
  }

  function dispose() {
    context = null;
    if (scratch) {
      scratch.width = 0;
      scratch.height = 0;
      scratch = null;
    }
  }

  return { sample, cols, rows, dispose };
}
