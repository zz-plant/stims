import type WebToy from '../core/web-toy';
import { AnimationContext, startAudioLoop } from '../core/animation-loop';
import type { AudioInitOptions } from './audio-handler';
import { AudioAccessError, createSyntheticAudioStream } from './audio-handler';

type StartAudioOptions =
  | (AudioInitOptions & {
      fallbackToSynthetic?: boolean;
      preferSynthetic?: boolean;
    })
  | number
  | undefined;

function normalizeOptions(options: StartAudioOptions): AudioInitOptions & {
  fallbackToSynthetic?: boolean;
} {
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
  const { fallbackToSynthetic, preferSynthetic, ...audioOptions } =
    normalizeOptions(options);

  if (preferSynthetic) {
    const synthetic = createSyntheticAudioStream();

    const syntheticCleanup = () => {
      synthetic.cleanup();
    };

    return startAudioLoop(toy, animate, {
      ...audioOptions,
      stream: synthetic.stream,
      onCleanup: (ctx) => {
        syntheticCleanup();
        audioOptions.onCleanup?.(ctx);
      },
    });
  }

  try {
    return await startAudioLoop(toy, animate, audioOptions);
  } catch (error) {
    if (fallbackToSynthetic && error instanceof AudioAccessError) {
      const synthetic = createSyntheticAudioStream();

      const syntheticCleanup = () => {
        synthetic.cleanup();
      };

      return startAudioLoop(toy, animate, {
        ...audioOptions,
        stream: synthetic.stream,
        onCleanup: (ctx) => {
          syntheticCleanup();
          audioOptions.onCleanup?.(ctx);
        },
      });
    }

    console.error('Microphone access denied', error);
    throw error;
  }
}
