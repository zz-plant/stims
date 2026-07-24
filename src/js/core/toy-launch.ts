import type { ToyAudioRequest } from './toy-audio.ts';
import type { ToyWindow } from './toy-globals.ts';

const DEFAULT_POLL_DELAY_MS = 100;
const DEFAULT_POLL_ATTEMPTS = 30;

export type ToyLaunchAudioPreference = 'microphone' | 'demo' | 'none';
export type ToyLaunchAudioSource = 'microphone' | 'demo' | 'tab' | 'youtube';

export type ToyLaunchAudioRequest =
  | { source: 'microphone' }
  | { source: 'demo' }
  | { source: 'tab'; stream: MediaStream }
  | { source: 'youtube'; stream: MediaStream };

export type ToyLaunchRequest = {
  slug: string;
  container: HTMLElement;
  audioPreference?: ToyLaunchAudioPreference;
  audioRequest?: ToyLaunchAudioRequest;
  forceRendererRetry?: boolean;
};

export type ToyLaunchResult = {
  instance: unknown;
  audioStarterAvailable: boolean;
  supportedSources: ToyLaunchAudioSource[];
  startAudio?: (request: ToyLaunchAudioRequest) => Promise<unknown>;
};

function toToyAudioRequest(request: ToyLaunchAudioRequest): ToyAudioRequest {
  switch (request.source) {
    case 'microphone':
      return 'microphone';
    case 'demo':
      return 'sample';
    case 'tab':
    case 'youtube':
      return { stream: request.stream };
  }
}

async function waitForStarter(
  getStarter: () => ToyWindow['startAudio'] | ToyWindow['startAudioFallback'],
  errorMessage: string,
  {
    delayMs = DEFAULT_POLL_DELAY_MS,
    attempts = DEFAULT_POLL_ATTEMPTS,
  }: { delayMs?: number; attempts?: number } = {},
) {
  let starter = getStarter();
  if (typeof starter !== 'function') {
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      starter = getStarter();
      if (typeof starter === 'function') {
        break;
      }
    }
  }

  if (typeof starter !== 'function') {
    throw new Error(errorMessage);
  }

  return starter;
}

export async function resolveLegacyToyAudioStarter(
  win: ToyWindow,
  {
    waitForAvailability = true,
  }: {
    waitForAvailability?: boolean;
  } = {},
) {
  const getStarter = () => win.startAudioFallback ?? win.startAudio;
  const starter =
    typeof getStarter() === 'function'
      ? getStarter()
      : waitForAvailability
        ? await waitForStarter(getStarter, 'Audio starter unavailable.')
        : null;

  if (typeof starter !== 'function') {
    return {
      audioStarterAvailable: false,
      supportedSources: [] as ToyLaunchAudioSource[],
      startAudio: undefined,
    };
  }

  return {
    audioStarterAvailable: true,
    supportedSources: [
      'microphone',
      'demo',
      'tab',
      'youtube',
    ] as ToyLaunchAudioSource[],
    startAudio: async (request: ToyLaunchAudioRequest) => {
      if (
        request.source === 'demo' &&
        typeof win.startAudioFallback === 'function'
      ) {
        await waitForStarter(
          () => win.startAudioFallback ?? win.startAudio,
          'Demo audio unavailable.',
        );
        return win.startAudioFallback();
      }

      const resolvedStarter = await waitForStarter(
        () =>
          request.source === 'demo'
            ? (win.startAudioFallback ?? win.startAudio)
            : win.startAudio,
        request.source === 'microphone'
          ? 'Microphone starter unavailable.'
          : request.source === 'demo'
            ? 'Demo audio unavailable.'
            : 'Audio starter unavailable.',
      );

      return resolvedStarter(toToyAudioRequest(request));
    },
  };
}

export async function normalizeToyLaunchResult(
  instance: unknown,
  {
    windowRef,
    waitForAudioStarter = false,
  }: {
    windowRef?: ToyWindow | null;
    waitForAudioStarter?: boolean;
  } = {},
): Promise<ToyLaunchResult> {
  const win =
    windowRef ??
    ((typeof window === 'undefined' ? null : window) as ToyWindow | null);

  if (!win) {
    return {
      instance,
      audioStarterAvailable: false,
      supportedSources: [],
    };
  }

  const audioController = await resolveLegacyToyAudioStarter(win, {
    waitForAvailability: waitForAudioStarter,
  });

  return {
    instance,
    ...audioController,
  };
}
