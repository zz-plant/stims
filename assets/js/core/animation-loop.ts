import type {
  AudioInitOptions,
  FrequencyAnalyser,
} from '../utils/audio-handler';
import { getFrequencyData } from '../utils/audio-handler';

// biome-ignore lint/suspicious/noExplicitAny: generic toy instance
type WebToyInstance = any;

/**
 * Context passed to animation callbacks.
 */
export interface AnimationContext {
  toy: WebToyInstance;
  analyser: FrequencyAnalyser | null;
  time: number;
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
 * Get frequency data from the animation context, with fallback to empty array.
 */
export function getContextFrequencyData(ctx: AnimationContext): Uint8Array {
  return ctx.analyser ? getFrequencyData(ctx.analyser) : new Uint8Array(0);
}
