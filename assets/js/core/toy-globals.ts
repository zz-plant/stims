import type { ToyAudioRequest } from '../utils';

export interface ToyWindow extends Window {
  startAudio?: (request?: ToyAudioRequest) => Promise<unknown>;
  startAudioFallback?: () => Promise<unknown>;
}

export function registerToyGlobals(
  container: HTMLElement | null | undefined,
  startAudio: (request?: ToyAudioRequest) => Promise<unknown>,
) {
  const win = (container?.ownerDocument.defaultView ??
    window) as unknown as ToyWindow;
  win.startAudio = startAudio;
  win.startAudioFallback = () => startAudio(true);

  return () => {
    win.startAudio = undefined;
    win.startAudioFallback = undefined;
  };
}
