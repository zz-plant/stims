/**
 * A canvas that follows another at a fixed size: the frames a recording at a
 * preset size is encoded from when the source cannot be resized.
 *
 * The copy is painted on every tick of `subscribe` with the source cropped
 * to fill the output, centred, so a portrait preset recorded from a landscape
 * canvas keeps the middle of the picture at full height. The default
 * `subscribe` is an animation-frame loop, which is right for a 2D or a WebGL
 * canvas drawn with `preserveDrawingBuffer`. A WebGPU canvas holds its frame
 * only until it is presented, and a WebGL canvas without
 * `preserveDrawingBuffer` may already be cleared by the time a separate
 * animation frame runs: in the app this was extracted from, a WebGPU canvas
 * read back fully transparent from a separate frame, every time. For those,
 * pass a `subscribe` that calls back from the render loop itself, right after
 * the draw, in the same task.
 */

/** The canvas a recording is encoded from, and how to let it go. */
export type RecordableFrames = {
  readonly canvas: HTMLCanvasElement;
  dispose: () => void;
};

/** Calls `paint` once per frame until the returned function runs. */
export type FrameSubscription = (paint: () => void) => () => void;

export const subscribeToAnimationFrames: FrameSubscription = (paint) => {
  let id: number | null = null;
  const loop = () => {
    paint();
    id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
  return () => {
    if (id !== null) cancelAnimationFrame(id);
    id = null;
  };
};

export function createCanvasFrameCopy({
  getCanvas,
  size,
  createCanvas = () => document.createElement('canvas'),
  subscribe = subscribeToAnimationFrames,
}: {
  /** The canvas being recorded; read on every paint, so it may be replaced. */
  getCanvas: () => HTMLCanvasElement | null;
  /** The output size. Without it the copy follows the source's size. */
  size?: { width: number; height: number };
  createCanvas?: () => HTMLCanvasElement;
  subscribe?: FrameSubscription;
}): RecordableFrames | null {
  const canvas = createCanvas();
  const output = canvas.getContext('2d', { alpha: false });
  if (!output) return null;

  // Assigning a canvas dimension clears it, even to the value it already
  // has, so only a change is written.
  const fitTo = (source: HTMLCanvasElement) => {
    const width = size?.width ?? Math.max(1, source.width);
    const height = size?.height ?? Math.max(1, source.height);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height };
  };
  // Sized now rather than at the first frame, so a capture taken before it
  // starts at its real size instead of the default 300 x 150.
  const first = getCanvas();
  if (first) fitTo(first);

  const paint = () => {
    const source = getCanvas();
    if (!source) return;
    const sourceWidth = Math.max(1, source.width);
    const sourceHeight = Math.max(1, source.height);
    const { width, height } = fitTo(source);
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const cropWidth = width / scale;
    const cropHeight = height / scale;
    output.drawImage(
      source,
      (sourceWidth - cropWidth) / 2,
      (sourceHeight - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height,
    );
  };

  const unsubscribe = subscribe(paint);
  return {
    canvas,
    dispose: () => {
      unsubscribe();
      // Release the backing store now rather than whenever the canvas is
      // collected; at 4K it holds about 33 MB.
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
