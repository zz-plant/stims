import type { MilkdropRenderBackend } from './common-types.ts';

export const PRESET_PREVIEW_REQUEST_LIMIT = 8;

export type MilkdropPresetRenderPreviewStatus =
  | 'queued'
  | 'capturing'
  | 'ready'
  | 'failed';

export type MilkdropPresetRenderPreview = {
  presetId: string;
  status: MilkdropPresetRenderPreviewStatus;
  imageUrl: string | null;
  actualBackend: MilkdropRenderBackend | null;
  updatedAt: number | null;
  error: string | null;
  source: 'runtime-snapshot';
};

export function createQueuedPresetPreview(
  presetId: string,
): MilkdropPresetRenderPreview {
  return {
    presetId,
    status: 'queued',
    imageUrl: null,
    actualBackend: null,
    updatedAt: null,
    error: null,
    source: 'runtime-snapshot',
  };
}

/** Sampled luma must reach this before a frame counts as showing anything. */
const MIN_PAINTED_LUMA = 24;
/** ...and span at least this much, so a flat wash is not mistaken for content. */
const MIN_PAINTED_LUMA_RANGE = 10;

/**
 * Whether the buffer holds a frame with something visible in it.
 *
 * Not merely "more than one colour": a cleared buffer that caught a stray
 * pixel of noise passes that, and measurably did — a tile captured at luma
 * 0–5 across six near-black colours, which is a black rectangle as far as any
 * reader is concerned. Requiring real brightness *and* real spread is what
 * separates a frame from an artefact.
 *
 * Samples rather than scanning every pixel: a tile is small, but this runs
 * inside the render tick.
 */
function isFramePainted(pixels: Uint8Array): boolean {
  const stride = Math.max(4, Math.floor(pixels.length / 4 / 512) * 4);
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += stride) {
    const luma = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  return max >= MIN_PAINTED_LUMA && max - min >= MIN_PAINTED_LUMA_RANGE;
}

/**
 * Encode a preview data URL from a live renderer canvas.
 *
 * The milkdrop composite pass leaves the WebGL drawing buffer's alpha channel
 * at 0, so canvas.toDataURL() encodes a fully transparent (visually black)
 * image. Read the GL pixels directly, flip the bottom-up rows, and force alpha
 * opaque before encoding. WebGPU canvases expose no GL context and present
 * with opaque alpha, so they fall back to toDataURL.
 *
 * `requirePainted` returns an empty string instead of an image when the buffer
 * has nothing visible in it. These contexts are created with
 * preserveDrawingBuffer: false, so a read from outside the tick that drew the
 * frame returns a cleared buffer — a black rectangle that looks exactly like a
 * successful capture and would be shown as a preview of the preset. A very
 * dark preset losing its preview is the safe direction to be wrong in;
 * presenting a blank rectangle as one is not.
 */
export function encodePresetPreviewImage(
  canvas: HTMLCanvasElement,
  { requirePainted = false }: { requirePainted?: boolean } = {},
): string {
  const encodeFallback = () =>
    requirePainted ? '' : canvas.toDataURL('image/webp', 0.82);
  const gl =
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
    (canvas.getContext('webgl') as WebGLRenderingContext | null);
  if (!gl) {
    return encodeFallback();
  }
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width === 0 || height === 0) {
    return encodeFallback();
  }
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const context = target.getContext('2d');
  if (!context) {
    return encodeFallback();
  }
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  if (requirePainted && !isFramePainted(pixels)) {
    return '';
  }

  const image = context.createImageData(width, height);
  // GL rows are bottom-up; ImageData is top-down. Alpha in the drawing
  // buffer is an internal scratch value, so force it opaque.
  for (let y = 0; y < height; y++) {
    image.data.set(
      pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
      y * width * 4,
    );
  }
  for (let i = 3; i < image.data.length; i += 4) {
    image.data[i] = 255;
  }
  context.putImageData(image, 0, 0);
  return target.toDataURL('image/webp', 0.82);
}
