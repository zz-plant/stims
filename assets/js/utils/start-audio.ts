import type WebToy from '../core/web-toy';
import type { AudioLoopController } from '../core/animation-loop';
import { startAudioLoop } from '../core/animation-loop';
import type { AudioInitOptions } from './audio-handler';

type StartAudioOptions = (AudioInitOptions & { autostart?: boolean }) | number | undefined;

function normalizeOptions(
  options: StartAudioOptions
): { audio: AudioInitOptions; autostart?: boolean } {
  if (typeof options === 'number') {
    return { audio: { fftSize: options } };
  }

  if (!options) return { audio: {} };

  const { autostart, ...audio } = options;
  return { audio, autostart };
}

export function startToyAudio(
  toy: WebToy,
  animate: Parameters<typeof startAudioLoop>[1],
  options?: StartAudioOptions
): AudioLoopController {
  const { audio, autostart } = normalizeOptions(options);
  return startAudioLoop(toy, animate, audio, { autostart });
}
