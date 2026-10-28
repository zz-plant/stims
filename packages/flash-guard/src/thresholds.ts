/**
 * The WCAG 2.3.1 flash primitives, shared by every consumer that has an
 * opinion about photosensitive risk: the offline analysis, the pixel
 * frontend, the risk classifier and the live governor all read these, so
 * there is exactly one definition of each threshold.
 *
 * Everything here is pure and allocation-light on the hot path, because
 * `governor.ts` runs it once per rendered frame.
 *
 * The definitions follow WCAG's own wording. A *flash* is a pair of opposing
 * changes in relative luminance of 10% or more of maximum, where the darker
 * image is below 0.80. The threshold applies when the flashing area covers
 * more than 25% of any 10-degree visual field — NOT 25% of the screen, which
 * is why `peakWindowFraction` slides a field-sized window instead of taking
 * a whole-frame mean. More than 3 flashes in any 1-second window fails.
 *
 * These are screen-content heuristics, not a medical device. They flag
 * content worth review; they do not certify anything as safe.
 */

/** WCAG general flash threshold: >3 flashes in any 1s window fails. */
export const FLASHES_PER_SECOND_LIMIT = 3;
/**
 * Red-flash criterion (WCAG 2.3.1 via the PEAT/Harding working definition):
 * a saturated red is a color with R/(R+G+B) >= 0.8, and a transition
 * qualifies when it moves to or from a saturated red with a change in the
 * red-flash value max(0, R-G-B) * 320 greater than 20 (channels 0..1).
 */
export const RED_SATURATION_MIN = 0.8;
export const RED_FLASH_DELTA = 20;
export const RED_FLASH_SCALE = 320;
/** Luminance delta counting as a flash transition (10% of max). */
export const FLASH_LUMINANCE_DELTA = 0.1;
/** A flash only counts when the darker of the pair is below this. */
export const FLASH_DARKER_CEILING = 0.8;
/** Fraction of a 10-degree visual field that must change together. */
export const FLASH_AREA_FRACTION = 0.25;
/**
 * A 10-degree visual field at typical viewing distance covers roughly a
 * third of screen width and a third of screen height (WCAG's own worked
 * example: ~341x256px on a 1024x768 display).
 */
export const VISUAL_FIELD_FRACTION = 1 / 3;

/** sRGB-encoded value -> linear light, both 0..1. */
export function decodeSrgb(encoded: number): number {
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

/** Linear light -> sRGB-encoded value, both 0..1; inverts `decodeSrgb`. */
export function encodeSrgb(linear: number): number {
  return linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055;
}

/** sRGB byte -> linear-light component, per WCAG relative luminance. */
export function linearizeChannel(byte: number): number {
  return decodeSrgb(byte / 255);
}

/**
 * The relative luminance a viewer sees of `luminance` (linear light, 0..1)
 * through a CSS `brightness(scale)` filter, which is how the governor's
 * mitigation reaches the screen (`createBrightnessFilterApplier`, or a black
 * scrim at alpha 1 - scale, which composites the same way).
 *
 * Not `luminance * scale`. Chromium applies brightness() to sRGB-encoded
 * values, not linear light: rgb(204,204,204) under brightness(0.5)
 * screenshots as 102, where a linear-light multiply gives about 149
 * (headless Chromium, 2026-10-07). So the light reaching the viewer falls
 * roughly as the 2.2-2.4th power of the scale: brightness(0.5) leaves about
 * a fifth of it, not half. Modelled as a multiply, the governor
 * overestimated the swing left on screen, kept counting flashes the viewer
 * could no longer see, and held real strobes several times darker than the
 * threshold asks.
 *
 * Exact for grey. A colour is scaled as the grey of the same luminance,
 * which is never darker than the colour really ends up and at most 0.005
 * brighter (worst on saturated red and blue): the curve is concave, so a
 * mix of channels loses more light than their mean predicts. A swing whose
 * darker end is a saturated colour can therefore read up to 0.005 small,
 * inside the 0.02 margin the governor solves to.
 *
 * The red-flash value needs no such model: it is linear in the sRGB
 * channels, so the filter scales it by exactly `scale`.
 */
export function luminanceThroughBrightness(
  luminance: number,
  scale: number,
): number {
  if (scale >= 1) return luminance;
  if (scale <= 0) return 0;
  return decodeSrgb(scale * encodeSrgb(Math.min(1, Math.max(0, luminance))));
}

/**
 * `linearizeChannel` tabulated for every byte value. There are only 256 of
 * them, and the pow() per channel per pixel per frame is what made
 * per-pixel analysis too slow to use before this table existed.
 */
export const LINEAR_CHANNEL_LUT: Float64Array = Float64Array.from(
  { length: 256 },
  (_, byte) => linearizeChannel(byte),
);

/** WCAG relative luminance from sRGB bytes. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * (LINEAR_CHANNEL_LUT[r & 255] as number) +
    0.7152 * (LINEAR_CHANNEL_LUT[g & 255] as number) +
    0.0722 * (LINEAR_CHANNEL_LUT[b & 255] as number)
  );
}

/**
 * Whether a single tile's transition qualifies as a flash step: a large
 * enough swing, with the darker end dark enough to matter.
 */
export function isFlashTransition(before: number, after: number): boolean {
  return (
    Math.abs(after - before) >= FLASH_LUMINANCE_DELTA &&
    Math.min(before, after) < FLASH_DARKER_CEILING
  );
}

const RED_FLASH_SCALE_OVER_255 = RED_FLASH_SCALE / 255;

/** Red-flash value from sRGB bytes: max(0, R-G-B) scaled per PEAT. */
export function redFlashValue(r: number, g: number, b: number): number {
  return Math.max(0, r - g - b) * RED_FLASH_SCALE_OVER_255;
}

/** Whether an sRGB byte triple is a saturated red (R/(R+G+B) >= 0.8). */
export function isSaturatedRed(r: number, g: number, b: number): boolean {
  return r > 0 && r >= 4 * (g + b);
}

/**
 * Whether a single pixel's transition qualifies as a red-flash step: it
 * moves to or from a saturated red with a large enough change in red-flash
 * value.
 */
export function isRedFlashTransition(
  beforeValue: number,
  afterValue: number,
  beforeSaturated: boolean,
  afterSaturated: boolean,
): boolean {
  return (
    (beforeSaturated || afterSaturated) &&
    Math.abs(afterValue - beforeValue) > RED_FLASH_DELTA
  );
}

/**
 * Largest qualifying-area fraction over any 10-degree visual field.
 *
 * `counts` holds qualifying *pixels* per tile and `tilePixels` how many were
 * sampled per tile, so the window fraction is a true pixel-area ratio. A
 * summed-area table makes the slide O(tiles) rather than O(tiles * window).
 *
 * Magnitude must already have been decided per pixel by the caller:
 * averaging luminance before applying the threshold scales every swing down
 * by the flashing region's coverage, and on sparse bright-on-black content
 * that shrinks real flashes below the threshold entirely.
 */
let scratchSat = new Float64Array(0);

export function peakWindowFraction(
  counts: ArrayLike<number>,
  tilePixels: number,
  cols: number,
  rows: number,
): number {
  const winW = Math.max(1, Math.round(cols * VISUAL_FIELD_FRACTION));
  const winH = Math.max(1, Math.round(rows * VISUAL_FIELD_FRACTION));
  const winPixels = winW * winH * tilePixels;
  if (winPixels <= 0 || cols <= 0 || rows <= 0) return 0;

  const stride = cols + 1;
  const needed = (rows + 1) * stride;
  if (scratchSat.length < needed) {
    scratchSat = new Float64Array(needed);
  }
  const sat = scratchSat;
  sat.fill(0, 0, stride);
  for (let y = 0; y < rows; y += 1) {
    const prevSatRow = y * stride;
    const nextSatRow = (y + 1) * stride;
    sat[nextSatRow] = 0;
    let rowRun = 0;
    const rowOffset = y * cols;
    for (let x = 0; x < cols; x += 1) {
      rowRun += counts[rowOffset + x] ?? 0;
      sat[nextSatRow + x + 1] = (sat[prevSatRow + x + 1] as number) + rowRun;
    }
  }

  let bestTotal = 0;
  for (let y = 0; y + winH <= rows; y += 1) {
    const topRow = y * stride;
    const bottomRow = (y + winH) * stride;
    for (let x = 0; x + winW <= cols; x += 1) {
      const total =
        (sat[bottomRow + x + winW] as number) -
        (sat[topRow + x + winW] as number) -
        (sat[bottomRow + x] as number) +
        (sat[topRow + x] as number);
      if (total > bestTotal) bestTotal = total;
    }
  }
  return bestTotal / winPixels;
}
