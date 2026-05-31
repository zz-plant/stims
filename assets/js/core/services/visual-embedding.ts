export interface FrameStats {
  histogram: number[];
  edgeDensity: number;
  motionEstimate: number;
}

let previousPixelData: Uint8ClampedArray | null = null;
let catalogEmbeddingsReady = false;
let embeddingsReadyResolve: (() => void) | null = null;

export const embeddingsReady = new Promise<void>((resolve) => {
  if (catalogEmbeddingsReady) {
    resolve();
  } else {
    embeddingsReadyResolve = resolve;
  }
});

function histogramDistance(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i] - b[i]) / 256;
  }
  return sum / len;
}

export function extractFrameStats(canvas: HTMLCanvasElement): FrameStats {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      histogram: new Array(24).fill(0),
      edgeDensity: 0,
      motionEstimate: 0,
    };
  }

  const w = canvas.width;
  const h = canvas.height;
  const sampleStep = Math.max(1, Math.floor(Math.min(w, h) / 64));
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;

  const histogram = new Array(24).fill(0);
  let sampleCount = 0;
  let edgeDensity = 0;
  let motionEstimate = 0;

  for (let y = 0; y < h; y += sampleStep) {
    for (let x = 0; x < w; x += sampleStep) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      const rBucket = Math.min(7, r >> 5);
      const gBucket = Math.min(7, g >> 5);
      const bBucket = Math.min(7, b >> 5);

      histogram[rBucket]++;
      histogram[8 + gBucket]++;
      histogram[16 + bBucket]++;

      if (x + sampleStep < w) {
        const nextIdx = (y * w + (x + sampleStep)) * 4;
        const grayCurr = 0.299 * r + 0.587 * g + 0.114 * b;
        const grayNext =
          0.299 * pixels[nextIdx] +
          0.587 * pixels[nextIdx + 1] +
          0.114 * pixels[nextIdx + 2];
        edgeDensity += Math.abs(grayCurr - grayNext) / 255;
      }

      if (previousPixelData && idx < previousPixelData.length) {
        const pr = previousPixelData[idx];
        const pg = previousPixelData[idx + 1];
        const pb = previousPixelData[idx + 2];
        motionEstimate +=
          (Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb)) / (255 * 3);
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

  previousPixelData = new Uint8ClampedArray(pixels);

  return { histogram, edgeDensity, motionEstimate };
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
  const total = histogram.reduce((a, v) => a + v, 0);
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

export function describeFrame(stats: FrameStats): string {
  const palette = paletteDescription(stats.histogram);
  const edges = edgeDescription(stats.edgeDensity);
  const motion = motionDescription(stats.motionEstimate);
  return `dominant ${palette}, ${edges}, ${motion}`;
}

export async function searchByFrame(
  canvas: HTMLCanvasElement,
): Promise<Array<{ presetId: string; score: number }>> {
  const stats = extractFrameStats(canvas);
  const description = describeFrame(stats);

  const response = await fetch('/api/visual-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });

  if (!response.ok) {
    throw new Error(`Visual search failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    results: Array<{ presetId: string; score: number }>;
  };

  return data.results;
}

export function markEmbeddingsReady() {
  catalogEmbeddingsReady = true;
  if (embeddingsReadyResolve) {
    embeddingsReadyResolve();
    embeddingsReadyResolve = null;
  }
}
