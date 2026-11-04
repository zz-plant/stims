/**
 * The flash worker: reads a sampler snapshot back to bytes off the main
 * thread and, for a judged capture, judges it here too. `worker-core.ts` holds
 * what each message does.
 *
 * The snapshot is an ImageBitmap the sampler took inside the draw, already
 * downscaled to the luminance field. Drawing it into a CPU-backed canvas waits
 * for the GPU to finish the frame it came from (1.9-2.7ms measured, see
 * `sampler.ts`); doing that here is what keeps the wait out of the
 * render loop.
 */
import { createFlashWorkerHandler } from './worker-core.ts';

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

function readBitmap(bitmap: ImageBitmap, cols: number, rows: number) {
  try {
    if (!canvas || canvas.width !== cols || canvas.height !== rows) {
      canvas = new OffscreenCanvas(cols, rows);
      // CPU-backed, so the getImageData below is a copy, not a fresh map.
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) return null;
    context.clearRect(0, 0, cols, rows);
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, cols, rows).data;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

const handle = createFlashWorkerHandler({
  readBitmap,
  reply: (message, transfer = []) => self.postMessage(message, { transfer }),
});

self.onmessage = (event: MessageEvent) => handle(event.data);
