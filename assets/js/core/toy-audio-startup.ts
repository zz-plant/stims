import type { ToyAudioRequest } from './toy-audio';
import type { ToyWindow } from './toy-globals';

const DEFAULT_POLL_DELAY_MS = 100;
const DEFAULT_POLL_ATTEMPTS = 30;

export type ToyAudioStartSource = 'microphone' | 'demo' | 'tab' | 'youtube';

export type ToyAudioStartRequest =
  | { source: 'microphone' }
  | { source: 'demo' }
  | { source: 'tab'; stream: MediaStream }
  | { source: 'youtube'; stream: MediaStream };

function toToyAudioRequest(request: ToyAudioStartRequest): ToyAudioRequest {
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

export async function startToyAudioFromSource(
  win: ToyWindow,
  request: ToyAudioStartRequest,
) {
  if (
    request.source === 'demo' &&
    typeof win.startAudioFallback === 'function'
  ) {
    await waitForStarter(
      () => win.startAudioFallback ?? win.startAudio,
      'Demo audio unavailable.',
    );
    await win.startAudioFallback();
    return;
  }

  const starter = await waitForStarter(
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

  await starter(toToyAudioRequest(request));
}

export async function ensureToyAudioStarter(win: ToyWindow) {
  await waitForStarter(
    () => win.startAudioFallback ?? win.startAudio,
    'Audio starter unavailable.',
  );
}
