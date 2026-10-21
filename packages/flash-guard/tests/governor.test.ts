/**
 * The runtime flash governor, judged by the offline WCAG analyser.
 *
 * The claim this suite has to earn is specific: a sequence that FAILS
 * WCAG 2.3.1 when presented raw must PASS once the governor's hold is
 * applied. So the governed frames are scored by `analyzeFlashTimeline` —
 * the same instrument `bun run lab:flash-audit` uses — rather than by
 * re-asserting the governor's own bookkeeping, which would only prove it
 * agrees with itself.
 *
 * The false-positive direction matters just as much: content that is merely
 * bright, fast, or high-contrast-but-monotonic must never be held back, or
 * the governor becomes a blur filter nobody wants.
 */
import { describe, expect, test } from 'bun:test';
import {
  analyzeFlashEvents,
  analyzeFlashTimeline,
  analyzeRgbaFrames,
  createFlashGovernor,
  FLASH_LUMINANCE_DELTA,
  isFlashTransition,
  isSaturatedRed,
  luminanceThroughBrightness,
  MIN_USEFUL_GRID,
  primingHoldForMeasurement,
  RECOMMENDED_GRID,
  RECOMMENDED_SAMPLE_DENSITY,
  RED_FLASH_DELTA,
  redFlashValue,
  relativeLuminance,
} from '../src/index.ts';

const COLS = 6;
const ROWS = 6;
const TILES = COLS * ROWS;
const FRAME_MS = 1000 / 60;

function uniformFrame(luminance: number): number[] {
  return new Array(TILES).fill(luminance);
}

/** Full-field strobe: flips between `low` and `high` every `holdFrames`. */
function strobeTimeline(
  frameCount: number,
  holdFrames: number,
  low = 0.02,
  high = 0.95,
): number[][] {
  const frames: number[][] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const on = Math.floor(i / holdFrames) % 2 === 1;
    frames.push(uniformFrame(on ? high : low));
  }
  return frames;
}

/**
 * Runs a timeline through the governor the way a canvas under a CSS
 * brightness filter shows it, and returns what the viewer sees. The governor
 * samples each frame as drawn (readback happens before the filter) with the
 * filter that frame is shown through, and its decision sets the filter for
 * the frames after it. The filter scales sRGB-encoded values, so the
 * presented luminance goes through `luminanceThroughBrightness`, not a
 * multiply.
 */
function present(
  source: number[][],
  governor: ReturnType<typeof createFlashGovernor>,
): number[][] {
  const presented: number[][] = [];
  let scale = 1;
  for (const [index, frame] of source.entries()) {
    presented.push(frame.map((v) => luminanceThroughBrightness(v, scale)));
    scale = governor.sample(index * FRAME_MS, frame, COLS, ROWS, {
      viewScale: scale,
    }).luminanceScale;
  }
  return presented;
}

/** A swing from `low` to `high` as the viewer sees it through brightness(k). */
function swingThrough(low: number, high: number, k: number): number {
  return (
    luminanceThroughBrightness(high, k) - luminanceThroughBrightness(low, k)
  );
}

/** The brightness() factor at which that swing, on screen, is `swing`. */
function scaleForSwing(low: number, high: number, swing: number): number {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 40; step += 1) {
    const mid = (lo + hi) / 2;
    if (swingThrough(low, high, mid) < swing) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe('the brightness filter model', () => {
  test('is the filter Chromium applies, on sRGB values', () => {
    // Measured in headless Chromium: rgb(204,204,204) under brightness(0.5)
    // screenshots as rgb(102,102,102). A linear-light multiply would leave
    // more than twice that luminance on screen.
    const grey = relativeLuminance(204, 204, 204);
    const shown = relativeLuminance(102, 102, 102);
    expect(luminanceThroughBrightness(grey, 0.5)).toBeCloseTo(shown, 6);
    expect(grey * 0.5).toBeGreaterThan(2 * shown);
  });

  test('never models a colour darker than the filter leaves it', () => {
    // Scaled as the grey of the same luminance: the curve is concave, so the
    // model errs bright, and by little. Exact per channel is the reference:
    // the filter scales each sRGB byte.
    const linear = (byte: number) => {
      const c = byte / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const exact = (r: number, g: number, b: number) =>
      0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    for (const [r, g, b] of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 128, 0],
    ] as const) {
      for (const scale of [0.3, 0.5, 0.8]) {
        const modelled = luminanceThroughBrightness(exact(r, g, b), scale);
        const actual = exact(r * scale, g * scale, b * scale);
        expect(modelled).toBeGreaterThanOrEqual(actual - 1e-9);
        expect(modelled - actual).toBeLessThan(0.006);
      }
    }
  });
});

describe('flash governor', () => {
  test('a 10Hz full-field strobe fails WCAG when presented raw', () => {
    const raw = strobeTimeline(180, 3);
    const analysis = analyzeFlashTimeline({
      frames: raw,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.peakFlashesPerSecond).toBeGreaterThan(3);
    expect(analysis.exceedsThreshold).toBe(true);
  });

  test('the same strobe passes WCAG once the governor dims it', () => {
    const raw = strobeTimeline(180, 3);
    const governed = present(raw, createFlashGovernor());
    const analysis = analyzeFlashTimeline({
      frames: governed,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.peakFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(analysis.exceedsThreshold).toBe(false);
  });

  test('a faster 20Hz strobe is also brought under the threshold', () => {
    const raw = strobeTimeline(180, 1);
    const rawAnalysis = analyzeFlashTimeline({
      frames: raw,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(rawAnalysis.exceedsThreshold).toBe(true);

    const governed = present(raw, createFlashGovernor());
    const analysis = analyzeFlashTimeline({
      frames: governed,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.exceedsThreshold).toBe(false);
  });

  test('a full-field strobe is held where its on-screen swing just clears the margin', () => {
    // The filter scales sRGB-encoded values, so the light left on screen
    // falls roughly as the 2.4th power of the factor. Taken as a multiply, a
    // 0.02-to-0.95 strobe needs brightness(0.086) to bring its 0.93 swing to
    // the 0.08 the solve aims for, and on screen that leaves 0.007: a
    // twelfth of the target. Taken as the filter works, it needs 0.33.
    const [low, high] = [0.02, 0.95];
    const safetyMargin = 0.8;
    const target = FLASH_LUMINANCE_DELTA * safetyMargin;
    const governor = createFlashGovernor({ safetyMargin });
    let scale = 1;
    let darkest = 1;
    for (let i = 0; i < 600; i += 1) {
      const raw = Math.floor(i / 3) % 2 === 1 ? high : low;
      scale = governor.sample(i * FRAME_MS, uniformFrame(raw), COLS, ROWS, {
        viewScale: scale,
      }).luminanceScale;
      darkest = Math.min(darkest, scale);
    }
    expect(swingThrough(low, high, darkest)).toBeLessThan(target);
    expect(swingThrough(low, high, darkest)).toBeGreaterThan(target - 0.002);
    expect(darkest).toBeGreaterThan((3 * target) / (high - low));
  });

  test('luminanceScale is the complement of hold', () => {
    const governor = createFlashGovernor();
    for (const [index, frame] of strobeTimeline(120, 3).entries()) {
      const decision = governor.sample(index * FRAME_MS, frame, COLS, ROWS);
      expect(decision.luminanceScale).toBeCloseTo(1 - decision.hold, 10);
    }
  });

  test('a monotonic fade is never held back', () => {
    const governor = createFlashGovernor();
    let maxHold = 0;
    for (let i = 0; i < 120; i += 1) {
      const { hold } = governor.sample(
        i * FRAME_MS,
        uniformFrame(i / 119),
        COLS,
        ROWS,
      );
      maxHold = Math.max(maxHold, hold);
    }
    // A fade to white crosses every luminance threshold there is, but never
    // reverses, so it is not a flash and must not be treated as one.
    expect(maxHold).toBe(0);
  });

  test('a steady bright image is never held back', () => {
    const governor = createFlashGovernor();
    let maxHold = 0;
    for (let i = 0; i < 120; i += 1) {
      const { hold } = governor.sample(
        i * FRAME_MS,
        uniformFrame(0.9),
        COLS,
        ROWS,
      );
      maxHold = Math.max(maxHold, hold);
    }
    expect(maxHold).toBe(0);
  });

  test('a small flashing region does not trip the governor at the recommended grid', () => {
    // At RECOMMENDED_GRID the field window is 5x5 tiles, so one strobing
    // tile is 4% of it — a sparkle, not a quarter of the visual field.
    const grid = RECOMMENDED_GRID;
    const governor = createFlashGovernor();
    let maxHold = 0;
    for (let i = 0; i < 120; i += 1) {
      const frame = new Array(grid * grid).fill(0.1);
      frame[0] = i % 2 === 0 ? 0.02 : 0.95;
      maxHold = Math.max(
        maxHold,
        governor.sample(i * FRAME_MS, frame, grid, grid).hold,
      );
    }
    expect(maxHold).toBe(0);
  });

  test('too coarse a grid cannot discriminate a single tile — hence MIN_USEFUL_GRID', () => {
    // Documents WHY the constant exists rather than asserting a magic
    // number: below it, the field window shrinks until one tile alone meets
    // the 25% area rule and every isolated flicker reads as a full flash.
    const coarse = 6;
    expect(coarse).toBeLessThan(MIN_USEFUL_GRID);
    const governor = createFlashGovernor();
    let tripped = false;
    for (let i = 0; i < 60; i += 1) {
      const frame = new Array(coarse * coarse).fill(0.1);
      frame[0] = i % 2 === 0 ? 0.02 : 0.95;
      if (governor.sample(i * FRAME_MS, frame, coarse, coarse).hold > 0) {
        tripped = true;
      }
    }
    expect(tripped).toBe(true);

    // The same content at the recommended grid does not trip it.
    const fine = createFlashGovernor();
    let fineTripped = false;
    for (let i = 0; i < 60; i += 1) {
      const frame = new Array(RECOMMENDED_GRID * RECOMMENDED_GRID).fill(0.1);
      frame[0] = i % 2 === 0 ? 0.02 : 0.95;
      if (
        fine.sample(i * FRAME_MS, frame, RECOMMENDED_GRID, RECOMMENDED_GRID)
          .hold > 0
      ) {
        fineTripped = true;
      }
    }
    expect(fineTripped).toBe(false);
  });

  describe('judged per sample, as the offline analysis judges per pixel', () => {
    const DENSITY = RECOMMENDED_SAMPLE_DENSITY;
    const EDGE = RECOMMENDED_GRID * DENSITY;

    /** Deterministic PRNG, so the texture is the same on every run. */
    function mulberry32(seed: number) {
      let a = seed;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /**
     * Fine twinkling texture over the whole frame: each sample toggles
     * between dark and bright with probability 0.36 a frame, so about 18% of
     * any visual field brightens and 18% darkens on every frame. Each swing
     * is a full 0.5, but neither direction ever reaches 25% of a field, so
     * WCAG counts no flash at all. Fine moving detail in a MilkDrop preset
     * (Shifter - Curlique) is this, measured.
     *
     * A field is 16,384 samples, so this and `auditFields` use plain loops:
     * `.map` / `Float32Array.from` callbacks cost several times as much.
     */
    function twinkleFields(frames: number): Float32Array[] {
      const random = mulberry32(7);
      const bright = new Uint8Array(EDGE * EDGE);
      for (let i = 0; i < bright.length; i += 1) {
        bright[i] = random() < 0.5 ? 1 : 0;
      }
      const out: Float32Array[] = [];
      for (let f = 0; f < frames; f += 1) {
        const field = new Float32Array(bright.length);
        for (let i = 0; i < bright.length; i += 1) {
          if (random() < 0.36) bright[i] = 1 - (bright[i] as number);
          field[i] = bright[i] ? 0.6 : 0.1;
        }
        out.push(field);
      }
      return out;
    }

    /**
     * Two seconds of texture, built once and read by both tests: two full
     * WCAG windows. Every break tried that makes the governor hold on it
     * (ignoring the density option, counting a tile as `density` samples
     * rather than `density` squared, an area threshold of 0.2 or 0.21) does
     * so within 18 frames. The tests are CPU-bound, so frames past that only
     * add time on a loaded gate, where 300 of them outran bun's 5 s timeout.
     */
    let twinkle: Float32Array[] | null = null;
    const sharedTwinkle = () => {
      twinkle ??= twinkleFields(120);
      return twinkle;
    };

    /** The offline analysis's per-pixel counts for the same fields. */
    function auditFields(fields: Float32Array[]) {
      const tileOf = new Uint16Array(EDGE * EDGE);
      for (let i = 0; i < tileOf.length; i += 1) {
        const x = i % EDGE;
        const y = Math.floor(i / EDGE);
        tileOf[i] =
          Math.floor(y / DENSITY) * RECOMMENDED_GRID + Math.floor(x / DENSITY);
      }
      const rising: Uint16Array[] = [];
      const falling: Uint16Array[] = [];
      for (let f = 1; f < fields.length; f += 1) {
        const up = new Uint16Array(RECOMMENDED_GRID ** 2);
        const down = new Uint16Array(RECOMMENDED_GRID ** 2);
        const before = fields[f - 1] as Float32Array;
        const after = fields[f] as Float32Array;
        for (let i = 0; i < after.length; i += 1) {
          const b = before[i] as number;
          const a = after[i] as number;
          if (!isFlashTransition(b, a)) continue;
          const tile = tileOf[i] as number;
          if (a > b) up[tile] = (up[tile] as number) + 1;
          else down[tile] = (down[tile] as number) + 1;
        }
        rising.push(up);
        falling.push(down);
      }
      return analyzeFlashEvents({
        rising,
        falling,
        tilePixels: DENSITY * DENSITY,
        cols: RECOMMENDED_GRID,
        rows: RECOMMENDED_GRID,
        deltaMs: FRAME_MS,
      });
    }

    /** One sample at the centre of each tile: what the 16x16 read was. */
    function tileCentres(field: Float32Array): Float32Array {
      const out = new Float32Array(RECOMMENDED_GRID ** 2);
      const mid = Math.floor(DENSITY / 2);
      for (let ty = 0; ty < RECOMMENDED_GRID; ty += 1) {
        for (let tx = 0; tx < RECOMMENDED_GRID; tx += 1) {
          out[ty * RECOMMENDED_GRID + tx] = field[
            (ty * DENSITY + mid) * EDGE + tx * DENSITY + mid
          ] as number;
        }
      }
      return out;
    }

    test('texture the offline analysis passes never engages the governor', () => {
      const fields = sharedTwinkle();
      expect(auditFields(fields).totalFlashes).toBe(0);

      const governor = createFlashGovernor();
      let maxHold = 0;
      for (const [index, field] of fields.entries()) {
        const { hold } = governor.sample(
          index * FRAME_MS,
          field,
          RECOMMENDED_GRID,
          RECOMMENDED_GRID,
          { density: DENSITY },
        );
        maxHold = Math.max(maxHold, hold);
      }
      expect(maxHold).toBe(0);
    });

    test('one sample per tile reads the same texture as flashing — hence the density', () => {
      // 25 samples per visual field, and the worst of 144 fields: some
      // field always has 7 of its 25 samples swinging the same way.
      const governor = createFlashGovernor();
      let maxHold = 0;
      for (const [index, field] of sharedTwinkle().entries()) {
        const { hold } = governor.sample(
          index * FRAME_MS,
          tileCentres(field),
          RECOMMENDED_GRID,
          RECOMMENDED_GRID,
        );
        maxHold = Math.max(maxHold, hold);
      }
      expect(maxHold).toBeGreaterThan(0.5);
    });

    test('a strobe covering a visual field still engages it', () => {
      // A 6x6-tile patch, bigger than the 5x5 field window, strobing at
      // 5Hz over a dim background: what the density must not dilute.
      const governor = createFlashGovernor();
      let flashes = 0;
      for (let f = 0; f < 120; f += 1) {
        const on = Math.floor(f / 6) % 2 === 1;
        const field = new Float32Array(EDGE * EDGE).fill(0.05);
        for (let y = 0; y < 6 * DENSITY; y += 1) {
          for (let x = 0; x < 6 * DENSITY; x += 1) {
            field[y * EDGE + x] = on ? 0.9 : 0.05;
          }
        }
        const decision = governor.sample(
          f * FRAME_MS,
          field,
          RECOMMENDED_GRID,
          RECOMMENDED_GRID,
          { density: DENSITY },
        );
        if (decision.flashed) flashes += 1;
      }
      expect(flashes).toBeGreaterThan(1);
      expect(governor.getState().engaged).toBe(true);
    });
  });

  test('the clamp is solved from the flashing area, not one bright outlier', () => {
    // A 6x6-tile patch swings 0.05 to 0.35 at 5Hz while a single tile
    // elsewhere swings 0.05 to 0.95 with it. The patch is what makes these
    // frames a flash, and brightness(0.55) puts it under the solve's target.
    // Solving for the outlier instead asks for 0.33 and dims the whole stage
    // for one tile.
    const grid = RECOMMENDED_GRID;
    const governor = createFlashGovernor();
    let engagedAt: number | null = null;
    for (let f = 0; f < 120 && engagedAt === null; f += 1) {
      const on = Math.floor(f / 6) % 2 === 1;
      const frame = new Array(grid * grid).fill(0.05);
      for (let y = 0; y < 6; y += 1) {
        for (let x = 0; x < 6; x += 1) frame[y * grid + x] = on ? 0.35 : 0.05;
      }
      frame[grid * grid - 1] = on ? 0.95 : 0.05;
      const decision = governor.sample(f * FRAME_MS, frame, grid, grid);
      if (decision.engaged) engagedAt = decision.luminanceScale;
    }
    expect(engagedAt).not.toBeNull();
    expect(engagedAt as number).toBeGreaterThan(0.45);
    // And it is enough: the patch's swing, as the filter leaves it on
    // screen, no longer qualifies.
    expect(swingThrough(0.05, 0.35, engagedAt as number)).toBeLessThan(
      FLASH_LUMINANCE_DELTA,
    );
  });

  test('the clamp holds the strongest transition of the last second, not just the one that engaged it', () => {
    // A full-field 0.05-to-0.9 flash, then a weak rise (a patch to 0.35)
    // completes the second flash and engages the clamp, then the full-field
    // swing returns. Solved for the weak rise alone the clamp was
    // brightness(0.55), and the full-field transitions that followed in the
    // same second read as two more flashes on screen: 5 in a second. Held
    // for the strongest transition the content made in that second, the
    // clamp is 0.34: under the limit, and nowhere near the 0.09 a governor
    // that took the filter for a luminance multiplier held it at.
    const grid = RECOMMENDED_GRID;
    const frameOf = (base: number, patch: number, size: number) => {
      const frame = new Array(grid * grid).fill(base);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) frame[y * grid + x] = patch;
      }
      return frame;
    };
    const cycle: [number, number[]][] = [
      [10, frameOf(0.05, 0.05, 0)],
      [4, frameOf(0.9, 0.9, 0)],
      [6, frameOf(0.05, 0.05, 0)],
      [3, frameOf(0.05, 0.35, 6)],
      [2, frameOf(0.9, 0.9, 0)],
      [5, frameOf(0.05, 0.05, 0)],
    ];
    const frames: number[][] = [];
    for (let repeat = 0; repeat < 12; repeat += 1) {
      for (const [count, frame] of cycle) {
        for (let i = 0; i < count; i += 1) frames.push(frame);
      }
    }
    const score = (series: number[][]) =>
      analyzeFlashTimeline({
        frames: series,
        deltaMs: FRAME_MS,
        cols: grid,
        rows: grid,
      }).peakFlashesPerSecond;
    expect(score(frames)).toBeGreaterThan(3);

    const governor = createFlashGovernor();
    let scale = 1;
    let darkest = 1;
    const seen: number[][] = [];
    for (const [index, frame] of frames.entries()) {
      seen.push(frame.map((v) => luminanceThroughBrightness(v, scale)));
      scale = governor.sample(index * FRAME_MS, frame, grid, grid, {
        viewScale: scale,
      }).luminanceScale;
      darkest = Math.min(darkest, scale);
    }
    expect(score(seen)).toBeLessThanOrEqual(3);
    expect(darkest).toBeGreaterThan(0.3);
  });

  test('the governor releases after the strobe stops', () => {
    const governor = createFlashGovernor();
    const strobe = strobeTimeline(120, 3);
    for (const [index, frame] of strobe.entries()) {
      governor.sample(index * FRAME_MS, frame, COLS, ROWS);
    }
    expect(governor.getState().hold).toBeGreaterThan(0);

    // Release is deliberately measured in seconds, not frames: a fast
    // release lets the strobe restart and re-trigger, which is a limit cycle
    // the governor itself drives. Give it long enough to actually finish.
    for (let i = 0; i < 700; i += 1) {
      governor.sample((120 + i) * FRAME_MS, uniformFrame(0.4), COLS, ROWS);
    }
    expect(governor.getState().hold).toBe(0);
    expect(governor.getState().flashesInWindow).toBe(0);
  });

  test('release does not begin during the hold-off', () => {
    // The window empties as soon as the clamp works, so releasing on an
    // empty window alone would immediately undo the clamp.
    const governor = createFlashGovernor();
    for (const [index, frame] of strobeTimeline(120, 3).entries()) {
      governor.sample(index * FRAME_MS, frame, COLS, ROWS);
    }
    const engaged = governor.getState().hold;
    expect(engaged).toBeGreaterThan(0);

    // Half a second of calm — inside the hold-off.
    for (let i = 0; i < 30; i += 1) {
      governor.sample((120 + i) * FRAME_MS, uniformFrame(0.4), COLS, ROWS);
    }
    expect(governor.getState().hold).toBe(engaged);
  });

  test('the response is proportional to how severe the flashing is', () => {
    // A blind ramp punished a mild flicker as hard as a full-range strobe.
    // The solved step should leave gentle content much less clamped.
    const settle = (low: number, high: number) => {
      const governor = createFlashGovernor();
      let scale = 1;
      for (let i = 0; i < 600; i += 1) {
        const raw = Math.floor(i / 3) % 2 === 1 ? high : low;
        scale = governor.sample(i * FRAME_MS, uniformFrame(raw), COLS, ROWS, {
          viewScale: scale,
        }).luminanceScale;
      }
      return scale;
    };
    const mild = settle(0.3, 0.45);
    const extreme = settle(0.0, 1.0);
    expect(mild).toBeGreaterThan(extreme);
    // Each lands where its own swing needs: brightness(0.76) for the
    // flicker, 0.31 for black-to-white, whose swing reaches the threshold
    // again by 0.35.
    expect(mild).toBeGreaterThan(0.7);
    expect(extreme).toBeLessThan(0.35);
  });

  test('reset clears the window and the hold', () => {
    const governor = createFlashGovernor();
    for (const [index, frame] of strobeTimeline(120, 3).entries()) {
      governor.sample(index * FRAME_MS, frame, COLS, ROWS);
    }
    expect(governor.getState().hold).toBeGreaterThan(0);
    governor.reset();
    expect(governor.getState().hold).toBe(0);
    expect(governor.getState().flashesInWindow).toBe(0);
  });

  test('priming suppresses the flashes a cold start would let through', () => {
    // The reactive path's one structural weakness: it cannot clamp a flash
    // it has not seen. If the catalog already measured this preset above the
    // limit, starting clamped should remove those opening flashes.
    const run = (prime: number) => {
      const governor = createFlashGovernor();
      if (prime > 0) governor.prime(prime);
      let scale = 1 - prime;
      let flashes = 0;
      for (let i = 0; i < 120; i += 1) {
        const raw = Math.floor(i / 3) % 2 === 1 ? 1 : 0;
        const decision = governor.sample(
          i * FRAME_MS,
          uniformFrame(raw),
          COLS,
          ROWS,
          { viewScale: scale },
        );
        scale = decision.luminanceScale;
        if (decision.flashed) flashes += 1;
      }
      return flashes;
    };
    const cold = run(0);
    const primed = run(0.9);
    expect(cold).toBeGreaterThan(0);
    expect(primed).toBeLessThan(cold);
  });

  test('priming is a floor, never a reduction', () => {
    const governor = createFlashGovernor();
    for (const [index, frame] of strobeTimeline(120, 3).entries()) {
      governor.sample(index * FRAME_MS, frame, COLS, ROWS);
    }
    const engaged = governor.getState().hold;
    expect(engaged).toBeGreaterThan(0.1);
    governor.prime(0.05);
    expect(governor.getState().hold).toBe(engaged);
  });

  test('only measured-high presets are primed', () => {
    // A 'medium' preset is under the WCAG limit by definition, so pre-dimming
    // it would be a visible cost with no safety claim behind it.
    expect(
      primingHoldForMeasurement({
        flashRiskLevel: 'medium',
        maxLuminanceDelta: 0.9,
      }),
    ).toBe(0);
    expect(
      primingHoldForMeasurement({
        flashRiskLevel: 'none',
        maxLuminanceDelta: 0.9,
      }),
    ).toBe(0);
    expect(primingHoldForMeasurement({ flashRiskLevel: 'unknown' })).toBe(0);
  });

  test('priming strength follows the measured swing', () => {
    const violent = primingHoldForMeasurement({
      flashRiskLevel: 'high',
      maxLuminanceDelta: 0.9,
    });
    const gentler = primingHoldForMeasurement({
      flashRiskLevel: 'high',
      maxLuminanceDelta: 0.25,
    });
    expect(violent).toBeGreaterThan(gentler);
    expect(violent).toBeLessThanOrEqual(0.9);
    expect(gentler).toBeGreaterThan(0);
  });

  test('priming from the measured flash swing lets none of the strobe through while it holds', () => {
    // The audit's figure is the swing the solved step clamps against, so a
    // governor primed from it starts where solving would have taken it, and
    // no flash of the measured strobe gets through. The volatility, which
    // the profile used to carry, is a standard deviation of frame means:
    // priming from it under-clamps, and the opening flashes land.
    //
    // 1.5 s: the prime keeps the window clear, so once the release delay
    // has passed it eases off like any other hold, and the reactive path
    // takes over from there.
    const raw = strobeTimeline(90, 3);
    const measured = analyzeFlashTimeline({
      frames: raw,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(measured.exceedsThreshold).toBe(true);
    const flashesPrimedFrom = (maxLuminanceDelta: number) => {
      const governor = createFlashGovernor();
      governor.prime(
        primingHoldForMeasurement({
          flashRiskLevel: 'high',
          maxLuminanceDelta,
        }),
      );
      let scale = governor.getState().luminanceScale;
      let flashes = 0;
      for (const [index, frame] of raw.entries()) {
        const decision = governor.sample(index * FRAME_MS, frame, COLS, ROWS, {
          viewScale: scale,
        });
        scale = decision.luminanceScale;
        if (decision.flashed) flashes += 1;
      }
      return flashes;
    };
    expect(measured.maxFlashLuminanceDelta).toBeCloseTo(0.93, 3);
    expect(flashesPrimedFrom(measured.maxFlashLuminanceDelta)).toBe(0);
    expect(flashesPrimedFrom(measured.luminanceVolatility)).toBeGreaterThan(0);
  });

  test('a high-risk preset with no usable swing figure still primes gently', () => {
    const hold = primingHoldForMeasurement({ flashRiskLevel: 'high' });
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeLessThan(0.5);
  });
});

type Rgb = readonly [number, number, number];
/** One pixel per tile at the recommended grid: a 5x5-tile visual field. */
const GRID = RECOMMENDED_GRID;

/** A GRID x GRID RGBA frame; `paint(i)` colours pixel (= tile) i. */
function rgbaFrame(paint: (i: number) => Rgb): Uint8Array {
  const px = new Uint8Array(GRID * GRID * 4);
  for (let i = 0; i < GRID * GRID; i += 1) {
    const [r, g, b] = paint(i);
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = 255;
  }
  return px;
}

/** `a` and `b` alternating every `holdFrames` frames, over the whole field. */
function alternate(
  count: number,
  holdFrames: number,
  a: Rgb,
  b: Rgb,
): Uint8Array[] {
  return Array.from({ length: count }, (_, f) =>
    rgbaFrame(() => (Math.floor(f / holdFrames) % 2 === 1 ? b : a)),
  );
}

/** The sampler's two fields for a frame, from the thresholds.ts definitions. */
function fieldsOf(frame: Uint8Array) {
  const n = frame.length / 4;
  const luminance = new Float32Array(n);
  const values = new Float32Array(n);
  const saturated = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = frame[i * 4] as number;
    const g = frame[i * 4 + 1] as number;
    const b = frame[i * 4 + 2] as number;
    luminance[i] = relativeLuminance(r, g, b);
    values[i] = redFlashValue(r, g, b);
    saturated[i] = isSaturatedRed(r, g, b) ? 1 : 0;
  }
  return { luminance, red: { values, saturated } };
}

/** CSS `brightness(k)`: every sRGB channel scaled by k. */
function dim(frame: Uint8Array, k: number): Uint8Array {
  return frame.map((v, i) => (i % 4 === 3 ? v : Math.round(v * k)));
}

/**
 * Runs frames through the governor as the controller does: each frame is
 * judged as drawn, through the scale in force when it was shown, and shown
 * at that scale. Returns what the viewer saw, and the scale each frame was
 * shown at.
 *
 * `outside` is a brightness setting composed into the same filter: the
 * viewer sees the governor's scale times it, and the governor is told the
 * product, as `createFlashController` does with `compositedScale`.
 */
function govern(
  frames: Uint8Array[],
  redOn: (frame: number) => boolean = () => true,
  { prime = 0, outside = 1 }: { prime?: number; outside?: number } = {},
) {
  const governor = createFlashGovernor();
  governor.prime(prime);
  let scale = governor.getState().luminanceScale;
  let minScale = 1;
  let maxHold = 0;
  let peakRed = 0;
  let peakGeneral = 0;
  const seen: Uint8Array[] = [];
  const shown: number[] = [];
  for (const [index, frame] of frames.entries()) {
    shown.push(scale * outside);
    seen.push(dim(frame, scale * outside));
    const { luminance, red } = fieldsOf(frame);
    const decision = governor.sample(index * FRAME_MS, luminance, GRID, GRID, {
      viewScale: scale * outside,
      red: redOn(index) ? red : undefined,
    });
    scale = decision.luminanceScale;
    minScale = Math.min(minScale, scale);
    maxHold = Math.max(maxHold, decision.hold);
    peakRed = Math.max(peakRed, decision.redFlashesInWindow);
    peakGeneral = Math.max(peakGeneral, decision.flashesInWindow);
  }
  return { seen, shown, governor, minScale, maxHold, peakRed, peakGeneral };
}

/** The offline per-pixel audit, the instrument the governor answers to. */
const audit = (frames: Uint8Array[]) =>
  analyzeRgbaFrames(frames, {
    width: GRID,
    height: GRID,
    cols: GRID,
    rows: GRID,
    stride: 1,
    deltaMs: FRAME_MS,
  });

const DARK_RED: Rgb = [80, 0, 0];
const RED: Rgb = [100, 0, 0];

describe('the red-flash channel', () => {
  test('(80,0,0) to (100,0,0) fails the red criterion with no general flash', () => {
    expect(
      Math.abs(relativeLuminance(...RED) - relativeLuminance(...DARK_RED)),
    ).toBeLessThan(0.02);
    expect(redFlashValue(...RED) - redFlashValue(...DARK_RED)).toBeGreaterThan(
      20,
    );
    const raw = audit(alternate(180, 3, DARK_RED, RED));
    expect(raw.exceedsThreshold).toBe(false);
    expect(raw.exceedsRedThreshold).toBe(true);
  });

  test('luminance alone never engages on it — the gap the red field closes', () => {
    const { maxHold } = govern(alternate(180, 3, DARK_RED, RED), () => false);
    expect(maxHold).toBe(0);
  });

  test('with the red field the governor brings it under the red threshold', () => {
    // Judged on the 8-bit frames a CSS brightness filter would show. Three
    // seconds, the horizon of the luminance tests above: the first
    // engagement and the hold that follows it.
    const { seen, maxHold, peakRed } = govern(alternate(180, 3, DARK_RED, RED));
    expect(maxHold).toBeGreaterThan(0);
    expect(peakRed).toBeGreaterThan(0);
    const governed = audit(seen);
    expect(governed.exceedsRedThreshold).toBe(false);
    expect(governed.exceedsThreshold).toBe(false);
  });

  test('the red clamp is solved from the red swing, as the luminance one is', () => {
    // A 25-unit red swing needs scaling by about 0.64 to fall under 20 at
    // the 0.8 margin; a 100-unit one by about 0.16. Neither moves luminance
    // by 0.1. The clamps land there, not at 0.8 times those: the solve
    // composes with the filter the flash was seen through, not with the
    // engage hold applied in the same step.
    const mild = govern(alternate(120, 3, DARK_RED, RED)).minScale;
    const strong = govern(alternate(120, 3, [40, 0, 0], [120, 0, 0])).minScale;
    expect(mild).toBeGreaterThan(0.6);
    expect(mild).toBeLessThan(0.8);
    expect(strong).toBeGreaterThan(0.1);
    expect(strong).toBeLessThan(0.16);
  });

  test('a colour swing that is not a saturated red is not a red flash', () => {
    // R/(R+G+B) is 0.5 at both ends, so the red-flash value's 38-unit change
    // does not count, on either instrument.
    const frames = alternate(180, 3, [120, 60, 60], [150, 60, 60]);
    expect(audit(frames).totalRedFlashes).toBe(0);
    expect(govern(frames).maxHold).toBe(0);
  });

  test('a steady saturated red, and a fade to one, are never held back', () => {
    const steady = Array.from({ length: 120 }, () =>
      rgbaFrame(() => [200, 0, 0]),
    );
    expect(govern(steady).maxHold).toBe(0);
    const fade = Array.from({ length: 120 }, (_, f) =>
      rgbaFrame(() => [Math.round((f / 119) * 255), 0, 0]),
    );
    expect(govern(fade).maxHold).toBe(0);
  });

  test('one strobing red tile is a sparkle, not a quarter of a visual field', () => {
    const frames = Array.from({ length: 120 }, (_, f) =>
      rgbaFrame((i) =>
        i === 0 && Math.floor(f / 3) % 2 === 1 ? [160, 0, 0] : [80, 0, 0],
      ),
    );
    expect(govern(frames).maxHold).toBe(0);
  });

  test('general and red flashes are counted on their own channels', () => {
    const red = govern(alternate(60, 3, DARK_RED, RED));
    expect(red.peakRed).toBeGreaterThan(0);
    expect(red.peakGeneral).toBe(0);
    const grey = govern(alternate(60, 3, [5, 5, 5], [240, 240, 240]));
    expect(grey.peakGeneral).toBeGreaterThan(0);
    expect(grey.peakRed).toBe(0);
  });

  test('a sample without the red field restarts the red comparison', () => {
    // Red arrives on every other frame only, so no two red samples are
    // consecutive and none may be compared across the frame between them.
    const frames = alternate(120, 3, DARK_RED, RED);
    expect(govern(frames, (f) => f % 2 === 0).peakRed).toBe(0);
    expect(govern(frames).peakRed).toBeGreaterThan(0);
  });

  test('reset clears the red window with the rest', () => {
    // Half a second: both flashes that engaged the clamp are still in it.
    const { governor } = govern(alternate(30, 3, DARK_RED, RED));
    expect(governor.getState().redFlashesInWindow).toBeGreaterThan(0);
    governor.reset();
    expect(governor.getState().redFlashesInWindow).toBe(0);
    expect(governor.getState().hold).toBe(0);
  });
});

/**
 * Release while the content keeps strobing.
 *
 * Release used to ease off until flashes landed again, so a strobe that never
 * stopped was let back across the threshold every few seconds. Before the
 * release floor, the 15-second runs below read up to 6 red flashes and 4
 * luminance flashes in one second after the first engagement. The claim here
 * is that after the first engagement the viewer sees no flash at all, that
 * the picture is held still at the margin the solved step aims for rather
 * than darker, and that content which stops, weakens, or never failed
 * undimmed is let go.
 */
describe('release under a sustained strobe', () => {
  const SECOND = 60;
  /** The first engagement, the clear window and the hold-off behind it. */
  const SETTLED = 3 * SECOND;
  /** The governor's default `safetyMargin`. */
  const MARGIN = 0.8;
  /** Frames per half period: 20, 10 and 4 transitions a second. */
  const HALF_PERIODS = [3, 6, 15];

  const square =
    (halfPeriod: number, low: number, high: number) => (frame: number) =>
      Math.floor(frame / halfPeriod) % 2 === 1 ? high : low;

  /**
   * A uniform luminance sequence through an exactly modelled brightness
   * filter: the viewer sees each value through the scale in force when it is
   * shown (`luminanceThroughBrightness`), and the governor is told that
   * scale. With no 8-bit rounding, nothing hides a flash the governor let
   * through.
   */
  function scrim(
    value: (frame: number) => number,
    frames: number,
    { prime = 0, outside = 1 }: { prime?: number; outside?: number } = {},
  ) {
    const governor = createFlashGovernor();
    governor.prime(prime);
    let scale = governor.getState().luminanceScale;
    const drawn = new Float32Array(GRID * GRID);
    const raw: number[][] = [];
    const seen: number[][] = [];
    const shown: number[] = [];
    for (let f = 0; f < frames; f += 1) {
      const v = value(f);
      raw.push(new Array(GRID * GRID).fill(v));
      seen.push(
        new Array(GRID * GRID).fill(
          luminanceThroughBrightness(v, scale * outside),
        ),
      );
      shown.push(scale * outside);
      drawn.fill(v);
      scale = governor.sample(f * FRAME_MS, drawn, GRID, GRID, {
        viewScale: scale * outside,
      }).luminanceScale;
    }
    return { raw, seen, shown, governor };
  }

  const scored = (frames: number[][], from = 0) =>
    analyzeFlashTimeline({
      frames: frames.slice(from),
      deltaMs: FRAME_MS,
      cols: GRID,
      rows: GRID,
    });

  const spread = (values: number[]) =>
    Math.max(...values) - Math.min(...values);

  /** Seconds from `from` until the scale shown is back to 1, or null. */
  function secondsToFull(shown: number[], from: number): number | null {
    const at = shown.findIndex((scale, f) => f >= from && scale === 1);
    return at < 0 ? null : (at - from) / SECOND;
  }

  for (const [label, low, high] of [
    ['just over the threshold', 0.3, 0.42],
    ['well over it', 0.02, 0.95],
  ] as const) {
    for (const halfPeriod of HALF_PERIODS) {
      test(`a 15 s luminance strobe ${label}, ${SECOND / halfPeriod} transitions a second, never flashes after it is clamped`, () => {
        const { raw, seen, shown } = scrim(
          square(halfPeriod, low, high),
          15 * SECOND,
        );
        expect(scored(raw).peakFlashesPerSecond).toBeGreaterThan(3);
        expect(scored(seen).peakFlashesPerSecond).toBeLessThanOrEqual(3);
        expect(scored(seen, SETTLED).totalFlashes).toBe(0);

        // Held still, at the margin and no darker: the swing as seen sits
        // within 2% under 80% of the threshold for the last ten seconds.
        const steady = shown.slice(5 * SECOND);
        expect(spread(steady)).toBeLessThan(0.001);
        const target = FLASH_LUMINANCE_DELTA * MARGIN;
        expect(
          swingThrough(low, high, Math.max(...steady)),
        ).toBeLessThanOrEqual(target);
        expect(swingThrough(low, high, Math.min(...steady))).toBeGreaterThan(
          target * 0.98,
        );
      });
    }
  }

  const redStrobes: [string, Rgb, Rgb][] = [
    ['just over the threshold', [80, 0, 0], [100, 0, 0]],
    ['well over it', [40, 0, 0], [120, 0, 0]],
  ];
  for (const [label, dark, bright] of redStrobes) {
    for (const halfPeriod of HALF_PERIODS) {
      test(`a 15 s saturated-red strobe ${label}, ${SECOND / halfPeriod} transitions a second, never flashes after it is clamped`, () => {
        // Judged on the 8-bit frames a CSS brightness filter would show.
        const frames = alternate(15 * SECOND, halfPeriod, dark, bright);
        expect(audit(frames).peakRedFlashesPerSecond).toBeGreaterThan(3);
        const { seen, shown } = govern(frames);
        const governed = audit(seen);
        expect(governed.peakRedFlashesPerSecond).toBeLessThanOrEqual(3);
        expect(governed.peakFlashesPerSecond).toBeLessThanOrEqual(3);
        expect(audit(seen.slice(SETTLED)).totalRedFlashes).toBe(0);

        const steady = shown.slice(5 * SECOND);
        expect(spread(steady)).toBeLessThan(0.001);
        const swing = redFlashValue(...bright) - redFlashValue(...dark);
        const target = RED_FLASH_DELTA * MARGIN;
        expect(swing * Math.max(...steady)).toBeLessThanOrEqual(target);
        expect(swing * Math.min(...steady)).toBeGreaterThan(target * 0.98);
      });
    }
  }

  test('a strobe on both channels at once is held under both', () => {
    const frames = alternate(15 * SECOND, 3, [0, 0, 0], [255, 0, 0]);
    const raw = audit(frames);
    expect(raw.peakFlashesPerSecond).toBeGreaterThan(3);
    expect(raw.peakRedFlashesPerSecond).toBeGreaterThan(3);
    const { seen } = govern(frames);
    const governed = audit(seen);
    expect(governed.peakFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(governed.peakRedFlashesPerSecond).toBeLessThanOrEqual(3);
    const settled = audit(seen.slice(SETTLED));
    expect(settled.totalFlashes).toBe(0);
    expect(settled.totalRedFlashes).toBe(0);
  });

  test('a strobe that pauses for less than the hold-off is not released into', () => {
    // Two seconds on, one off: the window empties in every pause.
    const frames = Array.from({ length: 15 * SECOND }, (_, f) =>
      rgbaFrame(() =>
        f % (3 * SECOND) < 2 * SECOND && Math.floor(f / 3) % 2 === 1
          ? [100, 0, 0]
          : [80, 0, 0],
      ),
    );
    expect(audit(frames).peakRedFlashesPerSecond).toBeGreaterThan(3);
    const { seen } = govern(frames);
    expect(audit(seen).peakRedFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(audit(seen.slice(SETTLED)).totalRedFlashes).toBe(0);
  });

  test('content that grows stronger without flashing as seen is held at its new ceiling', () => {
    // 80 to 104 is a 30-unit swing. Held at the 25-unit strobe's ceiling it
    // reads 19.2, under the 20 that counts as a red transition, so no flash
    // re-engages the clamp: the floor itself has to move to 16 / 30.1.
    const frames = Array.from({ length: 15 * SECOND }, (_, f) =>
      rgbaFrame(() =>
        Math.floor(f / 3) % 2 === 1
          ? f < 6 * SECOND
            ? [100, 0, 0]
            : [104, 0, 0]
          : [80, 0, 0],
      ),
    );
    const { seen, shown } = govern(frames);
    expect(audit(seen.slice(SETTLED)).totalRedFlashes).toBe(0);
    const before = redFlashValue(100, 0, 0) - redFlashValue(80, 0, 0);
    const after = redFlashValue(104, 0, 0) - redFlashValue(80, 0, 0);
    const target = RED_FLASH_DELTA * MARGIN;
    expect(before * (shown[6 * SECOND - 1] as number)).toBeCloseTo(target, 0);
    const end = shown.slice(10 * SECOND);
    expect(after * Math.max(...end)).toBeLessThanOrEqual(target);
    expect(after * Math.min(...end)).toBeGreaterThan(target * 0.98);
  });

  test('the hold follows a strobe that weakens, and lets go when it stops', () => {
    // 5 s of a 100-unit red swing, 7 s of a 25-unit one, then a still frame.
    const frames = Array.from({ length: 20 * SECOND }, (_, f) => {
      const on = Math.floor(f / 3) % 2 === 1;
      if (f < 5 * SECOND)
        return rgbaFrame(() => (on ? [120, 0, 0] : [40, 0, 0]));
      if (f < 12 * SECOND)
        return rgbaFrame(() => (on ? [100, 0, 0] : [80, 0, 0]));
      return rgbaFrame(() => [80, 0, 0]);
    });
    const { seen, shown } = govern(frames);
    expect(audit(seen).peakRedFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(audit(seen.slice(SETTLED)).totalRedFlashes).toBe(0);

    // The strong strobe's ceiling is not kept once its transitions age out:
    // by the end of the weaker one the hold sits at the weaker ceiling.
    const strong = redFlashValue(120, 0, 0) - redFlashValue(40, 0, 0);
    const weak = redFlashValue(100, 0, 0) - redFlashValue(80, 0, 0);
    const target = RED_FLASH_DELTA * MARGIN;
    expect(strong * (shown[5 * SECOND - 1] as number)).toBeLessThanOrEqual(
      target,
    );
    expect(weak * (shown[12 * SECOND - 1] as number)).toBeGreaterThan(
      target * 0.98,
    );
    expect(secondsToFull(shown, 12 * SECOND)).not.toBeNull();
  });

  test('after the strobe stops the picture is back to full brightness within the hold-off and a release', () => {
    // The floor lifts once the content has stayed under the limit for the
    // hold-off (1.5 s) after its window drains (up to 1 s); release then runs
    // at 0.004 a frame. From a 91% hold that is about 6.2 s in all. Release
    // used to finish 4.7 s after this strobe stopped, because it was already
    // part-way through easing off into it.
    const { shown } = scrim(
      (f) => (f < 15 * SECOND ? square(3, 0.02, 0.95)(f) : 0.02),
      25 * SECOND,
    );
    const recovery = secondsToFull(shown, 15 * SECOND);
    expect(recovery).not.toBeNull();
    expect(recovery as number).toBeLessThan(6.5);
    // Held still for over two seconds after the last flash, the drained
    // window and the hold-off: a strobe that resumes inside them meets the
    // clamp, not a picture already part-way released.
    expect(spread(shown.slice(14 * SECOND, 17.2 * SECOND))).toBeLessThan(0.001);
  });

  test('a strobe followed by flicker under the threshold is let go completely', () => {
    // 0.30 to 0.38 is under the 0.1 swing that counts, undimmed: the floor
    // only holds content that fails undimmed, so release runs to zero.
    const { seen, shown } = scrim(
      (f) =>
        f < 5 * SECOND ? square(3, 0.02, 0.95)(f) : square(3, 0.3, 0.38)(f),
      15 * SECOND,
    );
    expect(scored(seen).peakFlashesPerSecond).toBeLessThanOrEqual(3);
    const recovery = secondsToFull(shown, 5 * SECOND);
    expect(recovery).not.toBeNull();
    expect(recovery as number).toBeLessThan(6.5);
  });

  test('content at the limit undimmed is not held at its ceiling', () => {
    // A full-contrast swing twice a second passes WCAG undimmed. The governor
    // still engages on it (engageAt is 2), but holding it at its ceiling
    // would be dimming with no safety claim behind it, so release still
    // passes the threshold scale; as seen it can flash no more often than
    // it does undimmed.
    const { raw, seen, shown } = scrim(square(30, 0.02, 0.95), 15 * SECOND);
    expect(scored(raw).peakFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(Math.min(...shown)).toBeLessThan(1);
    expect(Math.max(...shown.slice(SETTLED))).toBeGreaterThan(
      scaleForSwing(0.02, 0.95, FLASH_LUMINANCE_DELTA),
    );
    expect(scored(seen).peakFlashesPerSecond).toBeLessThanOrEqual(3);
  });

  test('primed content is held at its ceiling rather than released into', () => {
    // A 0.9 prime already puts this strobe under the threshold. The primed
    // hold used to be released after the hold-off like any other, into the
    // strobe; now it settles at the ceiling and the viewer sees no flash.
    const { seen, shown } = scrim(square(3, 0.02, 0.95), 15 * SECOND, {
      prime: 0.9,
    });
    expect(scored(seen).totalFlashes).toBe(0);
    const steady = shown.slice(5 * SECOND);
    expect(swingThrough(0.02, 0.95, Math.max(...steady))).toBeLessThanOrEqual(
      FLASH_LUMINANCE_DELTA * MARGIN,
    );
  });

  test('a brightness setting composed into the filter is not counted twice', () => {
    // The viewer sees the governor's filter composed with brightness(0.5),
    // and the governor is told so: it only has to make up the rest of the
    // way to the ceiling, so its own scale settles at twice the one shown.
    const { seen, shown, governor } = scrim(
      square(3, 0.02, 0.95),
      15 * SECOND,
      {
        outside: 0.5,
      },
    );
    expect(scored(seen, SETTLED).totalFlashes).toBe(0);
    const viewed = shown[shown.length - 1] as number;
    const target = FLASH_LUMINANCE_DELTA * MARGIN;
    expect(swingThrough(0.02, 0.95, viewed)).toBeLessThanOrEqual(target);
    expect(swingThrough(0.02, 0.95, viewed)).toBeGreaterThan(target * 0.98);
    expect(governor.getState().luminanceScale).toBeCloseTo(viewed / 0.5, 3);
  });
});
