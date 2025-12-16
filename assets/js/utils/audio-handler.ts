import * as THREE from 'three';

type AudioAccessReason = 'unsupported' | 'denied' | 'unavailable';

export class AudioAccessError extends Error {
  reason: AudioAccessReason;

  constructor(reason: AudioAccessReason, message: string) {
    super(message);
    this.name = 'AudioAccessError';
    this.reason = reason;
  }
}

export async function initAudio(
  options: {
    fftSize?: number;
    camera?: THREE.Camera;
    positional?: boolean;
    object?: THREE.Object3D;
  } = {}
) {
  const { fftSize = 256, camera, positional = false, object } = options;

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
    const listener = new THREE.AudioListener();
    if (camera) {
      camera.add(listener);
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audio = positional
      ? new THREE.PositionalAudio(listener)
      : new THREE.Audio(listener);
    audio.setMediaStreamSource(stream);
    if (positional && object) {
      object.add(audio);
    }
    const analyser = new THREE.AudioAnalyser(audio, fftSize);

    return { analyser, listener, audio, stream };
  } catch (error) {
    console.error('Error accessing audio:', error);
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

export function getFrequencyData(analyser: THREE.AudioAnalyser) {
  return analyser.getFrequencyData();
}

/**
 * Compute the average value of frequency data.
 * Replaces the repeated inline `data.reduce((a, b) => a + b, 0) / data.length` pattern.
 */
export function getAverageFrequency(data: Uint8Array): number {
  if (data.length === 0) return 0;
  return data.reduce((a, b) => a + b, 0) / data.length;
}
