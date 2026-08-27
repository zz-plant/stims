import type { AudioInitOptions, FrequencyAnalyser } from './audio-handler';
import { getFrequencyFrame } from './audio-handler';
import { createFrameGate } from './frame-pacing';
import { getPowerSavingFrameCapHz } from './power-state';

export {
  createSimulationAccumulator,
  type SimulationAccumulator,
  type SimulationAccumulatorOptions,
} from './simulation-accumulator';

/** Optional virtual time source for deterministic testing/capture.
 * When set, `performance.now()` is replaced by this function.
 * Expected to return monotonically increasing milliseconds. */
export let virtualTimeSource: (() => number) | null = null;
let virtualTimeAdvanceMs = 0;

export function setVirtualTimeSource(
  fn: (() => number) | null,
  advanceMs = 1000 / 60,
) {
  virtualTimeSource = fn;
  virtualTimeAdvanceMs = advanceMs;
}

export function getVirtualTimeAdvanceMs(): number {
  return virtualTimeAdvanceMs;
}

export function now(): number {
  if (virtualTimeSource) {
    return virtualTimeSource();
  }
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export interface AudioLoopToy {
  rendererReady?: Promise<unknown>;
  initAudio: (options?: AudioInitOptions) => Promise<unknown>;
  analyser: FrequencyAnalyser | null;
  renderer: {
    setAnimationLoop: ((callback: (() => void) | null) => void) | null;
    xr?: { isPresenting?: boolean } | null;
  } | null;
}

/**
 * Context passed to animation callbacks.
 */
export interface AnimationContext {
  toy: AudioLoopToy;
  analyser: FrequencyAnalyser | null;
  time: number;
  realTimeMs: number;
}

const fallbackBuffers = new Map<number, Uint8Array>();
const FALLBACK_BIN_COUNT = 512;
const SILENCE_THRESHOLD = 6;

function getFallbackBuffer(length: number): Uint8Array {
  if (!fallbackBuffers.has(length)) {
    fallbackBuffers.set(length, new Uint8Array(length));
  }
  return fallbackBuffers.get(length) as Uint8Array;
}

const SYNTHETIC_PHASE_1 = new Float32Array(FALLBACK_BIN_COUNT);
const SYNTHETIC_PHASE_2 = new Float32Array(FALLBACK_BIN_COUNT);
for (let i = 0; i < FALLBACK_BIN_COUNT; i += 1) {
  const ratio = i / FALLBACK_BIN_COUNT;
  SYNTHETIC_PHASE_1[i] = ratio * Math.PI * 4;
  SYNTHETIC_PHASE_2[i] = ratio * Math.PI * 2;
}

function fillSyntheticFrequencyData(
  buffer: Uint8Array,
  time: number,
): Uint8Array {
  const len = buffer.length;
  const pulse = (Math.sin(time * 0.8) + 1) / 2;
  const ripple = (Math.sin(time * 0.35) + 1) / 2;
  const base = 18 + pulse * 12;
  const amplitude = 24 + ripple * 28;
  const timeOffset1 = time * 1.5;
  const timeOffset2 = time * 0.7;

  for (let i = 0; i < len; i += 1) {
    const phase1 = SYNTHETIC_PHASE_1[i] ?? (i / len) * Math.PI * 4;
    const phase2 = SYNTHETIC_PHASE_2[i] ?? (i / len) * Math.PI * 2;
    const wave =
      Math.sin(timeOffset1 + phase1) * 0.6 +
      Math.sin(timeOffset2 + phase2) * 0.4;
    const normalized = wave * 0.5 + 0.5;
    const value = base + normalized * amplitude;
    buffer[i] = value > 255 ? 255 : value < 0 ? 0 : (value + 0.5) | 0;
  }

  return buffer;
}

/**
 * Shared helper to initialize audio and start the animation loop.
 * Replaces duplicated startAudio() functions in each toy.
 *
 * @param toy - The WebToy instance
 * @param animate - Animation callback that receives the context
 * @param audioOptions - Optional audio initialization options
 * @returns The animation context
 */
export async function startAudioLoop(
  toy: AudioLoopToy,
  animate: (ctx: AnimationContext) => void,
  audioOptions: AudioInitOptions = {},
): Promise<AnimationContext> {
  if (toy.rendererReady) {
    await toy.rendererReady;
  }
  await toy.initAudio(audioOptions);
  const ctx: AnimationContext = {
    toy,
    analyser: toy.analyser,
    time: 0,
    realTimeMs: 0,
  };
  if (!toy.renderer?.setAnimationLoop) {
    throw new Error('Renderer is not available to start the animation loop.');
  }
  // three.js schedules the next frame only after the callback returns, so a
  // single uncaught throw would freeze the visual permanently. Guard each
  // frame and stop only after a sustained failure streak.
  let failureStreak = 0;
  // Power-saver frame ceiling. Gating here rather than inside each toy keeps the
  // skip ahead of every simulation and draw call, and covers both renderer
  // backends — WebGL's native scheduling and the WebGPU recovery-aware loop both
  // funnel through this callback.
  const frameGate = createFrameGate(getPowerSavingFrameCapHz);
  toy.renderer.setAnimationLoop(() => {
    const nowMs = now();
    // An XR session owns its own presentation cadence; dropping frames there
    // reads as head-tracking judder, not as a power saving.
    if (
      !toy.renderer?.xr?.isPresenting &&
      !frameGate.shouldRenderFrame(nowMs)
    ) {
      return;
    }
    ctx.time = nowMs / 1000;
    ctx.realTimeMs = nowMs;
    try {
      animate(ctx);
      failureStreak = 0;
    } catch (error) {
      failureStreak += 1;
      if (failureStreak === 1) {
        console.warn('[stims] Animation frame failed; continuing.', error);
      }
      if (failureStreak >= 60) {
        console.error(
          '[stims] Animation loop stopped after repeated frame failures.',
          error,
        );
        toy.renderer?.setAnimationLoop?.(null);
      }
    }
  });
  return ctx;
}

/**
 * Get frequency data from the animation context, with fallback to synthetic motion.
 */
export function getContextFrequencyData(ctx: AnimationContext): Uint8Array {
  const time = ctx.time ?? 0;

  if (!ctx.analyser) {
    const buffer = getFallbackBuffer(FALLBACK_BIN_COUNT);
    return fillSyntheticFrequencyData(buffer, time);
  }

  const { data, average } = getFrequencyFrame(ctx.analyser);
  if (data.length === 0) {
    const buffer = getFallbackBuffer(FALLBACK_BIN_COUNT);
    return fillSyntheticFrequencyData(buffer, time);
  }

  if (average >= SILENCE_THRESHOLD) {
    return data;
  }

  const buffer = getFallbackBuffer(data.length);
  fillSyntheticFrequencyData(buffer, time);
  const audioWeight = Math.max(0, average / SILENCE_THRESHOLD);
  const fallbackWeight = 1 - audioWeight;

  for (let i = 0; i < data.length; i += 1) {
    buffer[i] = (buffer[i] * fallbackWeight + data[i] * audioWeight + 0.5) | 0;
  }

  return buffer;
}
