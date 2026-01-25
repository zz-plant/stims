import type { AnimationContext } from '../core/animation-loop';
import type { AudioInitOptions } from './audio-handler';
import { initAudio } from './audio-handler';
import { type StartAudioOptions, startToyAudio } from './start-audio';

type ToyAudioErrorHandler = (error: unknown) => void;

interface ToyAudioBootstrapOptions {
  onAudioInit?: (audio: Awaited<ReturnType<typeof initAudio>>) => void;
  onAudioError?: ToyAudioErrorHandler;
}

interface ToyAudioStartHandlers {
  onSuccess?: (ctx: AnimationContext) => void;
  onError?: ToyAudioErrorHandler;
}

// biome-ignore lint/suspicious/noExplicitAny: flexible toy instances in HTML modules
type ToyWithAudio = any;

export function createToyAudioBootstrap(
  toy: ToyWithAudio,
  options: ToyAudioBootstrapOptions = {},
) {
  const { onAudioInit, onAudioError } = options;

  const initAudioForToy = async (audioOptions: AudioInitOptions = {}) => {
    const audio = await initAudio(audioOptions);
    toy.analyser = audio.analyser;
    toy.audioCleanup = audio.cleanup;
    onAudioInit?.(audio);
    return audio;
  };

  const startAudio = async (
    animate: (ctx: AnimationContext) => void,
    audioOptions?: StartAudioOptions,
    handlers: ToyAudioStartHandlers = {},
  ): Promise<AnimationContext> => {
    try {
      const ctx = await startToyAudio(toy, animate, audioOptions);
      handlers.onSuccess?.(ctx);
      return ctx;
    } catch (error) {
      const handleError = handlers.onError ?? onAudioError;
      if (handleError) {
        handleError(error);
      } else {
        console.error('Error starting audio:', error);
      }
      throw error;
    }
  };

  toy.initAudio = initAudioForToy;

  return { initAudio: initAudioForToy, startAudio };
}
