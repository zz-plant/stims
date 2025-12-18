import * as THREE from 'three';

export type FrequencyAnalyser = {
  getFrequencyData(): Uint8Array;
  averageLevel: number;
};

type AudioAccessReason = 'unsupported' | 'denied' | 'unavailable';

export class AudioAccessError extends Error {
  reason: AudioAccessReason;

  constructor(reason: AudioAccessReason, message: string) {
    super(message);
    this.name = 'AudioAccessError';
    this.reason = reason;
  }
}

export type AudioInitOptions = {
  fftSize?: number;
  camera?: THREE.Camera;
  positional?: boolean;
  object?: THREE.Object3D;
  constraints?: MediaStreamConstraints;
  stream?: MediaStream;
  onCleanup?: (ctx: {
    analyser: FrequencyAnalyser;
    listener: THREE.AudioListener;
    audio: THREE.Audio | THREE.PositionalAudio;
    stream?: MediaStream;
  }) => void;
};

class WorkletAnalyser implements FrequencyAnalyser {
  frequencyData: Uint8Array;
  averageLevel: number;
  node: AudioWorkletNode;

  constructor(node: AudioWorkletNode, fftSize: number) {
    this.node = node;
    this.frequencyData = new Uint8Array(fftSize / 2);
    this.averageLevel = 0;

    this.node.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === 'fft') {
        if (message.data) {
          this.frequencyData = new Uint8Array(message.data);
        }
        if (typeof message.average === 'number') {
          this.averageLevel = message.average;
        }
      }
    };
  }

  disconnect() {
    this.node.port.onmessage = null;
  }

  getFrequencyData() {
    return this.frequencyData;
  }
}

export function createSyntheticAudioStream({
  frequency = 220,
  type = 'sawtooth',
  gain = 0.12,
}: {
  frequency?: number;
  type?: OscillatorType;
  gain?: number;
} = {}) {
  const context = new AudioContext();

  const oscillator = context.createOscillator();
  oscillator.frequency.value = frequency;
  oscillator.type = type;

  const gainNode = context.createGain();
  gainNode.gain.value = gain;

  const destination = context.createMediaStreamDestination();

  oscillator.connect(gainNode);
  gainNode.connect(destination);

  oscillator.start();

  const cleanup = () => {
    try {
      oscillator.stop();
    } catch (error) {
      console.error('Error stopping synthetic oscillator', error);
    }

    oscillator.disconnect();
    gainNode.disconnect();
    context.close();
  };

  return { stream: destination.stream, cleanup };
}

export async function initAudio(options: AudioInitOptions = {}) {
  const {
    fftSize = 256,
    camera,
    positional = false,
    object,
    constraints,
    stream,
    onCleanup,
  } = options;

  let listener: THREE.AudioListener | null = null;
  let resolvedStream: MediaStream | null = null;
  let ownsStream = false;

  if (typeof navigator === 'undefined') {
    throw new AudioAccessError(
      'unsupported',
      'Audio capture is not available in this environment.'
    );
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new AudioAccessError(
      'unsupported',
      'This browser does not support microphone capture.'
    );
  }

  try {
    listener = new THREE.AudioListener();
    if (camera) {
      camera.add(listener);
    }

    if (stream) {
      resolvedStream = stream;
    } else {
      resolvedStream = await navigator.mediaDevices.getUserMedia(
        constraints ?? { audio: { echoCancellation: true } }
      );
      ownsStream = true;
    }

    const streamSource = resolvedStream;
    if (!streamSource) {
      throw new AudioAccessError(
        'unavailable',
        'Microphone access is unavailable. Please check your device settings.'
      );
    }

    const audio = positional
      ? new THREE.PositionalAudio(listener)
      : new THREE.Audio(listener);
    audio.setMediaStreamSource(streamSource);
    const context = listener.context as AudioContext;

    if (!context.audioWorklet?.addModule) {
      throw new AudioAccessError(
        'unsupported',
        'AudioWorklet is not supported in this browser.'
      );
    }

    await context.audioWorklet.addModule(
      new URL('../worklets/audio-analyser.worklet.ts', import.meta.url)
    );

    const workletNode = new AudioWorkletNode(context, 'audio-analyser', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { fftSize },
    });

    const gainNode = context.createGain();
    gainNode.gain.value = 0;

    const sourceNode =
      (audio as THREE.Audio & { source?: MediaStreamAudioSourceNode }).source ||
      context.createMediaStreamSource(streamSource);

    sourceNode.connect(workletNode);
    workletNode.connect(gainNode);
    gainNode.connect(context.destination);

    if (positional && object) {
      object.add(audio);
    }
    const analyser = new WorkletAnalyser(workletNode, fftSize);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      if (audio && 'stop' in audio && typeof audio.stop === 'function') {
        audio.stop();
      }

      if (
        audio &&
        'disconnect' in audio &&
        typeof audio.disconnect === 'function'
      ) {
        audio.disconnect();
      }

      workletNode.disconnect();
      gainNode.disconnect();
      sourceNode.disconnect();
      analyser.disconnect();

      if (streamSource) {
        streamSource.getTracks().forEach((track) => track.stop());
      }

      if (camera && 'remove' in camera && listener) {
        (
          camera as THREE.Camera & { remove?: (obj: THREE.Object3D) => void }
        ).remove(listener);
      }

      if (listener?.context?.close) {
        listener.context.close();
      }

      if (positional && object && 'remove' in object) {
        (object as THREE.Object3D & { remove?: (obj: THREE.Object3D) => void })
          .remove?.(audio);
      }

      onCleanup?.({ analyser, listener, audio, stream: streamSource });
    };

    return { analyser, listener, audio, stream: streamSource, cleanup };
  } catch (error) {
    console.error('Error accessing audio:', error);

    if (resolvedStream && ownsStream) {
      resolvedStream.getTracks().forEach((track) => track.stop());
    }

    if (listener?.context?.close) {
      listener.context.close();
    }

    if (camera && 'remove' in camera && listener) {
      (
        camera as THREE.Camera & { remove?: (obj: THREE.Object3D) => void }
      ).remove(listener);
    }

    if (error instanceof AudioAccessError) {
      throw error;
    }

    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      ((error as Error).name === 'NotAllowedError' ||
        (error as Error).name === 'PermissionDeniedError')
    ) {
      throw new AudioAccessError(
        'denied',
        'Microphone access was denied by the user.'
      );
    }

    throw new AudioAccessError(
      'unavailable',
      'Microphone access is unavailable. Please check your device settings.'
    );
  }
}

export function getFrequencyData(analyser: FrequencyAnalyser) {
  return analyser.getFrequencyData();
}

/**
 * Compute the average value of frequency data.
 * Replaces the repeated inline `data.reduce((a, b) => a + b, 0) / data.length` pattern.
 */
export function getAverageFrequency(data: Uint8Array): number {
  if (data.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i];
  }

  return sum / data.length;
}
