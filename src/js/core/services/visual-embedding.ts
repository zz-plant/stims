import {
  type VisualSearchRequest,
  VisualSearchResponseSchema,
} from '../edge-contracts.ts';
import { resolveOptionalApiUrl } from './optional-api.ts';

export interface FrameStats {
  histogram: number[];
  edgeDensity: number;
  motionEstimate: number;
}

const previousSamples = new WeakMap<
  HTMLCanvasElement,
  { width: number; height: number; pixels: Uint8ClampedArray }
>();
let catalogEmbeddingsReady = false;
let embeddingsReadyResolve: (() => void) | null = null;
let sampleCanvas: HTMLCanvasElement | null = null;
let sampleCanvasFactory: typeof document.createElement | null = null;

const MAX_SAMPLE_DIMENSION = 64;

export const embeddingsReady = new Promise<void>((resolve) => {
  if (catalogEmbeddingsReady) {
    resolve();
  } else {
    embeddingsReadyResolve = resolve;
  }
});

function _histogramDistance(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i] - b[i]) / 256;
  }
  return sum / len;
}

function createEmptyFrameStats(): FrameStats {
  return {
    histogram: new Array(24).fill(0),
    edgeDensity: 0,
    motionEstimate: 0,
  };
}

/**
 * The pixel maths, over raw RGBA. Split out from extractFrameStats so the
 * same code can describe a live canvas in the browser and a rendered preview
 * PNG in a build script — the query side and the index side have to speak
 * the same vocabulary, and the only way to guarantee that is to share the
 * function that produces it.
 */
export function computeFrameStats(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  previousPixels?: Uint8ClampedArray | Uint8Array | null,
): FrameStats {
  if (width <= 0 || height <= 0) {
    return createEmptyFrameStats();
  }

  const histogram = new Array(24).fill(0);
  let sampleCount = 0;
  let edgeDensity = 0;
  let motionEstimate = 0;
  const previousPixelData =
    previousPixels && previousPixels.length === pixels.length
      ? previousPixels
      : null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      histogram[Math.min(7, r >> 5)]++;
      histogram[8 + Math.min(7, g >> 5)]++;
      histogram[16 + Math.min(7, b >> 5)]++;

      if (x + 1 < width) {
        const nextIdx = (y * width + (x + 1)) * 4;
        const grayCurr = 0.299 * r + 0.587 * g + 0.114 * b;
        const grayNext =
          0.299 * pixels[nextIdx] +
          0.587 * pixels[nextIdx + 1] +
          0.114 * pixels[nextIdx + 2];
        edgeDensity += Math.abs(grayCurr - grayNext) / 255;
      }

      if (previousPixelData) {
        motionEstimate +=
          (Math.abs(r - previousPixelData[idx]) +
            Math.abs(g - previousPixelData[idx + 1]) +
            Math.abs(b - previousPixelData[idx + 2])) /
          (255 * 3);
      }

      sampleCount++;
    }
  }

  if (sampleCount > 0) {
    for (let i = 0; i < 24; i++) {
      histogram[i] /= sampleCount;
    }
    edgeDensity /= sampleCount;
    motionEstimate /= sampleCount;
  }

  return { histogram, edgeDensity, motionEstimate };
}

export function extractFrameStats(canvas: HTMLCanvasElement): FrameStats {
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return createEmptyFrameStats();
  }

  const scale = Math.min(
    1,
    MAX_SAMPLE_DIMENSION / Math.max(sourceWidth, sourceHeight),
  );
  const w = Math.max(1, Math.round(sourceWidth * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));
  if (!sampleCanvas || sampleCanvasFactory !== document.createElement) {
    sampleCanvas = document.createElement('canvas');
    sampleCanvasFactory = document.createElement;
  }
  if (sampleCanvas.width !== w) {
    sampleCanvas.width = w;
  }
  if (sampleCanvas.height !== h) {
    sampleCanvas.height = h;
  }
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return createEmptyFrameStats();
  }

  let pixels: Uint8ClampedArray;
  try {
    ctx.drawImage(canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, w, h);
    pixels = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return createEmptyFrameStats();
  }

  const previousSample = previousSamples.get(canvas);
  const stats = computeFrameStats(
    pixels,
    w,
    h,
    previousSample?.width === w && previousSample.height === h
      ? previousSample.pixels
      : null,
  );

  previousSamples.set(canvas, {
    width: w,
    height: h,
    pixels: new Uint8ClampedArray(pixels),
  });

  return stats;
}

function dominantHue(histogram: number[]): string {
  const r = histogram.slice(0, 8).reduce((a, v, i) => a + v * (i + 1), 0);
  const g = histogram.slice(8, 16).reduce((a, v, i) => a + v * (i + 1), 0);
  const b = histogram.slice(16, 24).reduce((a, v, i) => a + v * (i + 1), 0);

  if (r > g && r > b) return r > b * 1.5 ? 'red' : 'orange';
  if (g > r && g > b) return 'green';
  if (b > r && b > g) return 'blue';
  if (r > 0.5 && g > 0.5 && b < 0.2) return 'yellow';
  if (r > 0.5 && b > 0.5 && g < 0.2) return 'purple';
  if (g > 0.5 && b > 0.5 && r < 0.2) return 'cyan';
  return 'neutral';
}

function paletteDescription(histogram: number[]): string {
  const hue = dominantHue(histogram);
  const _total = histogram.reduce((a, v) => a + v, 0);
  const vibrant = histogram.reduce((a, v) => a + (v > 0.05 ? 1 : 0), 0);

  if (vibrant <= 3) return `monochrome ${hue}`;
  if (vibrant <= 6) return `${hue}-dominant palette`;
  return `vibrant ${hue}-centered palette`;
}

function edgeDescription(edgeDensity: number): string {
  if (edgeDensity < 0.05) return 'smooth gradients';
  if (edgeDensity < 0.15) return 'moderate edges';
  return 'dense edges';
}

function motionDescription(motionEstimate: number): string {
  if (motionEstimate < 0.002) return 'static';
  if (motionEstimate < 0.01) return 'subtle motion';
  if (motionEstimate < 0.05) return 'moderate motion';
  return 'high motion';
}

/**
 * The one place the search vocabulary is defined. Both sides of the index go
 * through here — the live canvas at query time, and the rendered preview at
 * build time (scripts/build-preset-descriptions.ts) — so the two can never
 * drift into describing the same thing with different words.
 */
export function describeFrameParts(stats: FrameStats): string {
  const palette = paletteDescription(stats.histogram);
  const edges = edgeDescription(stats.edgeDensity);
  const motion = motionDescription(stats.motionEstimate);
  return `dominant ${palette}, ${edges}, ${motion}`;
}

export function describeFrame(stats: FrameStats): string {
  return describeFrameParts(stats);
}

export async function searchByFrame(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<Array<{ presetId: string; score: number }>> {
  const endpoint = resolveOptionalApiUrl('/api/visual-search');
  if (!endpoint) {
    throw new Error('Visual search API is unavailable in the Vite dev server.');
  }

  const stats = extractFrameStats(canvas);
  const description = describeFrame(stats);

  const request: VisualSearchRequest = { description };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Visual search failed: ${response.status}`);
  }

  // This caller already surfaces failures to the user, so a malformed body
  // should throw here rather than sail through as an empty result list.
  const data = VisualSearchResponseSchema.parse(await response.json());

  return data.results;
}

export function markEmbeddingsReady() {
  catalogEmbeddingsReady = true;
  if (embeddingsReadyResolve) {
    embeddingsReadyResolve();
    embeddingsReadyResolve = null;
  }
}
