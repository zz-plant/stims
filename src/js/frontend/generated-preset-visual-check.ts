/**
 * In-browser near-black check for freshly generated presets.
 *
 * The Generate flow already chains compile diagnostics and the audio
 * reactivity probe; both miss a preset that compiles and "reacts" but whose
 * picture has collapsed to darkness (over-driven decay, a warp that pushes
 * everything off-screen). This is the missing render-based leg, read off
 * the live stage the preset is already playing on — no extra engine, no
 * screenshot round-trip.
 *
 * Frames are sampled on animation frames over a couple of seconds because
 * presets commonly open black and brighten in, and because the WebGL
 * drawing buffer is cleared after each tick: a read that lands outside the
 * tick that drew the frame returns a black rectangle that looks exactly
 * like a near-black preset. Retrying across several ticks is what
 * separates a dark-but-live render from a stale buffer.
 */

export type VisualCheckVerdict = 'ok' | 'near-black' | 'unknown';

/** Mean luma (0–255) at or below which a frame counts as near-black.
 * Matches the lab's definition (scripts/preset-lab-metrics.ts); the
 * constants are duplicated because the frontend cannot import scripts/. */
const NEAR_BLACK_MEAN_LUMINANCE = 2;
/** ...and at most this share of pixels may be visibly lit (> 8 luma). */
const NEAR_BLACK_VISIBLE_RATIO = 0.002;
const VISIBLE_LUMINANCE = 8;

const MAX_SAMPLES = 6;
const SAMPLE_INTERVAL_MS = 400;
const SAMPLE_DIMENSION = 64;

export type FrameLuminance = {
  meanLuminance: number;
  visiblePixelRatio: number;
};

/** Mean luma and lit-pixel share of one RGBA frame. */
export function computeFrameLuminance(
  pixels: Uint8ClampedArray | Uint8Array,
): FrameLuminance {
  const pixelCount = Math.floor(pixels.length / 4);
  if (pixelCount === 0) {
    return { meanLuminance: 0, visiblePixelRatio: 0 };
  }
  let luminanceTotal = 0;
  let visiblePixels = 0;
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    luminanceTotal += luminance;
    if (luminance > VISIBLE_LUMINANCE) {
      visiblePixels += 1;
    }
  }
  return {
    meanLuminance: luminanceTotal / pixelCount,
    visiblePixelRatio: visiblePixels / pixelCount,
  };
}

export function isNearBlackFrame(frame: FrameLuminance): boolean {
  return (
    frame.meanLuminance <= NEAR_BLACK_MEAN_LUMINANCE &&
    frame.visiblePixelRatio <= NEAR_BLACK_VISIBLE_RATIO
  );
}

/**
 * The whole-window verdict from the sampled frames: any frame with real
 * content clears the preset, all-near-black samples condemn it, and no
 * readable sample means the check has no answer (it must not be treated
 * as either a pass or a fail).
 */
export function verdictFromLuminanceSamples(
  samples: FrameLuminance[],
): VisualCheckVerdict {
  if (samples.length === 0) {
    return 'unknown';
  }
  return samples.some((frame) => !isNearBlackFrame(frame))
    ? 'ok'
    : 'near-black';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Resolve on (or after) the next animation frame, with a timeout fallback
 * for environments that do not provide requestAnimationFrame. */
function nextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return delay(0);
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Read a downscaled RGBA sample of the canvas, or null when the read is
 * impossible (no canvas, zero size, or a readback that throws). */
function sampleCanvasLuminance(
  canvas: HTMLCanvasElement,
): FrameLuminance | null {
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }
  const scale = Math.min(
    1,
    SAMPLE_DIMENSION / Math.max(sourceWidth, sourceHeight),
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = width;
  sampleCanvas.height = height;
  const context = sampleCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  if (!context) {
    return null;
  }
  try {
    context.drawImage(
      canvas,
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    const { data } = context.getImageData(0, 0, width, height);
    return computeFrameLuminance(data);
  } catch {
    return null;
  }
}

/**
 * Watch the stage a freshly loaded preset is rendering on and report
 * whether its picture ever shows visible content. Never throws: any
 * unreadable stage degrades to 'unknown', which callers treat as "no
 * verdict" rather than a failure.
 */
export async function checkStageForNearBlack(
  stage: HTMLElement | null,
): Promise<VisualCheckVerdict> {
  const canvas = stage?.querySelector('canvas');
  // A capability check rather than instanceof: the test DOM provides
  // canvases without a global HTMLCanvasElement constructor.
  if (!canvas || typeof canvas.getContext !== 'function') {
    return 'unknown';
  }
  const samples: FrameLuminance[] = [];
  for (let attempt = 0; attempt < MAX_SAMPLES; attempt += 1) {
    if (attempt > 0) {
      await delay(SAMPLE_INTERVAL_MS);
    }
    await nextAnimationFrame();
    const sample = sampleCanvasLuminance(canvas as HTMLCanvasElement);
    if (!sample) {
      continue;
    }
    samples.push(sample);
    if (!isNearBlackFrame(sample)) {
      return 'ok';
    }
  }
  return verdictFromLuminanceSamples(samples);
}
