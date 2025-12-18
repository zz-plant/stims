import type WebToy from '../core/web-toy';
import { AnimationContext, startAudioLoop } from '../core/animation-loop';
import type { AudioInitOptions } from './audio-handler';

type StartAudioOptions = AudioInitOptions | number | undefined;

function normalizeOptions(options: StartAudioOptions): AudioInitOptions {
  if (typeof options === 'number') {
    return { fftSize: options };
  }

  return options ?? {};
}

export async function startToyAudio(
  toy: WebToy,
  animate: (ctx: AnimationContext) => void,
  options?: StartAudioOptions
): Promise<AnimationContext> {
  try {
    return await startAudioLoop(toy, animate, normalizeOptions(options));
  } catch (error) {
    console.error('Microphone access denied', error);
    throw error;
  }
}
