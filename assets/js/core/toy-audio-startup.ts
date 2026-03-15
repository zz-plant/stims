import type { ToyWindow } from './toy-globals.ts';
import {
  resolveLegacyToyAudioStarter,
  type ToyLaunchAudioRequest as ToyAudioStartRequest,
} from './toy-launch.ts';

export async function startToyAudioFromSource(
  win: ToyWindow,
  request: ToyAudioStartRequest,
) {
  const audioController = await resolveLegacyToyAudioStarter(win);
  if (!audioController.startAudio) {
    throw new Error('Audio starter unavailable.');
  }
  await audioController.startAudio(request);
}

export async function ensureToyAudioStarter(win: ToyWindow) {
  const audioController = await resolveLegacyToyAudioStarter(win);
  if (!audioController.audioStarterAvailable) {
    throw new Error('Audio starter unavailable.');
  }
}
