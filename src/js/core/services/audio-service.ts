import type * as THREE from 'three';
import {
  type AudioInitOptions,
  classifyAudioAccessError,
  DEFAULT_MICROPHONE_CONSTRAINTS,
  type FrequencyAnalyser,
  getMicrophonePermissionState,
  initAudio,
} from '../audio-handler';

export type AudioHandle = {
  analyser: FrequencyAnalyser;
  listener: THREE.AudioListener;
  audio: THREE.Audio | THREE.PositionalAudio;
  stream?: MediaStream;
  release: () => void | Promise<void>;
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

  if (pooledStream?.stream) {
    const isLive = pooledStream.stream
      .getAudioTracks()
      .some((track) => track.readyState !== 'ended');
    if (isLive) return pooledStream.stream;
    // The pooled stream's track ended out from under us (permission
    // revoked, device unplugged) — don't hand a dead stream to the next
    // caller. Tear the pool down so we acquire a fresh stream below.
    stopPooledStream();
  }
  if (streamPromise) return streamPromise;

  streamPromise = navigator.mediaDevices
    ?.getUserMedia(constraints ?? DEFAULT_MICROPHONE_CONSTRAINTS)
    .catch((error) => {
      streamPromise = null;
      // Classify through the same mapping initAudio uses, so callers that
      // opted into fallbackToSynthetic (via AudioAccessError detection)
      // still get it on the pooled path, and denials surface the same
      // actionable message either way.
      throw classifyAudioAccessError(error);
    });

  const stream = await streamPromise;
  if (!stream) return null;

  pooledStream = { stream, users: 0 };
  // Proactively tear the pool down the moment the live track ends, rather
  // than waiting for the next getOrCreateStream() call to notice — any
  // consumer still holding a reference to acquire an AudioHandle for this
  // stream still gets the dedicated initAudio-level onStreamEnded callback.
  for (const track of stream.getAudioTracks?.() ?? []) {
    track.addEventListener(
      'ended',
      () => {
        if (pooledStream?.stream === stream) {
          stopPooledStream();
        }
      },
      { once: true },
    );
  }
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
  let pooledEntry: AudioPoolEntry | null = null;

  if (reuseMicrophone && !stream) {
    stream = await getOrCreateStream(audioOptions.constraints);
    if (stream && pooledStream) {
      pooledStream.users += 1;
      pooledEntry = pooledStream;
    }
  }

  let audio: Awaited<ReturnType<typeof initAudioImpl>>;
  try {
    audio = await initAudioImpl({
      ...audioOptions,
      stream: stream ?? audioOptions.stream,
      stopStreamOnCleanup: audioOptions.stopStreamOnCleanup ?? !reuseMicrophone,
      closeContextOnCleanup:
        audioOptions.closeContextOnCleanup ?? !reuseMicrophone,
    });
  } catch (error) {
    if (pooledEntry) {
      pooledEntry.users = Math.max(0, pooledEntry.users - 1);
      if (pooledEntry.users === 0) {
        stopPooledStream();
      }
    }
    throw error;
  }

  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    const cleanupResult = audio.cleanup?.();

    if (reuseMicrophone && pooledStream && stream === pooledStream.stream) {
      pooledStream.users = Math.max(0, pooledStream.users - 1);

      if (pooledStream.users === 0 && teardownOnRelease) {
        stopPooledStream();
      }
    }
    return cleanupResult;
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
