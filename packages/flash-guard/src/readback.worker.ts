/**
 * Reads a flash-sampler snapshot back to bytes, off the main thread.
 *
 * The snapshot is an ImageBitmap the sampler took inside the draw, already
 * downscaled to the luminance field. Drawing it into a CPU-backed canvas waits
 * for the GPU to finish the frame it came from (1.9-2.7ms measured, see
 * `sampler.ts`); doing that here is what keeps the wait out of the
 * render loop. Luminance is computed by the caller from a lookup table: 16k
 * pixels cost about 0.1ms, and keeping the worker free of imports keeps it
 * one file in every build.
 */

/** `id` is echoed back so the sampler can match answers to captures. */
type ReadbackRequest = {
  id: number;
  bitmap: ImageBitmap;
  cols: number;
  rows: number;
};

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (event: MessageEvent<ReadbackRequest>) => {
  const { id, bitmap, cols, rows } = event.data;
  let pixels: Uint8ClampedArray | null = null;
  try {
    if (!canvas || canvas.width !== cols || canvas.height !== rows) {
      canvas = new OffscreenCanvas(cols, rows);
      // CPU-backed, so the getImageData below is a copy, not a fresh map.
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (context) {
      context.clearRect(0, 0, cols, rows);
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, cols, rows).data;
    }
  } catch {
    pixels = null;
  } finally {
    bitmap.close();
  }
  if (pixels) {
    self.postMessage({ id, pixels }, { transfer: [pixels.buffer] });
  } else {
    self.postMessage({ id, pixels: null });
  }
};
