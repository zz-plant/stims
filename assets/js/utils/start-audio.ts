import type WebToy from '../core/web-toy';
import { AnimationContext, startAudioLoop } from '../core/animation-loop';
import type { AudioInitOptions } from './audio-handler';
import {
  AudioAccessError,
  createDemoTrackStream,
  createSyntheticAudioStream,
} from './audio-handler';

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

  const startWithStream = async (
    streamFactory: () => Promise<{ stream: MediaStream; cleanup: () => void }>
  ) => {
    const source = await streamFactory();
    return startAudioLoop(toy, animate, {
      ...audioOptions,
      stream: source.stream,
      onCleanup: (ctx) => {
        source.cleanup();
        audioOptions.onCleanup?.(ctx);
      },
    });
  };

  const tryDemoTrack = async () => {
    try {
      return await startWithStream(() => createDemoTrackStream());
    } catch (error) {
      console.warn('Demo track unavailable; falling back to synthetic audio', error);
      return null;
    }
  };

  const startSynthetic = async () => {
    const synthetic = createSyntheticAudioStream();
    return startAudioLoop(toy, animate, {
      ...audioOptions,
      stream: synthetic.stream,
      onCleanup: (ctx) => {
        synthetic.cleanup();
        audioOptions.onCleanup?.(ctx);
      },
    });
  };

  if (preferSynthetic) {
    const demo = await tryDemoTrack();
    if (demo) return demo;
    return startSynthetic();
  }

  try {
    return await startAudioLoop(toy, animate, audioOptions);
  } catch (error) {
    if (fallbackToSynthetic && error instanceof AudioAccessError) {
      const demo = await tryDemoTrack();
      if (demo) return demo;
      return startSynthetic();
    }

    console.error('Microphone access denied', error);
    throw error;
  }
}
