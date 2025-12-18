import type * as THREE from 'three';
import { AudioAccessError, getFrequencyData } from '../utils/audio-handler';
import type { AudioInitOptions } from '../utils/audio-handler';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebToyInstance = any;

/**
 * Context passed to animation callbacks.
 */
export interface AnimationContext {
  toy: WebToyInstance;
  analyser: THREE.AudioAnalyser | null;
}

export interface AudioLoopController {
  context: AnimationContext | null;
  error: AudioAccessError | null;
  start: () => Promise<AnimationContext>;
  retry: () => Promise<AnimationContext>;
  stop: () => void;
}

export interface StartAudioLoopOptions {
  autostart?: boolean;
}

function cleanupLoop(toy: WebToyInstance) {
  if (toy?.renderer?.setAnimationLoop) {
    toy.renderer.setAnimationLoop(null);
  }
  if (typeof toy.stopAudio === 'function') {
    toy.stopAudio();
  }
}

/**
 * Shared helper to initialize audio and start the animation loop.
 * Replaces duplicated startAudio() functions in each toy.
 *
 * @param toy - The WebToy instance
 * @param animate - Animation callback that receives the context
 * @param audioOptions - Optional audio initialization options
 * @param options - Controller options
 * @returns A controller with lifecycle callbacks
 */
export function startAudioLoop(
  toy: WebToyInstance,
  animate: (ctx: AnimationContext) => void,
  audioOptions: AudioInitOptions = {},
  options: StartAudioLoopOptions = {}
): AudioLoopController {
  let ctx: AnimationContext | null = null;
  let error: AudioAccessError | null = null;
  let isStarting = false;
  let startPromise: Promise<AnimationContext> | null = null;

  async function start() {
    if (startPromise) return startPromise;
    isStarting = true;
    error = null;
    cleanupLoop(toy);

    startPromise = (async () => {
      try {
        await toy.initAudio(audioOptions);
        ctx = { toy, analyser: toy.analyser };
        toy.renderer.setAnimationLoop(() => ctx && animate(ctx));
        return ctx as AnimationContext;
      } catch (err) {
        cleanupLoop(toy);
        if (err instanceof AudioAccessError) {
          error = err;
        }
        throw err;
      } finally {
        isStarting = false;
      }
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  function stop() {
    cleanupLoop(toy);
    ctx = null;
    startPromise = null;
    isStarting = false;
  }

  async function retry() {
    stop();
    return start();
  }

  if (options.autostart) {
    void start().catch(() => null);
  }

  return {
    get context() {
      return ctx;
    },
    get error() {
      return error;
    },
    start,
    retry,
    stop,
  };
}

/**
 * Get frequency data from the animation context, with fallback to empty array.
 */
export function getContextFrequencyData(ctx: AnimationContext): Uint8Array {
  return ctx.analyser ? getFrequencyData(ctx.analyser) : new Uint8Array(0);
}
