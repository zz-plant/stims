import type { PerspectiveCamera } from 'three';
import {
  type AudioHandle,
  acquireAudioHandle,
} from './services/audio-service.ts';

export function createToyAudioSession({
  camera,
}: {
  camera: PerspectiveCamera;
}) {
  let audioHandle: AudioHandle | null = null;

  return {
    getHandle: () => audioHandle,
    async initAudio(options = {}) {
      audioHandle?.release?.();
      audioHandle = await acquireAudioHandle({ ...options, camera });
      return audioHandle;
    },
    dispose: () => {
      if (!audioHandle) {
        return;
      }
      audioHandle.release();
      audioHandle = null;
    },
  };
}
