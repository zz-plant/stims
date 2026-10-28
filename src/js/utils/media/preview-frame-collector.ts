/** Samples presented frames, with a bounded lifetime and cancellation. */
import {
  PREVIEW_DELAY_MS,
  PREVIEW_FRAME_COUNT,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  type PreviewFlipbook,
  quantizePreviewFrame,
  validateFlipbook,
} from './preview-flipbook.ts';

export function collectPreviewFrames({
  subscribe,
  read,
  signal,
  isCurrent = () => true,
  width = PREVIEW_WIDTH,
  height = PREVIEW_HEIGHT,
}: {
  subscribe(listener: (nowMs: number) => void): () => void;
  read(): Uint8ClampedArray | Uint8Array;
  signal: AbortSignal;
  isCurrent?: () => boolean;
  width?: number;
  height?: number;
}): Promise<PreviewFlipbook> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const frames: string[] = [];
    let lastTime = -Infinity;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else
        resolve(
          validateFlipbook({
            version: 1,
            width,
            height,
            delayMs: PREVIEW_DELAY_MS,
            frames,
          }),
        );
    };
    const cancel = () => finish(new Error('Preview capture cancelled.'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'Preview capture stalled. Keep the visualizer playing and try again.',
          ),
        ),
      10_000,
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    unsubscribe = subscribe((now) => {
      if (finished) return;
      if (!isCurrent()) {
        finish(new Error('The preset changed during capture. Try again.'));
        return;
      }
      if (now - lastTime < PREVIEW_DELAY_MS) return;
      try {
        const pixels = read();
        if (pixels.length !== width * height * 4)
          throw new Error('Preview frame is unavailable.');
        frames.push(quantizePreviewFrame(pixels));
        lastTime = now;
        if (frames.length === PREVIEW_FRAME_COUNT) finish();
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error('Preview capture failed.'),
        );
      }
    });
  });
}
