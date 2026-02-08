import type { AudioInitOptions, FrequencyAnalyser } from '../utils';
import { getAverageFrequency, getFrequencyData } from '../utils';

export interface AudioLoopToy {
  rendererReady?: Promise<unknown>;
  initAudio: (options?: AudioInitOptions) => Promise<unknown>;
  analyser: FrequencyAnalyser | null;
  renderer: {
    setAnimationLoop: ((callback: () => void) => void) | null;
  } | null;
}

/**
 * Context passed to animation callbacks.
 */
export interface AnimationContext {
  toy: AudioLoopToy;
  analyser: FrequencyAnalyser | null;
  time: number;
}

const fallbackBuffers = new Map<number, Uint8Array>();
const FALLBACK_BIN_COUNT = 64;
const SILENCE_THRESHOLD = 6;

function getFallbackBuffer(length: number): Uint8Array {
  if (!fallbackBuffers.has(length)) {
    fallbackBuffers.set(length, new Uint8Array(length));
  }
  return fallbackBuffers.get(length) as Uint8Array;
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

  for (let i = 0; i < len; i += 1) {
    const ratio = i / len;
    const wave =
      Math.sin(time * 1.5 + ratio * Math.PI * 4) * 0.6 +
      Math.sin(time * 0.7 + ratio * Math.PI * 2) * 0.4;
    const normalized = wave * 0.5 + 0.5;
    const value = base + normalized * amplitude;
    buffer[i] = Math.min(255, Math.max(0, Math.round(value)));
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
  const ctx: AnimationContext = { toy, analyser: toy.analyser, time: 0 };
  if (!toy.renderer?.setAnimationLoop) {
    throw new Error('Renderer is not available to start the animation loop.');
  }
  toy.renderer.setAnimationLoop(() => {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    ctx.time = now / 1000;
    animate(ctx);
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

  const data = getFrequencyData(ctx.analyser);
  if (data.length === 0) {
    const buffer = getFallbackBuffer(FALLBACK_BIN_COUNT);
    return fillSyntheticFrequencyData(buffer, time);
  }

  const average = getAverageFrequency(data);
  if (average >= SILENCE_THRESHOLD) {
    return data;
  }

  const buffer = getFallbackBuffer(data.length);
  fillSyntheticFrequencyData(buffer, time);
  const audioWeight = Math.max(0, average / SILENCE_THRESHOLD);
  const fallbackWeight = 1 - audioWeight;

  for (let i = 0; i < data.length; i += 1) {
    buffer[i] = Math.round(buffer[i] * fallbackWeight + data[i] * audioWeight);
  }

  return buffer;
}
