let currentEnergy = 0;
// Spectral balance alongside loudness. The catalog search used to describe
// music from this single scalar, which meant two tracks at equal volume were
// indistinguishable to it no matter how differently they were voiced.
let currentBands: AudioBands = { bass: 0, mid: 0, treble: 0 };
const subscribers = new Set<() => void>();

export type AudioBands = { bass: number; mid: number; treble: number };

export function getAudioEnergy(): number {
  return currentEnergy;
}

/** Attenuated band levels on MilkDrop's ~1.0-is-nominal scale. */
export function getAudioBands(): AudioBands {
  return currentBands;
}

export function setAudioEnergy(value: number): void {
  if (Math.abs(value - currentEnergy) < 0.001) return;
  currentEnergy = value;
  for (const sub of subscribers) sub();
}

export function setAudioBands(bands: AudioBands): void {
  // Same dead-band as the energy setter: these update every frame during
  // playback and every change wakes every subscriber.
  if (
    Math.abs(bands.bass - currentBands.bass) < 0.001 &&
    Math.abs(bands.mid - currentBands.mid) < 0.001 &&
    Math.abs(bands.treble - currentBands.treble) < 0.001
  ) {
    return;
  }
  currentBands = bands;
  for (const sub of subscribers) sub();
}

export function subscribeAudioEnergy(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
