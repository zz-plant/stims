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
  isFlashTransition,
  isSaturatedRed,
  MIN_USEFUL_GRID,
  primingHoldForMeasurement,
  RECOMMENDED_GRID,
  RECOMMENDED_SAMPLE_DENSITY,
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
 * Runs a timeline through the governor and returns what a viewer would
 * actually see: each frame blended over the previous PRESENTED frame by the
 * hold the governor asked for. This is the renderer's side of the contract.
 */
function present(
  source: number[][],
  governor: ReturnType<typeof createFlashGovernor>,
): number[][] {
  const presented: number[][] = [];
  let last: number[] | null = null;
  for (const [index, frame] of source.entries()) {
    const now = index * FRAME_MS;
    // The governor observes what is on screen, not the raw source — the
    // held frame is what the viewer's eye integrates, and feeding it the
    // source instead would make the hold invisible to its own accounting.
    const observed = last ?? frame;
    const { hold } = governor.sample(now, observed, COLS, ROWS);
    const previousFrame = last;
    const blended: number[] = previousFrame
      ? frame.map(
          (v, i) => (previousFrame[i] as number) * hold + v * (1 - hold),
        )
      : [...frame];
    presented.push(blended);
    last = blended;
  }
  return presented;
}

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

  test('the same strobe passes WCAG once the governor holds frames', () => {
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

  test('the luminance-scale mitigation also brings the strobe under threshold', () => {
    // The scrim path: instead of blending against the previous frame, scale
    // the whole frame by luminanceScale. Different picture, same arithmetic
    // — and this is the form that works on both renderer backends.
    const raw = strobeTimeline(180, 3);
    const governor = createFlashGovernor();
    const scaled: number[][] = [];
    let last: number[] | null = null;
    for (const [index, frame] of raw.entries()) {
      const observed = last ?? frame;
      const { luminanceScale } = governor.sample(
        index * FRAME_MS,
        observed,
        COLS,
        ROWS,
      );
      const presented = frame.map((v) => v * luminanceScale);
      scaled.push(presented);
      last = presented;
    }
    const analysis = analyzeFlashTimeline({
      frames: scaled,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.exceedsThreshold).toBe(false);
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
    // A 6x6-tile patch swings 0.3 at 5Hz while a single tile elsewhere
    // swings 0.9 with it. The patch is what makes these frames a flash, and
    // scaling it by about 0.27 puts it under the threshold. Solving for the
    // outlier instead asks for 0.09 and blacks out the stage for one tile.
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
    // The first engagement already carries the engageHold ramp (0.8), so the
    // solved scale is 0.8 * 0.27 = 0.21; the outlier's would be 0.07.
    expect(engagedAt as number).toBeGreaterThan(0.15);
    // And it is enough: the patch's 0.3 swing no longer qualifies.
    expect(0.3 * (engagedAt as number)).toBeLessThan(0.1);
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
        const observed = uniformFrame(raw * scale);
        scale = governor.sample(
          i * FRAME_MS,
          observed,
          COLS,
          ROWS,
        ).luminanceScale;
      }
      return scale;
    };
    const mild = settle(0.3, 0.45);
    const extreme = settle(0.0, 1.0);
    expect(mild).toBeGreaterThan(extreme);
    expect(mild).toBeGreaterThan(0.4);
    expect(extreme).toBeLessThan(0.2);
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
          uniformFrame(raw * scale),
          COLS,
          ROWS,
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

describe('the red-flash channel', () => {
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
   * at that scale. Returns what the viewer saw.
   */
  function govern(
    frames: Uint8Array[],
    redOn: (frame: number) => boolean = () => true,
  ) {
    const governor = createFlashGovernor();
    let scale = 1;
    let minScale = 1;
    let maxHold = 0;
    let peakRed = 0;
    let peakGeneral = 0;
    const seen: Uint8Array[] = [];
    for (const [index, frame] of frames.entries()) {
      seen.push(dim(frame, scale));
      const { luminance, red } = fieldsOf(frame);
      const decision = governor.sample(
        index * FRAME_MS,
        luminance,
        GRID,
        GRID,
        {
          viewScale: scale,
          red: redOn(index) ? red : undefined,
        },
      );
      scale = decision.luminanceScale;
      minScale = Math.min(minScale, scale);
      maxHold = Math.max(maxHold, decision.hold);
      peakRed = Math.max(peakRed, decision.redFlashesInWindow);
      peakGeneral = Math.max(peakGeneral, decision.flashesInWindow);
    }
    return { seen, governor, minScale, maxHold, peakRed, peakGeneral };
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
    // by 0.1. The first engagement also carries the 0.2 engage hold, so the
    // clamps land near 0.8 times those.
    const mild = govern(alternate(120, 3, DARK_RED, RED)).minScale;
    const strong = govern(alternate(120, 3, [40, 0, 0], [120, 0, 0])).minScale;
    expect(mild).toBeGreaterThan(0.45);
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
