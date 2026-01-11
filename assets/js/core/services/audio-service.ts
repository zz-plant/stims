import type * as THREE from 'three';
import {
  type AudioInitOptions,
  type FrequencyAnalyser,
  getMicrophonePermissionState,
  initAudio,
} from '../../utils/audio-handler.ts';

export type AudioHandle = {
  analyser: FrequencyAnalyser;
  listener: THREE.AudioListener;
  audio: THREE.Audio | THREE.PositionalAudio;
  stream?: MediaStream;
  release: () => void;
};

type AudioPoolEntry = {
  stream: MediaStream;
  users: number;
};

let pooledStream: AudioPoolEntry | null = null;
let streamPromise: Promise<MediaStream | null> | null = null;

function stopPooledStream() {
  if (pooledStream?.stream) {
    pooledStream.stream.getTracks().forEach((track) => track.stop());
  }

  pooledStream = null;
  streamPromise = null;
}

async function getOrCreateStream(constraints?: MediaStreamConstraints) {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error('Microphone capture is not available in this environment.');
  }

  if (pooledStream?.stream) return pooledStream.stream;
  if (streamPromise) return streamPromise;

  streamPromise = navigator.mediaDevices
    ?.getUserMedia(constraints ?? { audio: { echoCancellation: true } })
    .catch((error) => {
      streamPromise = null;
      throw error;
    });

  const stream = await streamPromise;
  if (!stream) return null;

  pooledStream = { stream, users: 0 };
  return stream;
}

export async function acquireAudioHandle(
  options: AudioInitOptions & {
    reuseMicrophone?: boolean;
    initAudioImpl?: typeof initAudio;
    teardownOnRelease?: boolean;
  } = {},
): Promise<AudioHandle> {
  const {
    reuseMicrophone = true,
    initAudioImpl = initAudio,
    teardownOnRelease = false,
    ...audioOptions
  } = options;

  let stream: MediaStream | null = audioOptions.stream ?? null;

  if (reuseMicrophone && !stream) {
    stream = await getOrCreateStream(audioOptions.constraints);
    if (stream && pooledStream) {
      pooledStream.users += 1;
    }
  }

  const audio = await initAudioImpl({
    ...audioOptions,
    stream: stream ?? audioOptions.stream,
    stopStreamOnCleanup: !reuseMicrophone,
  });

  const release = () => {
    audio.cleanup?.();

    if (reuseMicrophone && pooledStream && stream === pooledStream.stream) {
      pooledStream.users = Math.max(0, pooledStream.users - 1);

      if (pooledStream.users === 0 && (teardownOnRelease || reuseMicrophone)) {
        stopPooledStream();
      }
    }
  };

  return {
    analyser: audio.analyser,
    listener: audio.listener,
    audio: audio.audio,
    stream: audio.stream,
    release,
  };
}

export async function prewarmMicrophone(constraints?: MediaStreamConstraints) {
  const permission = await getMicrophonePermissionState();
  if (permission !== 'granted') return permission;

  await getOrCreateStream(constraints);
  return permission;
}

export async function resetAudioPool({ stopStreams = true } = {}) {
  if (stopStreams) {
    stopPooledStream();
    return;
  }

  pooledStream = null;
  streamPromise = null;
}
