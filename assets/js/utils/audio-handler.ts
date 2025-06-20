import * as THREE from 'three';

export async function initAudio(
  options: {
    fftSize?: number;
    camera?: THREE.Camera;
    positional?: boolean;
    object?: THREE.Object3D;
  } = {}
) {
  const { fftSize = 256, camera, positional = false, object } = options;
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
    throw new Error('Microphone access was denied.');
  }
}

export function getFrequencyData(analyser: THREE.AudioAnalyser) {
  return analyser.getFrequencyData();
}
