/**
 * The WCAG 2.3.1 flash primitives, shared by every consumer that has an
 * opinion about photosensitive risk.
 *
 * These used to live in `scripts/flash-analysis.ts`, which made them
 * unreachable from `src/` — the architecture boundary allows scripts to
 * import src, not the reverse. So the runtime had no way to apply the same
 * rule the offline audit checks, and `sensory-profile.ts` kept its own copy
 * of the flashes-per-second limit. Two definitions of a safety threshold is
 * one too many.
 *
 * Everything here is pure and allocation-light on the hot path, because
 * `services/flash-governor.ts` runs it once per rendered frame.
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

/** sRGB byte -> linear-light component, per WCAG relative luminance. */
export function linearizeChannel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance from sRGB bytes. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b)
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

/** Red-flash value from sRGB bytes: max(0, R-G-B) scaled per PEAT. */
export function redFlashValue(r: number, g: number, b: number): number {
  return Math.max(0, (r - g - b) / 255) * RED_FLASH_SCALE;
}

/** Whether an sRGB byte triple is a saturated red (R/(R+G+B) >= 0.8). */
export function isSaturatedRed(r: number, g: number, b: number): boolean {
  const sum = r + g + b;
  return sum > 0 && r / sum >= RED_SATURATION_MIN;
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
export function peakWindowFraction(
  counts: readonly number[] | Float32Array | Uint32Array,
  tilePixels: number,
  cols: number,
  rows: number,
): number {
  const winW = Math.max(1, Math.round(cols * VISUAL_FIELD_FRACTION));
  const winH = Math.max(1, Math.round(rows * VISUAL_FIELD_FRACTION));
  const winPixels = winW * winH * tilePixels;
  if (winPixels <= 0 || cols <= 0 || rows <= 0) return 0;

  const sat = new Float64Array((rows + 1) * (cols + 1));
  for (let y = 0; y < rows; y += 1) {
    let rowRun = 0;
    for (let x = 0; x < cols; x += 1) {
      rowRun += counts[y * cols + x] ?? 0;
      sat[(y + 1) * (cols + 1) + (x + 1)] =
        sat[y * (cols + 1) + (x + 1)] + rowRun;
    }
  }

  let best = 0;
  for (let y = 0; y + winH <= rows; y += 1) {
    for (let x = 0; x + winW <= cols; x += 1) {
      const total =
        sat[(y + winH) * (cols + 1) + (x + winW)] -
        sat[y * (cols + 1) + (x + winW)] -
        sat[(y + winH) * (cols + 1) + x] +
        sat[y * (cols + 1) + x];
      const fraction = total / winPixels;
      if (fraction > best) best = fraction;
    }
  }
  return best;
}
