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

/**
 * Energy eased toward the live value with a first-order lag, for UI that
 * pulses with the music (the dock meter, the launch trace). Each consumer
 * used to get this easing from a CSS `transition` on the property the energy
 * drives, but a transition restarted every animation frame is pathological
 * in Blink: on an RK3576 handheld the two transitions on the dock meter
 * (transform and opacity) cost ~30ms a frame in animation bookkeeping and
 * held the stage at 20fps with the GPU idle. Easing here means the consumer
 * writes a plain, untransitioned value.
 *
 * The store only notifies on change, so once the live value settles a rAF
 * tail keeps easing until the callback has converged on it.
 */
export function subscribeEasedAudioEnergy(
  callback: (energy: number) => void,
  timeConstantMs = 100,
): () => void {
  let eased = clampUnit(currentEnergy);
  let lastAt = performance.now();
  let tailFrame = 0;
  let disposed = false;

  const step = () => {
    tailFrame = 0;
    if (disposed) return;
    const now = performance.now();
    const target = clampUnit(currentEnergy);
    const alpha = 1 - Math.exp(-(now - lastAt) / timeConstantMs);
    lastAt = now;
    eased += (target - eased) * alpha;
    if (Math.abs(target - eased) < 0.002) {
      eased = target;
    } else if (typeof requestAnimationFrame === 'function') {
      tailFrame = requestAnimationFrame(step);
    }
    callback(eased);
  };

  callback(eased);
  const unsubscribe = subscribeAudioEnergy(() => {
    if (tailFrame === 0) step();
  });
  return () => {
    disposed = true;
    unsubscribe();
    if (tailFrame !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(tailFrame);
    }
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
