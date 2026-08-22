import type {
  MilkdropBlendState,
  MilkdropCatalogEntry,
  MilkdropColor,
  MilkdropFrameState,
  MilkdropMotionVectorVisual,
  MilkdropProceduralCustomWaveVisual,
  MilkdropWaveVisual,
} from '../types';

function cloneColor(color: MilkdropColor): MilkdropColor {
  return { ...color };
}

function cloneWaveVisual(wave: MilkdropWaveVisual): MilkdropWaveVisual {
  return {
    ...wave,
    positions: wave.positions.slice(),
    color: cloneColor(wave.color),
  };
}

function cloneProceduralCustomWaveVisual(
  wave: MilkdropProceduralCustomWaveVisual,
): MilkdropProceduralCustomWaveVisual {
  return {
    ...wave,
    samples: wave.samples.slice(),
    sampleValues2: wave.sampleValues2?.slice(),
    signals: wave.signals ? { ...wave.signals } : wave.signals,
    color: cloneColor(wave.color),
  };
}

function cloneMotionVectorVisual(
  vector: MilkdropMotionVectorVisual,
): MilkdropMotionVectorVisual {
  return {
    ...vector,
    positions: vector.positions.slice(),
    color: cloneColor(vector.color),
  };
}

export function cloneBlendState(
  frameState: MilkdropFrameState | null,
): MilkdropBlendState | null {
  if (!frameState) {
    return null;
  }

  const hasReusableBlendBuffers =
    Array.isArray((frameState as Partial<MilkdropFrameState>).customWaves) &&
    Array.isArray((frameState as Partial<MilkdropFrameState>).motionVectors) &&
    typeof frameState.gpuGeometry === 'object' &&
    frameState.gpuGeometry !== null &&
    Array.isArray(frameState.gpuGeometry.customWaves);

  return {
    mode: 'gpu',
    previousFrame: hasReusableBlendBuffers
      ? {
          ...frameState,
          customWaves: frameState.customWaves.map(cloneWaveVisual),
          motionVectors: frameState.motionVectors.map(cloneMotionVectorVisual),
          gpuGeometry: {
            ...frameState.gpuGeometry,
            customWaves: frameState.gpuGeometry.customWaves.map(
              cloneProceduralCustomWaveVisual,
            ),
          },
        }
      : frameState,
    alpha: 1,
  };
}

/**
 * Rough per-frame geometry cost, used to decide whether a crossfade can
 * afford to draw two presets at once.
 *
 * The units are arbitrary — "segments, weighted by how expensive each kind
 * is to submit" — so the only meaningful way to set a threshold against it
 * is to measure the corpus. `scratch`-free reproduction:
 * `bun run lab:blend-gate`.
 */
export function estimateFrameBlendWorkload(
  frameState: MilkdropFrameState | null,
) {
  if (!frameState) {
    return 0;
  }

  const customWavePoints = frameState.customWaves.reduce(
    (total, wave) => total + Math.floor(wave.positions.length / 3),
    0,
  );
  const motionVectorSegments = frameState.motionVectors.length;

  return (
    Math.floor(frameState.mainWave.positions.length / 3) +
    customWavePoints +
    Math.floor(frameState.mesh.positions.length / 6) * 0.5 +
    motionVectorSegments * 2 +
    frameState.shapes.length * 10 +
    frameState.borders.length * 12 +
    frameState.trails.length * 8
  );
}

/**
 * Geometry ceiling above which a crossfade is refused outright.
 *
 * Calibrated against a 250-preset corpus sweep (`bun run lab:blend-gate`):
 * the floor is 1323 and the median 1651, because the warp mesh alone
 * contributes ~992 to every preset that has one. An earlier value of 900
 * therefore sat BELOW the corpus minimum and silently turned every single
 * crossfade into a cut — the blend path was unreachable in production for
 * as long as it existed. `blend-gate.test.ts` pins the floor so the
 * threshold can never drop under a realistic frame again.
 *
 * The value here sits above the corpus p90 (3401) and below the max
 * (10523), so it now catches only genuinely pathological frames — which is
 * what a static geometry gate can honestly do. Device pressure is handled
 * by the timing gate below instead, because it is the thing that actually
 * varies between a laptop in a booth and the machine the preset was
 * authored on.
 */
export const MAX_BLEND_WORKLOAD = 6000;

/**
 * How far over its frame budget the renderer may already be running and
 * still be asked to draw a second preset layer. Blending roughly doubles
 * geometry submission for its duration, so the headroom check is the honest
 * gate: a machine hitting budget can afford it, one already dropping frames
 * cannot.
 *
 * 2x, not something tighter. Against a 60Hz budget this refuses below about
 * 30fps and allows everything above it. An earlier 1.25x looked defensible
 * on paper and refused a machine running a perfectly serviceable 45fps —
 * which is most laptops driving a projector, i.e. exactly the case the
 * blend exists for. A gate this one has to earn its refusals: a crossfade
 * that silently does not happen is the failure mode this whole path is
 * being repaired for.
 */
const BLEND_FRAME_BUDGET_TOLERANCE = 2;

export type BlendPressureSnapshot = {
  rollingAverageFrameMs: number | null;
  frameBudgetMs: number;
  thermalState: 'nominal' | 'elevated' | 'throttling';
} | null;

export type BlendGateDecision = {
  canBlend: boolean;
  /** Why not, for the status line. Null when the blend is allowed. */
  refusal: 'workload' | 'frame-pressure' | 'thermal' | null;
};

/**
 * Decides whether the frame currently on screen can be crossfaded out of.
 *
 * Split out of `runtime.ts` so it is testable without a renderer: the bug
 * this replaces survived precisely because the decision only existed inside
 * a call path that needed a GPU to reach.
 */
export function evaluateBlendGate(
  frameState: MilkdropFrameState | null,
  pressure: BlendPressureSnapshot = null,
): BlendGateDecision {
  if (estimateFrameBlendWorkload(frameState) >= MAX_BLEND_WORKLOAD) {
    return { canBlend: false, refusal: 'workload' };
  }
  if (pressure?.thermalState === 'throttling') {
    return { canBlend: false, refusal: 'thermal' };
  }
  const rolling = pressure?.rollingAverageFrameMs ?? null;
  if (
    rolling !== null &&
    pressure !== null &&
    pressure.frameBudgetMs > 0 &&
    rolling > pressure.frameBudgetMs * BLEND_FRAME_BUDGET_TOLERANCE
  ) {
    return { canBlend: false, refusal: 'frame-pressure' };
  }
  return { canBlend: true, refusal: null };
}

export function isEditablePreset(
  entry: MilkdropCatalogEntry | undefined | null,
) {
  return entry?.origin === 'imported' || entry?.origin === 'user';
}
