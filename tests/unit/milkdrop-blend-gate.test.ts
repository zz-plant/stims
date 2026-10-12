import { describe, expect, test } from 'bun:test';
import {
  estimateFrameBlendWorkload,
  evaluateBlendGate,
  MAX_BLEND_WORKLOAD,
  wouldMilkdropSwitchBlendNow,
} from '../../src/js/milkdrop/runtime/session.ts';
import type { MilkdropFrameState } from '../../src/js/milkdrop/types.ts';

/**
 * Frame shapes taken from a 250-preset corpus sweep of
 * `estimateFrameBlendWorkload` (`bun run lab:blend-gate`). The numbers are
 * the point of the test: an earlier threshold of 900 sat below the corpus
 * MINIMUM (1283), so every crossfade in the product silently became a cut.
 * Pin the floor here so no future threshold can land under a real frame.
 */
function frameState(options: {
  /** Main-wave points, not raw position floats. */
  wavePoints: number;
  meshQuads: number;
  motionVectors?: number;
  shapes?: number;
  borders?: number;
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
  } as unknown as MilkdropFrameState;
}

/** The lightest real preset measured in the corpus sweep. */
const CORPUS_FLOOR = frameState({ wavePoints: 291, meshQuads: 992 });
/** Corpus median. */
const CORPUS_MEDIAN = frameState({
  wavePoints: 307,
  meshQuads: 992,
  motionVectors: 144,
  borders: 2,
});
/** Corpus maximum — the only tier a static geometry gate should refuse. */
const CORPUS_PEAK = frameState({
  wavePoints: 512,
  meshQuads: 992,
  motionVectors: 1024,
  shapes: 400,
  borders: 64,
});

const HEALTHY = {
  rollingAverageFrameMs: 6,
  frameBudgetMs: 16.67,
  thermalState: 'nominal' as const,
};

describe('blend gate', () => {
  test('the corpus floor is a 992-quad warp mesh, so the threshold must clear it', () => {
    expect(estimateFrameBlendWorkload(CORPUS_FLOOR)).toBe(1283);
    // The regression that motivated this test: 900 < 1283.
    expect(MAX_BLEND_WORKLOAD).toBeGreaterThan(1283);
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
      canLiveBlend: false,
    });
  });

  test('a machine already missing its frame budget is refused', () => {
    expect(
      evaluateBlendGate(CORPUS_MEDIAN, {
        ...HEALTHY,
        // ~14fps against a 60Hz budget.
        rollingAverageFrameMs: 70,
      }),
    ).toEqual({
      canBlend: false,
      refusal: 'frame-pressure',
      canLiveBlend: false,
    });
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
    ).toEqual({ canBlend: false, refusal: 'thermal', canLiveBlend: false });
  });

  test('a frame inside its budget blends live', () => {
    expect(evaluateBlendGate(CORPUS_MEDIAN, HEALTHY).canLiveBlend).toBe(true);
  });

  test('a frame whose double would miss the budget blends out of a snapshot', () => {
    // A live blend runs a second preset for its whole duration, roughly
    // doubling the frame: 12ms fits a 16.7ms budget, 24ms does not.
    const decision = evaluateBlendGate(CORPUS_MEDIAN, {
      ...HEALTHY,
      rollingAverageFrameMs: 12,
    });
    expect(decision.canBlend).toBe(true);
    expect(decision.canLiveBlend).toBe(false);
  });

  test('a switch during a live blend still clears the blend gate', () => {
    // The live blend's own doubled frames: 2 x 8ms, inside the 2x tolerance
    // the snapshot blend is held to.
    expect(
      evaluateBlendGate(CORPUS_MEDIAN, {
        ...HEALTHY,
        rollingAverageFrameMs: 16,
      }).canBlend,
    ).toBe(true);
  });

  test('a warming device blends out of a snapshot instead of live', () => {
    const decision = evaluateBlendGate(CORPUS_MEDIAN, {
      ...HEALTHY,
      thermalState: 'elevated',
    });
    expect(decision.canBlend).toBe(true);
    expect(decision.canLiveBlend).toBe(false);
  });

  test('without a quality controller the timing gate abstains', () => {
    expect(evaluateBlendGate(CORPUS_MEDIAN, null).canBlend).toBe(true);
  });
});

describe('switch blend willingness (warm-up arming)', () => {
  /**
   * `wouldMilkdropSwitchBlendNow` is the pre-apply half of the blend
   * decision: the pre-fade pipeline warm-up arms only when the switch will
   * actually crossfade, because a switch the gate is about to turn into a
   * cut gains nothing from an up-to-1.5s warm-up hold — pure input latency.
   */
  const willingness = (overrides: {
    frameState?: MilkdropFrameState;
    pressure?: {
      rollingAverageFrameMs: number;
      frameBudgetMs: number;
      thermalState: 'nominal' | 'elevated' | 'throttling';
    } | null;
    manual?: boolean;
    transitionMode?: 'blend' | 'cut';
    blendDuration?: number;
  }) =>
    wouldMilkdropSwitchBlendNow({
      currentFrameState: overrides.frameState ?? CORPUS_MEDIAN,
      pressure: overrides.pressure ?? HEALTHY,
      manual: overrides.manual ?? false,
      transitionMode: overrides.transitionMode ?? 'blend',
      blendDuration: overrides.blendDuration ?? 2.5,
    });

  test('a switch the gate would blend arms the warm-up', () => {
    expect(willingness({})).toBe(true);
  });

  test('a workload refusal disarms the warm-up', () => {
    expect(willingness({ frameState: CORPUS_PEAK })).toBe(false);
  });

  test('a frame-pressure refusal disarms the warm-up', () => {
    expect(
      willingness({
        pressure: { ...HEALTHY, rollingAverageFrameMs: 70 },
      }),
    ).toBe(false);
  });

  test('a throttling device disarms the warm-up', () => {
    expect(
      willingness({
        pressure: { ...HEALTHY, thermalState: 'throttling' },
      }),
    ).toBe(false);
  });

  test('the cut preference and a zero duration keep the switch synchronous', () => {
    expect(willingness({ transitionMode: 'cut' })).toBe(false);
    expect(willingness({ blendDuration: 0 })).toBe(false);
  });

  test('a manual crossfade wants a blend regardless of duration, but not against a refusing gate', () => {
    expect(willingness({ manual: true, blendDuration: 0 })).toBe(true);
    // Manual + gate refusal is a cut in beginPresetTransition too: the
    // fader never appears, and warming it would delay nothing the user
    // gets to see.
    expect(willingness({ manual: true, frameState: CORPUS_PEAK })).toBe(false);
  });
});
