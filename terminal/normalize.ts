export interface Normalizer {
  gain: number;
  raw: number;
  target: number;
  windowMs: number;
  maxGain: number;
}

export function createNormalizer(opts?: {
  windowMs?: number;
  targetRms?: number;
  maxGain?: number;
}): Normalizer {
  return {
    gain: 1,
    raw: 0,
    target: opts?.targetRms ?? 0.12,
    windowMs: opts?.windowMs ?? 2000,
    maxGain: opts?.maxGain ?? 8,
  };
}

export function normalizeFrame(n: Normalizer, rms: number, deltaMs: number) {
  n.raw = rms;
  const coeff = Math.exp(-Math.min(deltaMs, 2000) / n.windowMs);
  const smoothedRms = n.raw * (1 - coeff) + Math.max(n.raw, 0.001) * coeff;
  const desired = smoothedRms > 0.0001 ? n.target / Math.max(smoothedRms, 0.0001) : 1;
  const targetGain = Math.min(n.maxGain, Math.max(0.5, desired));
  const gainCoeff = Math.exp(-deltaMs / 500);
  n.gain = n.gain * gainCoeff + targetGain * (1 - gainCoeff);
}
