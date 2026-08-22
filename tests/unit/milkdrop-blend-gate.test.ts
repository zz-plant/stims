import { describe, expect, test } from 'bun:test';
import {
  estimateFrameBlendWorkload,
  evaluateBlendGate,
  MAX_BLEND_WORKLOAD,
} from '../../src/js/milkdrop/runtime/session.ts';
import type { MilkdropFrameState } from '../../src/js/milkdrop/types.ts';

/**
 * Frame shapes taken from a 250-preset corpus sweep of
 * `estimateFrameBlendWorkload` (`bun run lab:blend-gate`). The numbers are
 * the point of the test: an earlier threshold of 900 sat below the corpus
 * MINIMUM of 1323, so every crossfade in the product silently became a cut.
 * Pin the floor here so no future threshold can land under a real frame.
 */
function frameState(options: {
  /** Main-wave points, not raw position floats. */
  wavePoints: number;
  meshQuads: number;
  motionVectors?: number;
  shapes?: number;
  borders?: number;
  trails?: number;
}): MilkdropFrameState {
  return {
    mainWave: { positions: new Float32Array(options.wavePoints * 3) },
    customWaves: [],
    mesh: { positions: new Float32Array(options.meshQuads * 6 * 2) },
    motionVectors: Array.from(
      { length: options.motionVectors ?? 0 },
      () => ({}),
    ),
    shapes: Array.from({ length: options.shapes ?? 0 }, () => ({})),
    borders: Array.from({ length: options.borders ?? 0 }, () => ({})),
    trails: Array.from({ length: options.trails ?? 0 }, () => ({})),
  } as unknown as MilkdropFrameState;
}

/** The lightest real preset measured in the corpus sweep. */
const CORPUS_FLOOR = frameState({ wavePoints: 291, meshQuads: 992, trails: 5 });
/** Corpus median. */
const CORPUS_MEDIAN = frameState({
  wavePoints: 307,
  meshQuads: 992,
  motionVectors: 144,
  borders: 2,
  trails: 5,
});
/** Corpus maximum — the only tier a static geometry gate should refuse. */
const CORPUS_PEAK = frameState({
  wavePoints: 512,
  meshQuads: 992,
  motionVectors: 1024,
  shapes: 400,
  borders: 64,
  trails: 64,
});

const HEALTHY = {
  rollingAverageFrameMs: 12,
  frameBudgetMs: 16.67,
  thermalState: 'nominal' as const,
};

describe('blend gate', () => {
  test('the corpus floor is a 992-quad warp mesh, so the threshold must clear it', () => {
    expect(estimateFrameBlendWorkload(CORPUS_FLOOR)).toBe(1323);
    // The regression that motivated this test: 900 < 1323.
    expect(MAX_BLEND_WORKLOAD).toBeGreaterThan(1323);
  });

  test('ordinary presets can crossfade', () => {
    expect(evaluateBlendGate(CORPUS_FLOOR, HEALTHY).canBlend).toBe(true);
    expect(evaluateBlendGate(CORPUS_MEDIAN, HEALTHY).canBlend).toBe(true);
  });

  test('a pathological frame is refused on workload', () => {
    expect(estimateFrameBlendWorkload(CORPUS_PEAK)).toBeGreaterThan(
      MAX_BLEND_WORKLOAD,
    );
    expect(evaluateBlendGate(CORPUS_PEAK, HEALTHY)).toEqual({
      canBlend: false,
      refusal: 'workload',
    });
  });

  test('a machine already missing its frame budget is refused', () => {
    expect(
      evaluateBlendGate(CORPUS_MEDIAN, {
        ...HEALTHY,
        // ~14fps against a 60Hz budget.
        rollingAverageFrameMs: 70,
      }),
    ).toEqual({ canBlend: false, refusal: 'frame-pressure' });
  });

  test('a serviceable frame rate still crossfades', () => {
    // 45fps on a laptop driving a projector is the normal case the blend
    // exists for, not a machine in trouble. A tighter tolerance refused it.
    expect(
      evaluateBlendGate(CORPUS_MEDIAN, {
        ...HEALTHY,
        rollingAverageFrameMs: 22,
      }).canBlend,
    ).toBe(true);
  });

  test('throttling is refused even with geometry headroom', () => {
    expect(
      evaluateBlendGate(CORPUS_FLOOR, {
        ...HEALTHY,
        thermalState: 'throttling',
      }),
    ).toEqual({ canBlend: false, refusal: 'thermal' });
  });

  test('without a quality controller the timing gate abstains', () => {
    expect(evaluateBlendGate(CORPUS_MEDIAN, null).canBlend).toBe(true);
  });
});
