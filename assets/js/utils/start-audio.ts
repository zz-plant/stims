import type WebToy from '../core/web-toy';
import { AnimationContext, startAudioLoop } from '../core/animation-loop';

export async function startToyAudio(
  toy: WebToy,
  animate: (ctx: AnimationContext) => void,
  fftSize?: number
): Promise<AnimationContext> {
  try {
    return await startAudioLoop(toy, animate, fftSize ? { fftSize } : {});
  } catch (error) {
    console.error('Microphone access denied', error);
    throw error;
  }
}
