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

export function setAudioBandScalars(
  bass: number,
  mid: number,
  treble: number,
): void {
  if (
    Math.abs(bass - currentBands.bass) < 0.001 &&
    Math.abs(mid - currentBands.mid) < 0.001 &&
    Math.abs(treble - currentBands.treble) < 0.001
  ) {
    return;
  }
  currentBands = { bass, mid, treble };
  for (const sub of subscribers) sub();
}

export function setAudioBands(bands: AudioBands): void {
  setAudioBandScalars(bands.bass, bands.mid, bands.treble);
}

export function subscribeAudioEnergy(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
