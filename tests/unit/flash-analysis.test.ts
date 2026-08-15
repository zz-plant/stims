import { describe, expect, it } from 'bun:test';
import {
  analyzeFlashEvents,
  analyzeFlashTimeline,
  isFlashTransition,
  linearizeChannel,
  relativeLuminance,
} from '../../scripts/flash-analysis.ts';

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
