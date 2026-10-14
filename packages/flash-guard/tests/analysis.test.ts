import { describe, expect, it } from 'bun:test';
import {
  analyzeFlashEvents,
  analyzeFlashTimeline,
  flashSwing,
  isFlashTransition,
  isRedFlashTransition,
  isSaturatedRed,
  linearizeChannel,
  redFlashValue,
  relativeLuminance,
} from '../src/index.ts';

const TILES = 100;
const DELTA_MS = 1000 / 60;

/** Uniform frame at a given relative luminance. */
function flat(luminance: number, tiles = TILES): number[] {
  return new Array(tiles).fill(luminance);
}

/**
 * Alternates the whole field between two luminances every `periodFrames`
 * frames — the canonical strobe used to exercise the rate threshold.
 */
function strobe(
  frameCount: number,
  periodFrames: number,
  low = 0,
  high = 1,
  litTiles = TILES,
): number[][] {
  const frames: number[][] = [];
  for (let f = 0; f < frameCount; f += 1) {
    const on = Math.floor(f / periodFrames) % 2 === 1;
    const frame = flat(low);
    if (on) {
      for (let t = 0; t < litTiles; t += 1) frame[t] = high;
    }
    frames.push(frame);
  }
  return frames;
}

describe('relative luminance', () => {
  it('maps sRGB black and white to 0 and 1', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 6);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6);
  });

  it('weights green most heavily, blue least', () => {
    const r = relativeLuminance(255, 0, 0);
    const g = relativeLuminance(0, 255, 0);
    const b = relativeLuminance(0, 0, 255);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });

  it('linearizes the low end through the linear segment', () => {
    // Below the 0.04045 knee the transfer is a plain divide by 12.92.
    expect(linearizeChannel(10)).toBeCloseTo(10 / 255 / 12.92, 8);
  });
});

describe('isFlashTransition', () => {
  it('requires at least a 10% luminance swing', () => {
    expect(isFlashTransition(0.1, 0.19)).toBe(false);
    expect(isFlashTransition(0.1, 0.21)).toBe(true);
  });

  it('ignores swings where both ends are bright', () => {
    // Big swing, but the darker end is above the 0.8 ceiling, so per WCAG
    // it is not a flash — bright-on-bright does not carry the same risk.
    expect(isFlashTransition(0.85, 0.99)).toBe(false);
  });
});

describe('analyzeFlashTimeline', () => {
  it('reports nothing for a static timeline', () => {
    const result = analyzeFlashTimeline({
      frames: Array.from({ length: 120 }, () => flat(0.5)),
      deltaMs: DELTA_MS,
    });
    expect(result.totalFlashes).toBe(0);
    expect(result.peakFlashesPerSecond).toBe(0);
    expect(result.exceedsThreshold).toBe(false);
    expect(result.motionEnergy).toBeCloseTo(0, 6);
  });

  it('does not count a monotonic fade as flashing', () => {
    // A slow ramp from black to white crosses the delta threshold many
    // times but never reverses, so there are no *opposing* pairs.
    const frames = Array.from({ length: 120 }, (_, f) => flat(f / 119));
    const result = analyzeFlashTimeline({ frames, deltaMs: DELTA_MS });
    expect(result.totalFlashes).toBe(0);
    expect(result.exceedsThreshold).toBe(false);
  });

  it('flags a fast full-field strobe', () => {
    // Alternating every frame at 60fps — far past any safe rate.
    const result = analyzeFlashTimeline({
      frames: strobe(120, 1),
      deltaMs: DELTA_MS,
    });
    expect(result.exceedsThreshold).toBe(true);
    expect(result.peakFlashesPerSecond).toBeGreaterThan(3);
  });

  it('passes a slow strobe under the 3/second limit', () => {
    // Flip every 30 frames at 60fps = 2 direction changes per second.
    const result = analyzeFlashTimeline({
      frames: strobe(300, 30),
      deltaMs: DELTA_MS,
    });
    expect(result.peakFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(result.exceedsThreshold).toBe(false);
  });

  it('ignores a fast strobe confined to a small area', () => {
    // Same aggressive rate, but only 10% of the field participates —
    // below the 25% area threshold, so it must not be flagged.
    const result = analyzeFlashTimeline({
      frames: strobe(120, 1, 0, 1, 10),
      deltaMs: DELTA_MS,
    });
    expect(result.exceedsThreshold).toBe(false);
    expect(result.totalFlashes).toBe(0);
  });

  it('catches a flash that fills a 10-degree field but little of the screen', () => {
    // Regression: WCAG's area exemption is "25% of any 10 degree visual
    // field", a sliding local window — not 25% of the whole screen. A
    // region that strobes at full contrast while covering ~11% of the
    // display fails the standard, but a screen-wide fraction test scores
    // it as safe. False negatives are the dangerous direction here.
    const COLS = 30;
    const ROWS = 18;
    const TOTAL = COLS * ROWS;
    // Fill a 10x6 block in the corner — exactly a 10-degree window at
    // VISUAL_FIELD_FRACTION = 1/3, but only 11% of the whole grid.
    const frames: number[][] = [];
    for (let f = 0; f < 120; f += 1) {
      const on = f % 2 === 1;
      const frame = new Array(TOTAL).fill(0);
      if (on) {
        for (let y = 0; y < 6; y += 1) {
          for (let x = 0; x < 10; x += 1) frame[y * COLS + x] = 1;
        }
      }
      frames.push(frame);
    }
    const litShare = 60 / TOTAL;
    expect(litShare).toBeLessThan(0.25);

    // Screen-wide test (no grid shape supplied) misses it entirely...
    const screenWide = analyzeFlashTimeline({ frames, deltaMs: DELTA_MS });
    expect(screenWide.exceedsThreshold).toBe(false);

    // ...the 10-degree-field test catches it.
    const localised = analyzeFlashTimeline({
      frames,
      deltaMs: DELTA_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(localised.exceedsThreshold).toBe(true);
    expect(localised.peakFlashesPerSecond).toBeGreaterThan(3);
  });

  it('counts a strobe that just clears the area threshold', () => {
    const result = analyzeFlashTimeline({
      frames: strobe(120, 1, 0, 1, 30),
      deltaMs: DELTA_MS,
    });
    expect(result.exceedsThreshold).toBe(true);
  });

  it('ignores a bright-on-bright strobe', () => {
    // Rapid, full-field, but never drops below the 0.8 darker-ceiling.
    const result = analyzeFlashTimeline({
      frames: strobe(120, 1, 0.85, 1),
      deltaMs: DELTA_MS,
    });
    expect(result.totalFlashes).toBe(0);
    expect(result.exceedsThreshold).toBe(false);
  });

  it('separates volatility from raw motion energy', () => {
    // The distinction the whole sensory-metadata idea hinges on: two
    // timelines with comparable total movement, one predictable and one
    // erratic. A steady ramp moves every frame by the same amount, so its
    // frame-delta spread is ~0 however fast it moves.
    const steady = analyzeFlashTimeline({
      frames: Array.from({ length: 120 }, (_, f) => flat(f / 119)),
      deltaMs: DELTA_MS,
    });
    expect(steady.motionEnergy).toBeGreaterThan(0);
    expect(steady.luminanceVolatility).toBeCloseTo(0, 6);

    // Same mean movement, delivered in irregular bursts: identical
    // motionEnergy, much higher volatility.
    const bursts: number[][] = [];
    let level = 0;
    for (let f = 0; f < 120; f += 1) {
      // Move in a lumpy 0 / 0 / big pattern rather than smoothly.
      if (f % 3 === 2) level += (steady.motionEnergy * 3) / 1;
      bursts.push(flat(Math.min(1, level)));
    }
    const erratic = analyzeFlashTimeline({
      frames: bursts,
      deltaMs: DELTA_MS,
    });
    expect(erratic.luminanceVolatility).toBeGreaterThan(
      steady.luminanceVolatility,
    );
  });

  it('handles degenerate input without throwing', () => {
    expect(
      analyzeFlashTimeline({ frames: [], deltaMs: DELTA_MS }).frameCount,
    ).toBe(0);
    expect(
      analyzeFlashTimeline({ frames: [flat(0.5)], deltaMs: DELTA_MS })
        .totalFlashes,
    ).toBe(0);
    expect(
      analyzeFlashTimeline({ frames: strobe(60, 1), deltaMs: 0 }).totalFlashes,
    ).toBe(0);
  });
});

describe('analyzeFlashEvents (per-pixel magnitude, area aggregated after)', () => {
  const COLS = 30;
  const ROWS = 18;
  const TILES = COLS * ROWS;
  const TILE_PIXELS = 100;

  /** Alternating rising/falling transitions, `perTile` pixels per tile. */
  function alternating(transitions: number, perTile: number, tilesLit = TILES) {
    const rising: number[][] = [];
    const falling: number[][] = [];
    for (let f = 0; f < transitions; f += 1) {
      const up = new Array(TILES).fill(0);
      const down = new Array(TILES).fill(0);
      const target = f % 2 === 0 ? up : down;
      for (let t = 0; t < tilesLit; t += 1) target[t] = perTile;
      rising.push(up);
      falling.push(down);
    }
    return { rising, falling };
  }

  it('flags a full-field strobe', () => {
    const { rising, falling } = alternating(120, TILE_PIXELS);
    const r = analyzeFlashEvents({
      rising,
      falling,
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.exceedsThreshold).toBe(true);
    expect(r.peakFlashesPerSecond).toBeGreaterThan(3);
  });

  it('detects a flash whose pixels are sparse within each tile', () => {
    // The v3 regression, reproduced: a genuine full-amplitude flash that
    // covers 30% of the pixels inside its tiles. Averaging luminance per
    // tile first would scale a 1.0 swing down to 0.3 and then to ~0.003
    // on a dark preset, sinking it far below the 0.1 threshold and
    // reporting zero flashes. Qualifying per pixel and aggregating area
    // afterwards keeps the swing intact, so 30% area still reads as 30%.
    const perTile = Math.round(TILE_PIXELS * 0.3);
    const { rising, falling } = alternating(120, perTile);
    const r = analyzeFlashEvents({
      rising,
      falling,
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.exceedsThreshold).toBe(true);
  });

  it('still respects the 25% area floor', () => {
    // 20% of pixels flashing is below the threshold and must not flag,
    // however fast it alternates.
    const perTile = Math.round(TILE_PIXELS * 0.2);
    const { rising, falling } = alternating(120, perTile);
    const r = analyzeFlashEvents({
      rising,
      falling,
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.exceedsThreshold).toBe(false);
    expect(r.totalFlashes).toBe(0);
  });

  it('catches a flash filling one 10-degree field but little of the screen', () => {
    // Full-amplitude across a 10x6 tile block only — 11% of the screen.
    const rising: number[][] = [];
    const falling: number[][] = [];
    for (let f = 0; f < 120; f += 1) {
      const up = new Array(TILES).fill(0);
      const down = new Array(TILES).fill(0);
      const target = f % 2 === 0 ? up : down;
      for (let y = 0; y < 6; y += 1) {
        for (let x = 0; x < 10; x += 1) target[y * COLS + x] = TILE_PIXELS;
      }
      rising.push(up);
      falling.push(down);
    }
    const r = analyzeFlashEvents({
      rising,
      falling,
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.exceedsThreshold).toBe(true);
  });

  it('does not treat a monotonic ramp as flashing', () => {
    // Only ever brightens — no opposing pair, so no flash.
    const rising = Array.from({ length: 120 }, () =>
      new Array(TILES).fill(TILE_PIXELS),
    );
    const falling = Array.from({ length: 120 }, () => new Array(TILES).fill(0));
    const r = analyzeFlashEvents({
      rising,
      falling,
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.totalFlashes).toBe(0);
    expect(r.exceedsThreshold).toBe(false);
  });

  it('passes through reporting stats and handles empty input', () => {
    const r = analyzeFlashEvents({
      rising: [],
      falling: [],
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
      frameMeanLuminance: [0.2, 0.4],
      frameMeanDelta: [0.1, 0.3],
    });
    expect(r.totalFlashes).toBe(0);
    expect(r.meanLuminance).toBeCloseTo(0.3, 6);
    expect(r.motionEnergy).toBeCloseTo(0.2, 6);
  });
});

describe('maxFlashLuminanceDelta: the swing of the strongest flash', () => {
  // A 9x9 grid: the visual-field window is 3x3 tiles, and 3 of its 9 tiles
  // are enough to cover a quarter of it.
  const COLS = 9;
  const ROWS = 9;
  /** A strobe in which tile t swings between `low[t]` and `high[t]`. */
  function tileStrobe(low: number[], high: number[], frames = 60) {
    return Array.from({ length: frames }, (_, f) =>
      Math.floor(f / 3) % 2 === 1 ? high : low,
    );
  }
  const analyse = (frames: number[][]) =>
    analyzeFlashTimeline({ frames, deltaMs: DELTA_MS, cols: COLS, rows: ROWS });
  /** Tiles of the top-left visual field, the first `n` of its nine. */
  const field = (n: number) => [0, 1, 2, 9, 10, 11, 18, 19, 20].slice(0, n);

  it('is the full contrast of a full-field strobe', () => {
    const result = analyse(tileStrobe(flat(0.1, 81), flat(0.8, 81)));
    expect(result.exceedsThreshold).toBe(true);
    expect(result.maxFlashLuminanceDelta).toBeCloseTo(0.7, 3);
  });

  it('is what a quarter of a visual field swung together, not one bright tile', () => {
    // Three tiles of one field swing 0.4; a lone tile elsewhere swings 0.9.
    // The lone tile is a ninth of any field it sits in, so it is not what
    // made these frames flash, and a clamp sized for it would be 2.25x too
    // hard.
    const low = flat(0.05, 81);
    const high = flat(0.05, 81);
    for (const t of field(3)) high[t] = 0.45;
    high[80] = 0.95;
    const result = analyse(tileStrobe(low, high));
    expect(result.exceedsThreshold).toBe(true);
    expect(result.maxFlashLuminanceDelta).toBeCloseTo(0.4, 3);
  });

  it('is the largest swing that still covers a quarter, when swings differ', () => {
    // Two tiles swing 0.8 and three more 0.3, all in one field: only the 0.3
    // swing is shared by a quarter of the field.
    const low = flat(0.05, 81);
    const high = flat(0.05, 81);
    const [a, b, ...rest] = field(5);
    high[a as number] = 0.85;
    high[b as number] = 0.85;
    for (const t of rest) high[t] = 0.35;
    expect(analyse(tileStrobe(low, high)).maxFlashLuminanceDelta).toBeCloseTo(
      0.3,
      3,
    );
  });

  it('is not the volatility, which shrinks with the share that flashed', () => {
    const low = flat(0.05, 81);
    const high = flat(0.05, 81);
    for (const t of field(9)) high[t] = 0.85;
    const result = analyse(tileStrobe(low, high));
    expect(result.maxFlashLuminanceDelta).toBeCloseTo(0.8, 3);
    expect(result.luminanceVolatility).toBeLessThan(0.1);
  });

  it('is 0 for content that never flashes, however large its steps', () => {
    const step = Array.from({ length: 60 }, (_, f) => flat(f < 30 ? 0 : 1, 81));
    const result = analyse(step);
    expect(result.totalFlashes).toBe(0);
    expect(result.maxFlashLuminanceDelta).toBe(0);
  });

  it('is 0 from per-pixel counts that carry no swings', () => {
    const counts = (on: boolean) => new Array(81).fill(on ? 1 : 0);
    const rising = Array.from({ length: 59 }, (_, f) => counts(f % 2 === 0));
    const falling = Array.from({ length: 59 }, (_, f) => counts(f % 2 === 1));
    const result = analyzeFlashEvents({
      rising,
      falling,
      tilePixels: 1,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(result.exceedsThreshold).toBe(true);
    expect(result.maxFlashLuminanceDelta).toBe(0);
  });

  it('flashSwing answers 0 when the qualifying samples cover too little', () => {
    const swings = new Array(81).fill(0);
    for (const t of field(2)) swings[t] = 0.9;
    const tileOf = Array.from({ length: 81 }, (_, t) => t);
    expect(flashSwing(swings, tileOf, true, 1, COLS, ROWS)).toBe(0);
    swings[field(3)[2] as number] = 0.9;
    expect(flashSwing(swings, tileOf, true, 1, COLS, ROWS)).toBeCloseTo(0.9, 3);
    // Darkening samples are a different direction.
    expect(flashSwing(swings, tileOf, false, 1, COLS, ROWS)).toBe(0);
  });
});

describe('red flash criterion', () => {
  const COLS = 30;
  const ROWS = 18;
  const TILES = COLS * ROWS;
  const TILE_PIXELS = 100;

  it('computes red-flash value and saturation from sRGB bytes', () => {
    // Pure saturated red: value = (255-0-0)/255 * 320 = 320.
    expect(redFlashValue(255, 0, 0)).toBeCloseTo(320, 6);
    expect(isSaturatedRed(255, 0, 0)).toBe(true);
    // White: R-G-B negative -> clamped to 0, and not saturated.
    expect(redFlashValue(255, 255, 255)).toBe(0);
    expect(isSaturatedRed(255, 255, 255)).toBe(false);
    // Dark screen: no division blow-up on black.
    expect(isSaturatedRed(0, 0, 0)).toBe(false);
    // 80% red share exactly meets the saturation floor.
    expect(isSaturatedRed(200, 25, 25)).toBe(true);
  });

  it('qualifies transitions only to or from saturated red with enough swing', () => {
    const red = redFlashValue(255, 0, 0);
    const black = redFlashValue(0, 0, 0);
    expect(isRedFlashTransition(black, red, false, true)).toBe(true);
    expect(isRedFlashTransition(red, black, true, false)).toBe(true);
    // Large luminance swing between unsaturated colors is not a red flash.
    expect(isRedFlashTransition(0, 0, false, false)).toBe(false);
    // Saturated red endpoints but a tiny value change stays under the
    // delta floor.
    expect(isRedFlashTransition(300, 310, true, true)).toBe(false);
  });

  function alternatingRed(transitions: number, perTile: number) {
    const zero = () => new Array(TILES).fill(0);
    const redRising: number[][] = [];
    const redFalling: number[][] = [];
    const rising: number[][] = [];
    const falling: number[][] = [];
    for (let f = 0; f < transitions; f += 1) {
      const up = zero();
      const down = zero();
      const target = f % 2 === 0 ? up : down;
      for (let t = 0; t < TILES; t += 1) target[t] = perTile;
      redRising.push(up);
      redFalling.push(down);
      // No general-flash pixels: a black<->red strobe can stay under the
      // luminance delta while failing the red criterion.
      rising.push(zero());
      falling.push(zero());
    }
    return { rising, falling, redRising, redFalling };
  }

  it('flags a red strobe that the luminance criterion alone would miss', () => {
    const { rising, falling, redRising, redFalling } = alternatingRed(
      120,
      TILE_PIXELS,
    );
    const r = analyzeFlashEvents({
      rising,
      falling,
      redRising,
      redFalling,
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.exceedsThreshold).toBe(false);
    expect(r.exceedsRedThreshold).toBe(true);
    expect(r.peakRedFlashesPerSecond).toBeGreaterThan(3);
  });

  it('keeps sparse red flashing under the 25% area floor unflagged', () => {
    const perTile = Math.round(TILE_PIXELS * 0.2);
    const { rising, falling, redRising, redFalling } = alternatingRed(
      120,
      perTile,
    );
    const r = analyzeFlashEvents({
      rising,
      falling,
      redRising,
      redFalling,
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.exceedsRedThreshold).toBe(false);
    expect(r.totalRedFlashes).toBe(0);
  });

  it('reports zero red metrics when the capture path has no color data', () => {
    const r = analyzeFlashEvents({
      rising: [new Array(TILES).fill(TILE_PIXELS)],
      falling: [new Array(TILES).fill(0)],
      tilePixels: TILE_PIXELS,
      cols: COLS,
      rows: ROWS,
      deltaMs: DELTA_MS,
    });
    expect(r.peakRedFlashesPerSecond).toBe(0);
    expect(r.exceedsRedThreshold).toBe(false);
  });
});
