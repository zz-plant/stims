import type * as THREE from 'three';
import { getFrequencyData } from '../utils/audio-handler';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebToyInstance = any;

/**
 * Context passed to animation callbacks.
 */
export interface AnimationContext {
  toy: WebToyInstance;
  analyser: THREE.AudioAnalyser | null;
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
  toy: WebToyInstance,
  animate: (ctx: AnimationContext) => void,
  audioOptions: { fftSize?: number } = {}
): Promise<AnimationContext> {
  await toy.initAudio(audioOptions);
  const ctx: AnimationContext = { toy, analyser: toy.analyser };
  toy.renderer.setAnimationLoop(() => animate(ctx));
  return ctx;
}

/**
 * Get frequency data from the animation context, with fallback to empty array.
 */
export function getContextFrequencyData(ctx: AnimationContext): Uint8Array {
  return ctx.analyser ? getFrequencyData(ctx.analyser) : new Uint8Array(0);
}
