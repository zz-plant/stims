import * as THREE from 'three';

export async function initAudio(
  options: { fftSize?: number; camera?: THREE.Camera } = {}
) {
  const { fftSize = 256, camera } = options;
  try {
    const listener = new THREE.AudioListener();
    if (camera) {
      camera.add(listener);
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audio = new THREE.Audio(listener);
    audio.setMediaStreamSource(stream);
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
