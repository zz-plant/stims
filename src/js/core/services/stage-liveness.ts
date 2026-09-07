/**
 * Answers one question about the stage canvas: is anything visible on it?
 *
 * Attract mode mounts the engine on a bare landing arrival purely so the
 * pitch for a visuals product has visuals behind it. When that render comes
 * out blank the page is a black rectangle holding a GPU device open at full
 * frame rate, which is strictly worse than not booting at all — the visitor
 * sees the same nothing either way and pays for it in battery.
 *
 * The hard part is not measuring darkness, it is not being fooled by the
 * readback. Compositing a WebGPU canvas into a 2D canvas can yield fully
 * transparent pixels rather than the rendered frame, which reads as a
 * perfectly black image and would condemn a working render. So the alpha
 * channel is the trust signal, checked before the luminance: all-transparent
 * means "could not read this", never "nothing was drawn".
 *
 * Deliberately on-demand. Reading back a WebGPU canvas can stall the main
 * thread, so this belongs in one-off checks, never in a frame loop — the
 * per-frame flash sampler is a separate, cheaper path.
 *
 * On-demand does not mean any time. A WebGPU canvas only holds its image
 * until the end of the task that presented it, so a read from a timer or a
 * promise composites fully transparent — measured 0 of 1024 opaque pixels
 * against 1024 of 1024 for the same frame read one rAF later, while the
 * frame itself was visibly at luminance 165. That is why
 * {@link sampleStageLiveness} is async and schedules its own frame callback:
 * a synchronous read is unreadable by construction on the default backend,
 * which left the attract-mode guard permanently unable to reach a verdict.
 */

/** Longest edge of the downsample used for the readback. */
const SAMPLE_DIMENSION = 32;

/**
 * Above this (0-255) a pixel counts as showing something. Not "not pure
 * black": a preset that renders a barely-perceptible wash should still count
 * as blank for this purpose, because the visitor cannot see it either.
 */
const VISIBLE_LUMA = 8;

/** Alpha below this is treated as "not composited", not "transparent art". */
const OPAQUE_ALPHA = 8;

/**
 * A fraction of pixels this small is a lone stray sample, not an image. Set
 * against the 32x32 sample: 0.2% is under two pixels, so a single hot texel
 * cannot vouch for a frame.
 */
const VISIBLE_COVERAGE = 0.002;

export type StageLiveness = {
  /** False when the canvas could not be composited — verdict unknown. */
  readable: boolean;
  /** Something is visible on the stage. Always false when `readable` is false. */
  visible: boolean;
  maxLuma: number;
  meanLuma: number;
  /** Share of sampled pixels at or above {@link VISIBLE_LUMA}. */
  coverage: number;
};

const UNREADABLE: StageLiveness = {
  readable: false,
  visible: false,
  maxLuma: 0,
  meanLuma: 0,
  coverage: 0,
};

/**
 * The pixel maths, split out so the thresholds can be tested without a GPU.
 * `pixels` is RGBA, as returned by `getImageData`.
 */
export function summarizeStagePixels(
  pixels: Uint8ClampedArray | Uint8Array,
): StageLiveness {
  const count = Math.floor(pixels.length / 4);
  if (count === 0) {
    return UNREADABLE;
  }

  let opaquePixels = 0;
  let visiblePixels = 0;
  let maxLuma = 0;
  let lumaSum = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) >= OPAQUE_ALPHA) {
      opaquePixels += 1;
    }
    const luma =
      0.299 * (pixels[i] ?? 0) +
      0.587 * (pixels[i + 1] ?? 0) +
      0.114 * (pixels[i + 2] ?? 0);
    lumaSum += luma;
    if (luma > maxLuma) {
      maxLuma = luma;
    }
    if (luma >= VISIBLE_LUMA) {
      visiblePixels += 1;
    }
  }

  // Nothing composited: the frame was not read, so it cannot be judged.
  // Reporting this as a black frame is the trap this guard exists for.
  if (opaquePixels === 0) {
    return UNREADABLE;
  }

  const coverage = visiblePixels / count;
  return {
    readable: true,
    visible: coverage >= VISIBLE_COVERAGE,
    maxLuma,
    meanLuma: lumaSum / count,
    coverage,
  };
}

/**
 * Composite the stage canvas into a small 2D canvas and summarize it.
 *
 * Synchronous, and therefore only correct inside a frame callback — see
 * {@link sampleStageLiveness}, which is what callers should reach for.
 * Exported for the WebGL path and for tests that already own the frame.
 */
export function sampleStageLivenessNow(
  canvas: HTMLCanvasElement,
): StageLiveness {
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return UNREADABLE;
  }

  const scale = Math.min(
    1,
    SAMPLE_DIMENSION / Math.max(sourceWidth, sourceHeight),
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  try {
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return UNREADABLE;
    }
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
    return summarizeStagePixels(context.getImageData(0, 0, width, height).data);
  } catch {
    return UNREADABLE;
  }
}

/**
 * Read the stage inside a frame callback, which is the only moment a WebGPU
 * canvas can be composited. Resolves to an unreadable verdict rather than
 * rejecting, so callers keep treating "unknown" as "leave things alone".
 */
export function sampleStageLiveness(
  canvas: HTMLCanvasElement,
): Promise<StageLiveness> {
  if (typeof requestAnimationFrame !== 'function') {
    return Promise.resolve(sampleStageLivenessNow(canvas));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve(sampleStageLivenessNow(canvas));
    });
  });
}

/**
 * The attract-mode rule, as a decision rather than a measurement: retire the
 * decorative render only when *every* sample agrees it read the canvas and
 * saw nothing.
 *
 * Both halves matter. Requiring agreement means one unlucky sample — taken
 * between a preset applying and its first present — cannot condemn a working
 * render. Requiring `readable` means a browser whose canvas cannot be
 * composited back (the transparent-readback case) leaves attract mode
 * running instead of silently switching it off for everyone on that browser.
 */
export function shouldRetireAttractRender(
  samples: ReadonlyArray<StageLiveness | null>,
): boolean {
  if (samples.length === 0) {
    return false;
  }
  return samples.every(
    (sample) => sample?.readable === true && sample.visible === false,
  );
}
