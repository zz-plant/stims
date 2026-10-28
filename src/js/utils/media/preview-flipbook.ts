/** Bounded, codec-independent social previews shared by the browser and edge. */
import { createFlashFrameCounter } from 'flash-guard';

export const PREVIEW_WIDTH = 192;
export const PREVIEW_HEIGHT = 108;
export const PREVIEW_FRAME_COUNT = 20;
export const PREVIEW_DELAY_MS = 200;
export const MAX_FLIPBOOK_BYTES = 2_000_000;

export type PreviewFlipbook = {
  version: 1;
  width: number;
  height: number;
  delayMs: number;
  /** Base64 palette indices, one byte per pixel; fixed RGB332 palette. */
  frames: string[];
};

export function quantizePreviewFrame(
  rgba: Uint8Array | Uint8ClampedArray,
): string {
  let pixels = '';
  for (let i = 0; i < rgba.length; i += 4) {
    pixels += String.fromCharCode(
      (rgba[i] & 224) | ((rgba[i + 1] & 224) >> 3) | (rgba[i + 2] >> 6),
    );
  }
  return btoa(pixels);
}

export function validateFlipbook(value: unknown): PreviewFlipbook {
  if (!value || typeof value !== 'object')
    throw new Error('Missing preview frames.');
  const clip = value as Record<string, unknown>;
  const { width, height, delayMs, frames } = clip;
  if (
    clip.version !== 1 ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width > 320 ||
    height > 180 ||
    typeof delayMs !== 'number' ||
    !Number.isInteger(delayMs) ||
    delayMs < 100 ||
    delayMs > 500 ||
    delayMs % 10 !== 0 ||
    !Array.isArray(frames) ||
    frames.length < 2 ||
    frames.length > 24 ||
    delayMs * frames.length < 1000 ||
    delayMs * frames.length > 5000
  ) {
    throw new Error('Invalid preview dimensions, duration or frame count.');
  }
  for (const frame of frames) {
    if (
      typeof frame !== 'string' ||
      frame.length !== 4 * Math.ceil((width * height) / 3) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(frame) ||
      atob(frame).length !== width * height
    ) {
      throw new Error('Invalid preview frame pixels.');
    }
  }
  return { version: 1, width, height, delayMs, frames: frames as string[] };
}

function paletteColor(index: number): [number, number, number] {
  return [
    Math.round(((index >> 5) * 255) / 7),
    Math.round((((index >> 2) & 7) * 255) / 7),
    (index & 3) * 85,
  ];
}

export function decodePreviewFrame(frame: string): Uint8Array {
  const pixels = atob(frame);
  const rgba = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    rgba.set(paletteColor(pixels.charCodeAt(i)), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** The interchange GIF prioritizes cheap encoding; Cloudflare compresses the MP4. */
export function encodeFlipbookGif(input: PreviewFlipbook): Uint8Array {
  const clip = validateFlipbook(input);
  const { width, height, delayMs } = clip;
  const counter = createFlashFrameCounter({ width, height, deltaMs: delayMs });
  // Analyze the palette as actually encoded, including the loop seam. This
  // describes this sampled clip only, never the preset's full-speed behavior.
  for (const frame of [...clip.frames, ...clip.frames, clip.frames[0]]) {
    counter.push(decodePreviewFrame(frame));
  }
  const analysis = counter.analyze();
  if (
    analysis.peakFlashesPerSecond > 0 ||
    analysis.peakRedFlashesPerSecond > 0
  ) {
    throw new Error('This preview contains flashes. Try a calmer passage.');
  }
  const bytes: number[] = [];
  const word = (n: number) => bytes.push(n & 255, n >> 8);
  bytes.push(...new TextEncoder().encode('GIF89a'));
  word(width);
  word(height);
  bytes.push(247, 0, 0);
  for (let i = 0; i < 256; i++) bytes.push(...paletteColor(i));
  bytes.push(
    33,
    255,
    11,
    ...new TextEncoder().encode('NETSCAPE2.0'),
    3,
    1,
    0,
    0,
    0,
  );
  for (const frame of clip.frames) {
    bytes.push(33, 249, 4, 4);
    word(delayMs / 10);
    bytes.push(0, 0, 44);
    word(0);
    word(0);
    word(width);
    word(height);
    bytes.push(0, 8);
    // Literal-only LZW with regular clears: a bounded 9-bit stream, with no
    // growing dictionary or expensive compression in the request handler.
    const packed: number[] = [];
    let buffer = 0;
    let bits = 0;
    const code = (n: number) => {
      buffer |= n << bits;
      bits += 9;
      while (bits >= 8) {
        packed.push(buffer & 255);
        buffer >>>= 8;
        bits -= 8;
      }
    };
    const pixels = atob(frame);
    code(256);
    for (let i = 0; i < pixels.length; i++) {
      if (i > 0 && i % 200 === 0) code(256);
      code(pixels.charCodeAt(i));
    }
    code(257);
    if (bits) packed.push(buffer & 255);
    for (let i = 0; i < packed.length; i += 255) {
      const block = packed.slice(i, i + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(59);
  return Uint8Array.from(bytes);
}

export function previewVideoUrl(origin: string, id: string): string {
  return new URL(`/api/flipbooks/${id}.mp4`, origin).toString();
}
