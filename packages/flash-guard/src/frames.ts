/**
 * From pixels to flash counts.
 *
 * `analysis.ts` wants, per frame transition, how many sampled pixels in each
 * tile brightened or darkened by a qualifying amount, and the same for the
 * red-flash value. This module produces that from RGBA byte frames, which is
 * what `gl.readPixels`, `ctx.getImageData`, a video decoder or a PNG loader
 * hands you.
 *
 * Two decisions here are what make the result agree with WCAG rather than
 * merely look like it:
 *
 *   - Magnitude is decided per pixel, against the full-scale threshold,
 *     before any spatial aggregation. Averaging luminance over a tile first
 *     scales each swing down by the flashing region's coverage. On sparse
 *     bright-on-black content that pushed real flashes two orders of
 *     magnitude under the threshold and reported zero flashes corpus-wide.
 *   - Pixels are sampled on a fixed grid, so pixel N in one frame is the
 *     same screen location in the next, and every tile gets the same number
 *     of samples so the area test has one denominator.
 *
 * The sRGB transfer function is tabulated once: there are only 256 byte
 * values, and the pow() per channel per pixel per frame was what made
 * per-pixel analysis too slow to use.
 */
import {
  analyzeFlashEvents,
  type FlashAnalysis,
  type FlashCountInput,
} from './analysis.ts';
import {
  FLASH_DARKER_CEILING,
  FLASH_LUMINANCE_DELTA,
  LINEAR_CHANNEL_LUT,
  RED_FLASH_DELTA,
  RED_FLASH_SCALE,
  RED_SATURATION_MIN,
} from './thresholds.ts';

/** One frame of RGBA bytes, row-major, `width * height * 4` long or longer. */
export type RgbaFrame = Uint8Array | Uint8ClampedArray;

export type FlashFrameCounterOptions = {
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Milliseconds between consecutive frames. */
  deltaMs: number;
  /**
   * Tile grid. The visual-field window is a third of each axis in tiles, so
   * the grid should be fine enough that a window is several tiles across.
   * Defaults to 32 columns and rows in proportion to the frame's aspect.
   */
  cols?: number;
  rows?: number;
  /**
   * Sample every Nth pixel on each axis within a tile. 1 reads every pixel;
   * 3 reads a ninth of them, which is plenty for the area test and nine
   * times cheaper. Defaults to 1 for frames up to 320 px wide and 3 above.
   */
  stride?: number;
  /**
   * Whether the frame's rows run bottom-up, as `gl.readPixels` returns them.
   * Only the tile layout cares, and only for the visual-field window; counts
   * are unaffected. Defaults to false.
   */
  flipY?: boolean;
};

export type FlashFrameCounter = {
  /** Feed the next frame. Frames must all share the configured size. */
  push: (frame: RgbaFrame) => void;
  /** Everything `analyzeFlashEvents` needs, for the frames pushed so far. */
  input: () => FlashCountInput;
  /** Run the analysis on the frames pushed so far. */
  analyze: () => FlashAnalysis;
  /** Forget every frame. */
  reset: () => void;
  readonly cols: number;
  readonly rows: number;
  /** Sampled pixels per tile. */
  readonly tilePixels: number;
  /** Frames pushed since the last reset. */
  readonly frameCount: number;
};

function defaultGrid(width: number, height: number) {
  const cols = 32;
  const rows = Math.max(1, Math.round((cols * height) / width));
  return { cols, rows };
}

export function createFlashFrameCounter(
  options: FlashFrameCounterOptions,
): FlashFrameCounter {
  const { width, height, deltaMs, flipY = false } = options;
  if (!(width > 0) || !(height > 0)) {
    throw new Error(
      'createFlashFrameCounter: width and height must be positive',
    );
  }
  if (!(deltaMs > 0)) {
    throw new Error('createFlashFrameCounter: deltaMs must be positive');
  }
  const grid = defaultGrid(width, height);
  const cols = Math.max(1, Math.floor(options.cols ?? grid.cols));
  const rows = Math.max(1, Math.floor(options.rows ?? grid.rows));
  const stride = Math.max(
    1,
    Math.floor(options.stride ?? (width > 320 ? 3 : 1)),
  );
  const tileW = Math.max(1, Math.floor(width / cols));
  const tileH = Math.max(1, Math.floor(height / rows));
  const tileCount = cols * rows;

  // Sampled-pixel grid, fixed across frames. Every tile is walked with the
  // same stride from its own origin, so each gets the same sample count
  // except where the frame does not divide evenly; the shared denominator
  // below is the floor, which only ever under-reports a tile's area.
  const offsets: number[] = [];
  const sampleTile: number[] = [];
  for (let ty = 0; ty < rows; ty += 1) {
    const layoutRow = flipY ? rows - 1 - ty : ty;
    for (let tx = 0; tx < cols; tx += 1) {
      const x1 = Math.min(width, tx * tileW + tileW);
      const y1 = Math.min(height, ty * tileH + tileH);
      for (let y = ty * tileH; y < y1; y += stride) {
        for (let x = tx * tileW; x < x1; x += stride) {
          offsets.push((y * width + x) * 4);
          sampleTile.push(layoutRow * cols + tx);
        }
      }
    }
  }
  const sampleCount = offsets.length;
  const tilePixels = Math.max(1, Math.floor(sampleCount / tileCount));

  const curLum = new Float64Array(sampleCount);
  const prevLum = new Float64Array(sampleCount);
  const curRed = new Float64Array(sampleCount);
  const prevRed = new Float64Array(sampleCount);
  const curRedSat = new Uint8Array(sampleCount);
  const prevRedSat = new Uint8Array(sampleCount);

  let rising: number[][] = [];
  let falling: number[][] = [];
  let redRising: number[][] = [];
  let redFalling: number[][] = [];
  let frameMeanLuminance: number[] = [];
  let frameMeanDelta: number[] = [];
  let frameCount = 0;

  function reset() {
    rising = [];
    falling = [];
    redRising = [];
    redFalling = [];
    frameMeanLuminance = [];
    frameMeanDelta = [];
    frameCount = 0;
  }

  function push(frame: RgbaFrame) {
    if (frame.length < width * height * 4) {
      throw new Error(
        `createFlashFrameCounter: frame has ${frame.length} bytes, expected at least ${width * height * 4}`,
      );
    }
    let lumSum = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const o = offsets[i] as number;
      const r = frame[o] as number;
      const g = frame[o + 1] as number;
      const b = frame[o + 2] as number;
      const l =
        0.2126 * (LINEAR_CHANNEL_LUT[r] as number) +
        0.7152 * (LINEAR_CHANNEL_LUT[g] as number) +
        0.0722 * (LINEAR_CHANNEL_LUT[b] as number);
      curLum[i] = l;
      lumSum += l;
      curRed[i] = Math.max(0, (r - g - b) / 255) * RED_FLASH_SCALE;
      const rgbSum = r + g + b;
      curRedSat[i] = rgbSum > 0 && r / rgbSum >= RED_SATURATION_MIN ? 1 : 0;
    }
    frameMeanLuminance.push(lumSum / sampleCount);

    if (frameCount > 0) {
      const up = new Array<number>(tileCount).fill(0);
      const down = new Array<number>(tileCount).fill(0);
      const redUp = new Array<number>(tileCount).fill(0);
      const redDown = new Array<number>(tileCount).fill(0);
      let deltaSum = 0;
      for (let i = 0; i < sampleCount; i += 1) {
        const before = prevLum[i] as number;
        const after = curLum[i] as number;
        const tile = sampleTile[i] as number;
        deltaSum += Math.abs(after - before);
        if (
          Math.abs(after - before) >= FLASH_LUMINANCE_DELTA &&
          Math.min(before, after) < FLASH_DARKER_CEILING
        ) {
          if (after > before) up[tile] = (up[tile] as number) + 1;
          else down[tile] = (down[tile] as number) + 1;
        }
        const redBefore = prevRed[i] as number;
        const redAfter = curRed[i] as number;
        if (
          (prevRedSat[i] === 1 || curRedSat[i] === 1) &&
          Math.abs(redAfter - redBefore) > RED_FLASH_DELTA
        ) {
          if (redAfter > redBefore) redUp[tile] = (redUp[tile] as number) + 1;
          else redDown[tile] = (redDown[tile] as number) + 1;
        }
      }
      rising.push(up);
      falling.push(down);
      redRising.push(redUp);
      redFalling.push(redDown);
      frameMeanDelta.push(deltaSum / sampleCount);
    }

    prevLum.set(curLum);
    prevRed.set(curRed);
    prevRedSat.set(curRedSat);
    frameCount += 1;
  }

  function input(): FlashCountInput {
    return {
      rising,
      falling,
      redRising,
      redFalling,
      tilePixels,
      cols,
      rows,
      deltaMs,
      frameMeanLuminance,
      frameMeanDelta,
    };
  }

  return {
    push,
    input,
    analyze: () => analyzeFlashEvents(input()),
    reset,
    cols,
    rows,
    tilePixels,
    get frameCount() {
      return frameCount;
    },
  };
}

/** One call: RGBA frames in, `FlashAnalysis` out. */
export function analyzeRgbaFrames(
  frames: Iterable<RgbaFrame>,
  options: FlashFrameCounterOptions,
): FlashAnalysis {
  const counter = createFlashFrameCounter(options);
  for (const frame of frames) counter.push(frame);
  return counter.analyze();
}
