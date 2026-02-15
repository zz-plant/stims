import type { AudioInitOptions } from '../utils/audio-handler';
import {
  AudioAccessError,
  getCachedDemoAudioStream,
} from '../utils/audio-handler';
import {
  type AnimationContext,
  type AudioLoopToy,
  startAudioLoop,
} from './animation-loop';

export type ToyAudioRequest =
  | boolean
  | 'sample'
  | 'microphone'
  | (AudioInitOptions & {
      fallbackToSynthetic?: boolean;
      preferSynthetic?: boolean;
    })
  | undefined;

export function resolveToyAudioOptions(
  request: ToyAudioRequest,
  baseOptions: AudioInitOptions = {},
): AudioInitOptions & {
  fallbackToSynthetic?: boolean;
  preferSynthetic?: boolean;
} {
  if (request === 'sample') {
    return {
      ...baseOptions,
      preferSynthetic: true,
    };
  }

  if (request === 'microphone') {
    return {
      ...baseOptions,
      preferSynthetic: false,
    };
  }

  if (typeof request === 'boolean') {
    return {
      ...baseOptions,
      fallbackToSynthetic: request || baseOptions.fallbackToSynthetic,
      preferSynthetic: request,
    };
  }

  if (!request) {
    return baseOptions;
  }

  const { fallbackToSynthetic, preferSynthetic, ...rest } = request;
  return {
    ...baseOptions,
    ...rest,
    fallbackToSynthetic,
    preferSynthetic,
  };
}

export type StartAudioOptions =
  | (AudioInitOptions & {
      fallbackToSynthetic?: boolean;
      preferSynthetic?: boolean;
    })
  | number
  | undefined;

function normalizeStartAudioOptions(
  options: StartAudioOptions,
): AudioInitOptions & {
  fallbackToSynthetic?: boolean;
  preferSynthetic?: boolean;
} {
  if (typeof options === 'number') {
    return { fftSize: options };
  }

  return options ?? {};
}

export async function startToyAudio(
  toy: AudioLoopToy,
  animate: (ctx: AnimationContext) => void,
  options?: StartAudioOptions,
): Promise<AnimationContext> {
  const { fallbackToSynthetic, preferSynthetic, ...audioOptions } =
    normalizeStartAudioOptions(options);

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
