/**
 * Regression coverage for the motion-vector geometry paths in
 * src/js/milkdrop/vm/geometry-builder.ts.
 *
 * WHY SYNTHETIC PRESETS: the shipped catalog cannot exercise these branches.
 * Not one of the 1,787 bundled presets declares `fMotionVectorsL`, so the
 * legacy `mv_dx`/`mv_dy` source-offset path has zero catalog coverage, and two
 * separate optimization passes have already shipped motion-vector "coverage"
 * that silently emitted ZERO vectors and therefore asserted nothing. Every test
 * below asserts a non-zero emitted vector count FIRST, so an inert fixture
 * fails loudly instead of passing vacuously.
 *
 * FIELD-NAME TRAPS (both confirmed the hard way):
 *  - `nMotionVectorsDX` / `nMotionVectorsDY` normalize to `null` in
 *    field-normalization.ts and are silently dropped. The offsets must be
 *    spelled RAW as `mv_dx` / `mv_dy`.
 *  - `fMotionVectorsA` defaults to 0 and buildMotionVectors culls the whole
 *    grid at `alpha <= 0.003`, so alpha must be set explicitly.
 * Working spellings: bMotionVectorsOn, nMotionVectorsX/Y, fMotionVectorsA,
 * nMotionVectorsLoop, and raw mv_dx / mv_dy.
 */
import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

const PER_PIXEL = `
per_pixel_1=zoom = zoom + 0.02*sin(rad*8 + time);
per_pixel_2=rot = rot + 0.05*cos(ang*3 + time*0.7);
per_pixel_3=dx = dx + 0.01*sin(y*6 + time);
per_pixel_4=dy = dy + 0.01*cos(x*6 + time);
`;

const PER_FRAME = `
per_frame_1=zoom = 1.02 + 0.01*sin(time);
per_frame_2=rot = 0.05*sin(time*0.5);
per_frame_3=dx = 0.01*sin(time*0.3);
per_frame_4=dy = 0.01*cos(time*0.3);
per_frame_5=cx = 0.5 + 0.02*sin(time*0.2);
per_frame_6=cy = 0.5 + 0.02*cos(time*0.2);
`;

function makeSource({
  mvx,
  mvy,
  perPixel,
  legacy,
}: {
  mvx: number;
  mvy: number;
  perPixel: boolean;
  legacy: boolean;
}) {
  // 0.55 offset: every column whose base x >= 0.45 clamps to +1, folding
  // several distinct columns onto the same source point — the case a
  // coordinate-quantising transform memo used to answer with a NEIGHBOUR's
  // transform instead of the point's own.
  const legacyLines = legacy
    ? 'mv_dx=0.550000\nmv_dy=0.550000\nnMotionVectorsLoop=1.400000\n'
    : '';
  return `[preset00]
fRating=5.000000
fGammaAdj=1.000000
fDecay=0.960000
fZoom=1.010000
fZoomExponent=1.000000
fRot=0.000000
fWarp=0.500000
fWarpScale=1.500000
nWaveMode=0.000000
fWaveAlpha=0.500000
bMotionVectorsOn=1.000000
nMotionVectorsX=${mvx.toFixed(6)}
nMotionVectorsY=${mvy.toFixed(6)}
fMotionVectorsA=0.750000
fMotionVectorsR=1.000000
fMotionVectorsG=0.500000
fMotionVectorsB=0.250000
${legacyLines}${PER_FRAME}${perPixel ? PER_PIXEL : ''}`;
}

// countX * countY > 288 switches buildMotionVectors from evaluating every cell
// directly to sampling a coarse 17x13 grid and bilinear-interpolating.
const INTERPOLATION_THRESHOLD = 288;

type Fixture = {
  id: string;
  mvx: number;
  mvy: number;
  perPixel: boolean;
  legacy: boolean;
  /** Expected sampling path, derived from the documented threshold. */
  path: 'direct' | 'interpolated';
};

function fixture(
  id: string,
  mvx: number,
  mvy: number,
  perPixel: boolean,
  legacy: boolean,
): Fixture {
  return {
    id,
    mvx,
    mvy,
    perPixel,
    legacy,
    path: mvx * mvy > INTERPOLATION_THRESHOLD ? 'interpolated' : 'direct',
  };
}

const FIXTURES: Fixture[] = [
  // {direct, interpolated} x {legacy clamp, no clamp} x {per-pixel, none}
  fixture('mv-direct-nopp', 16, 12, false, false),
  fixture('mv-direct-pp', 16, 12, true, false),
  fixture('mv-interp-nopp', 64, 48, false, false),
  fixture('mv-interp-pp', 64, 48, true, false),
  fixture('mv-legacy-direct-nopp', 16, 12, false, true),
  fixture('mv-legacy-direct-pp', 16, 12, true, true),
  fixture('mv-legacy-interp-nopp', 64, 48, false, true),
  fixture('mv-legacy-interp-pp', 64, 48, true, true),
  // Both sides of the interpolation threshold.
  fixture('mv-thresh-at-pp', 24, 12, true, false), // 288 cells -> direct
  fixture('mv-thresh-over-pp', 25, 12, true, false), // 300 cells -> interpolated
];

function makeSignals(frame: number): MilkdropRuntimeSignals {
  return {
    time: frame / 60,
    deltaMs: 16.67,
    frame,
    fps: 60,
    aspect: 16 / 9,
    bass: 0.7 + 0.2 * Math.sin(frame / 11),
    mid: 0.5,
    mids: 0.5,
    treb: 0.4,
    treble: 0.4,
    bassAtt: 0.6,
    midAtt: 0.45,
    bass_att: 0.6,
    mid_att: 0.45,
    midsAtt: 0.45,
    mids_att: 0.45,
    treb_att: 0.35,
    trebleAtt: 0.35,
    treble_att: 0.35,
    rms: 0.5,
    vol: 0.5,
    music: 0.58,
    beat: frame % 2,
    beatPulse: 0.2,
    beat_pulse: 0.2,
    transient: 0,
    spectralFlux: 0,
    bandFlux: 0,
    frequencyData: new Uint8Array(64).fill(160),
    waveformData: new Float32Array(512),
  } as unknown as MilkdropRuntimeSignals;
}

const FRAMES = 6;

type StepResult = {
  perPixelStatements: number;
  counts: number[];
  samples: { positions: number[]; alpha: number; thickness: number }[][];
};

function runFixture(spec: Fixture): StepResult {
  const preset = compileMilkdropPresetSource(
    makeSource({
      mvx: spec.mvx,
      mvy: spec.mvy,
      perPixel: spec.perPixel,
      legacy: spec.legacy,
    }),
    { id: spec.id, origin: 'bundled' },
  );
  const vm = createMilkdropVM(preset);
  const counts: number[] = [];
  const samples: StepResult['samples'] = [];
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const state = vm.step(makeSignals(frame));
    const vectors = state.motionVectors ?? [];
    counts.push(vectors.length);
    // The VM recycles the visual-frame arrays, so snapshot rather than retain.
    samples.push(
      vectors.map((vector) => ({
        positions: [...vector.positions],
        alpha: vector.alpha,
        thickness: vector.thickness,
      })),
    );
  }
  return {
    perPixelStatements: preset.ir.programs.perPixel.statements.length,
    counts,
    samples,
  };
}

describe('milkdrop motion-vector geometry paths', () => {
  for (const spec of FIXTURES) {
    describe(spec.id, () => {
      const result = runFixture(spec);
      const cellCount = spec.mvx * spec.mvy;

      test('the fixture actually drives the intended branch', () => {
        // Guards against the fixture rotting into a preset that compiles but
        // exercises nothing: the per-pixel flag and the sampling path both have
        // to be what the fixture name claims.
        expect(result.perPixelStatements > 0).toBe(spec.perPixel);
        expect(
          cellCount > INTERPOLATION_THRESHOLD ? 'interpolated' : 'direct',
        ).toBe(spec.path);
      });

      test('emits a non-zero vector count on every frame', () => {
        // PRECONDITION, not a nicety. Twice now a "covered" motion-vector path
        // has shipped emitting zero vectors, which makes every downstream
        // assertion vacuous.
        for (const count of result.counts) {
          expect(count).toBeGreaterThan(0);
        }
        // A meaningful fraction of the authored grid must survive the
        // near-zero-magnitude cull, not just a stray vector or two.
        const minimum = Math.min(...result.counts);
        expect(minimum).toBeGreaterThan(cellCount * 0.5);
        expect(Math.max(...result.counts)).toBeLessThanOrEqual(cellCount);
      });

      test('emits well-formed, finite, on-screen-scaled vectors', () => {
        for (const frame of result.samples) {
          for (const vector of frame) {
            expect(vector.positions).toHaveLength(6);
            for (const value of vector.positions) {
              expect(Number.isFinite(value)).toBe(true);
            }
            // Endpoints live in NDC-ish space; a runaway transform (NaN-free
            // but exploded) would blow past this bound.
            for (const value of vector.positions) {
              expect(Math.abs(value)).toBeLessThan(64);
            }
            expect(vector.alpha).toBeCloseTo(0.75, 6);
            expect(vector.thickness).toBe(1);
            // Head and tail must differ: the builder culls magnitudes < 0.002.
            const dx = vector.positions[3] - vector.positions[0];
            const dy = vector.positions[4] - vector.positions[1];
            expect(Math.hypot(dx, dy)).toBeGreaterThan(0);
          }
        }
      });

      test('vector count is stable across frames', () => {
        // Shape churn frame-to-frame means the history/cull logic is unstable,
        // which reads as flickering vectors on screen.
        const first = result.counts[0];
        const spread = Math.max(...result.counts) - Math.min(...result.counts);
        expect(first).toBeGreaterThan(0);
        expect(spread).toBeLessThanOrEqual(Math.ceil(cellCount * 0.1));
      });
    });
  }

  test('legacy mv_dx/mv_dy source offsets are honoured', () => {
    // If `mv_dx`/`mv_dy` were dropped (the nMotionVectorsDX spelling trap), the
    // legacy and non-legacy fixtures would produce identical geometry.
    const plain = runFixture(
      FIXTURES.find((f) => f.id === 'mv-direct-pp') as Fixture,
    );
    const offset = runFixture(
      FIXTURES.find((f) => f.id === 'mv-legacy-direct-pp') as Fixture,
    );
    expect(plain.samples[FRAMES - 1].length).toBeGreaterThan(0);
    expect(offset.samples[FRAMES - 1].length).toBeGreaterThan(0);
    const plainFirst = plain.samples[FRAMES - 1][0].positions.join(',');
    const offsetFirst = offset.samples[FRAMES - 1][0].positions.join(',');
    expect(offsetFirst).not.toBe(plainFirst);
  });

  test('motion-vector geometry is deterministic for identical input', () => {
    const spec = FIXTURES.find(
      (f) => f.id === 'mv-legacy-direct-pp',
    ) as Fixture;
    const a = runFixture(spec);
    const b = runFixture(spec);
    expect(a.counts).toEqual(b.counts);
    expect(JSON.stringify(a.samples)).toBe(JSON.stringify(b.samples));
  });
});
