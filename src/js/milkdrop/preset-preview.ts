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

/**
 * Encode a preview data URL from a live renderer canvas.
 *
 * The milkdrop composite pass leaves the WebGL drawing buffer's alpha channel
 * at 0, so canvas.toDataURL() encodes a fully transparent (visually black)
 * image. Read the GL pixels directly, flip the bottom-up rows, and force alpha
 * opaque before encoding. WebGPU canvases expose no GL context and present
 * with opaque alpha, so they fall back to toDataURL.
 */
export function encodePresetPreviewImage(canvas: HTMLCanvasElement): string {
  const encodeFallback = () => canvas.toDataURL('image/webp', 0.82);
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
