/**
 * Zero-dependency spectral feature extraction.
 *
 * Replaces the external Meyda dependency with pure, zero-allocation math
 * operating on time-domain samples and FFT magnitude spectra.
 */

export interface SpectralFeatureSnapshot {
  rms: number;
  spectralCentroid: number;
  spectralFlatness: number;
  spectralRolloff: number;
}

const EPSILON = 1e-12;
const DEFAULT_ROLLOFF_RATIO = 0.85;

/**
 * Computes root-mean-square (RMS) of time-domain audio samples.
 */
export function computeRms(timeDomain: Float32Array | Uint8Array): number {
  const len = timeDomain.length;
  if (len === 0) return 0;

  let sumSquares = 0;
  if (timeDomain instanceof Float32Array) {
    for (let i = 0; i < len; i += 1) {
      const v = timeDomain[i];
      sumSquares += v * v;
    }
  } else {
    // Uint8Array centered around 128 (0..255 byte domain)
    for (let i = 0; i < len; i += 1) {
      const v = (timeDomain[i] - 128) / 128;
      sumSquares += v * v;
    }
  }
  return Math.sqrt(sumSquares / len);
}

/**
 * Computes spectral centroid (center of mass of the frequency spectrum) in Hertz.
 */
export function computeSpectralCentroid(
  amplitudes: Float32Array | Uint8Array | number[],
  sampleRate: number,
  fftSize?: number,
): number {
  const len = amplitudes.length;
  if (len <= 1 || sampleRate <= 0) return 0;

  const resolvedFftSize = fftSize ?? (len - 1) * 2;
  const binFrequencyWidth = sampleRate / resolvedFftSize;

  let weightedSum = 0;
  let totalMagnitude = 0;

  for (let i = 0; i < len; i += 1) {
    const mag = amplitudes[i];
    weightedSum += i * binFrequencyWidth * mag;
    totalMagnitude += mag;
  }

  if (totalMagnitude < EPSILON) {
    return 0;
  }
  return weightedSum / totalMagnitude;
}

/**
 * Computes spectral flatness (Wiener entropy: geometric mean / arithmetic mean).
 * Values range from ~0 (pure sinusoidal tones) to ~1 (flat white noise).
 */
export function computeSpectralFlatness(
  amplitudes: Float32Array | Uint8Array | number[],
): number {
  const len = amplitudes.length;
  if (len === 0) return 0;

  let logSum = 0;
  let linearSum = 0;

  for (let i = 0; i < len; i += 1) {
    const mag = amplitudes[i];
    logSum += Math.log(mag + EPSILON);
    linearSum += mag;
  }

  const arithmeticMean = linearSum / len;
  if (arithmeticMean < EPSILON) {
    return 0;
  }

  const geometricMean = Math.exp(logSum / len);
  return Math.min(1, Math.max(0, geometricMean / arithmeticMean));
}

/**
 * Computes spectral rolloff frequency (in Hertz) below which a given fraction (default 85%)
 * of total spectral energy is contained.
 */
export function computeSpectralRolloff(
  amplitudes: Float32Array | Uint8Array | number[],
  sampleRate: number,
  fftSize?: number,
  rolloffRatio: number = DEFAULT_ROLLOFF_RATIO,
): number {
  const len = amplitudes.length;
  if (len === 0 || sampleRate <= 0) return 0;

  const resolvedFftSize = fftSize ?? (len - 1) * 2;
  const binFrequencyWidth = sampleRate / resolvedFftSize;

  let totalPower = 0;
  for (let i = 0; i < len; i += 1) {
    totalPower += amplitudes[i];
  }

  if (totalPower < EPSILON) {
    return 0;
  }

  const threshold = totalPower * rolloffRatio;
  let cumulative = 0;
  let rolloffBin = 0;

  for (let i = 0; i < len; i += 1) {
    cumulative += amplitudes[i];
    if (cumulative >= threshold) {
      rolloffBin = i;
      break;
    }
  }

  return rolloffBin * binFrequencyWidth;
}

/**
 * Extracts all four spectral features in a single pass.
 */
export function extractSpectralFeatures(
  timeDomain: Float32Array | Uint8Array,
  amplitudes: Float32Array | Uint8Array | number[],
  sampleRate: number,
  fftSize?: number,
): SpectralFeatureSnapshot {
  return {
    rms: computeRms(timeDomain),
    spectralCentroid: computeSpectralCentroid(amplitudes, sampleRate, fftSize),
    spectralFlatness: computeSpectralFlatness(amplitudes),
    spectralRolloff: computeSpectralRolloff(amplitudes, sampleRate, fftSize),
  };
}
