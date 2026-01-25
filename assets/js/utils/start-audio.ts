import { type AnimationContext, startAudioLoop } from '../core/animation-loop';
import type WebToy from '../core/web-toy';
import type { AudioInitOptions } from './audio-handler';
import { AudioAccessError, getCachedDemoAudioStream } from './audio-handler';

export type StartAudioOptions =
  | (AudioInitOptions & {
      fallbackToSynthetic?: boolean;
      preferSynthetic?: boolean;
    })
  | number
  | undefined;

function normalizeOptions(options: StartAudioOptions): AudioInitOptions & {
  fallbackToSynthetic?: boolean;
  preferSynthetic?: boolean;
} {
  if (typeof options === 'number') {
    return { fftSize: options };
  }

  return options ?? {};
}

export async function startToyAudio(
  toy: WebToy,
  animate: (ctx: AnimationContext) => void,
  options?: StartAudioOptions,
): Promise<AnimationContext> {
  const { fallbackToSynthetic, preferSynthetic, ...audioOptions } =
    normalizeOptions(options);

  const runWithSynthetic = async (
    syntheticOptions: AudioInitOptions,
  ): Promise<AnimationContext> => {
    const synthetic = getCachedDemoAudioStream();
    const syntheticCleanup = () => {
      void synthetic.cleanup();
    };

    try {
      return await startAudioLoop(toy, animate, {
        ...syntheticOptions,
        stream: synthetic.stream,
        onCleanup: (ctx) => {
          syntheticCleanup();
          syntheticOptions.onCleanup?.(ctx);
        },
      });
    } catch (error) {
      syntheticCleanup();
      throw error;
    }
  };

  if (preferSynthetic) {
    return runWithSynthetic(audioOptions);
  }

  try {
    return await startAudioLoop(toy, animate, audioOptions);
  } catch (error) {
    if (fallbackToSynthetic && error instanceof AudioAccessError) {
      return runWithSynthetic(audioOptions);
    }

    console.error('Microphone access denied', error);
    throw error;
  }
}
