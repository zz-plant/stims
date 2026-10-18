/**
 * The frequency analyser worklet's spectrum maths, shared with offline tools.
 *
 * The AudioWorklet (frequency-analyser-processor.ts) and the lab's audio-file
 * reader (scripts/audio-file-inputs.ts) both import these, so a spectrum
 * computed from a WAV file offline is byte-for-byte the one the live
 * visualizer would have computed from the same samples. Pure functions, no
 * worklet globals.
 */

const TWO_PI = Math.PI * 2;

// Match AnalyserNode.getByteFrequencyData's decibel window (minDecibels /
// maxDecibels defaults). The rest of the audio pipeline — band levels, beat
// thresholds, the milkdrop signal processor — was tuned against AnalyserNode
// byte spectra, and the non-worklet fallback path still produces them. A
// linear magnitude→byte mapping here left realistic music (−20…−40 dBFS) at
// byte values of 0–12, flatlining every downstream band level.
const DB_MIN = -100;
const DB_MAX = -30;
const DB_RANGE = DB_MAX - DB_MIN;

function byteFromMagnitude(magnitude: number): number {
  const db = 20 * Math.log10(magnitude + 1e-12);
  return Math.min(
    255,
    Math.max(0, Math.round(((db - DB_MIN) / DB_RANGE) * 255)),
  );
}

export function buildHannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / (length - 1)));
  }
  return window;
}

export function validateFftSize(value: unknown): number {
  const fftSize = typeof value === 'number' ? value : 1024;
  if (
    !Number.isInteger(fftSize) ||
    fftSize < 2 ||
    (fftSize & (fftSize - 1)) !== 0
  ) {
    throw new RangeError(
      `fftSize must be a power of two >= 2 (received ${fftSize})`,
    );
  }
  return fftSize;
}

function reverseBits(value: number, bits: number): number {
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | ((value >>> i) & 1);
  }
  return reversed;
}

export function buildTwiddleTable(length: number) {
  const cos = new Float32Array(length / 2);
  const sin = new Float32Array(length / 2);
  for (let index = 0; index < length / 2; index += 1) {
    const phase = (-TWO_PI * index) / length;
    cos[index] = Math.cos(phase);
    sin[index] = Math.sin(phase);
  }
  const bits = Math.log2(length);
  const bitRev = new Uint16Array(length);
  for (let i = 0; i < length; i += 1) {
    bitRev[i] = reverseBits(i, bits);
  }
  return { cos, sin, bitRev };
}

function fft(
  real: Float32Array,
  imag: Float32Array,
  twiddles: ReturnType<typeof buildTwiddleTable>,
): void {
  const n = real.length;
  const bitRev = twiddles.bitRev;

  if (bitRev && bitRev.length === n) {
    for (let i = 0; i < n; i += 1) {
      const j = bitRev[i]!;
      if (j > i) {
        const tmpReal = real[i]!;
        real[i] = real[j]!;
        real[j] = tmpReal;
        const tmpImag = imag[i]!;
        imag[i] = imag[j]!;
        imag[j] = tmpImag;
      }
    }
  } else {
    const bits = Math.log2(n);
    for (let i = 0; i < n; i += 1) {
      const j = reverseBits(i, bits);
      if (j > i) {
        const tmpReal = real[i]!;
        real[i] = real[j]!;
        real[j] = tmpReal;
        const tmpImag = imag[i]!;
        imag[i] = imag[j]!;
        imag[j] = tmpImag;
      }
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const tableStep = n / size;

    for (let i = 0; i < halfSize; i += 1) {
      const twiddleIndex = i * tableStep;
      const cos = twiddles.cos[twiddleIndex] ?? 1;
      const sin = twiddles.sin[twiddleIndex] ?? 0;

      for (let start = 0; start < n; start += size) {
        const evenIdx = start + i;
        const oddIdx = evenIdx + halfSize;
        const oddReal = real[oddIdx]!;
        const oddImag = imag[oddIdx]!;

        const tempReal = oddReal * cos - oddImag * sin;
        const tempImag = oddReal * sin + oddImag * cos;

        const evenReal = real[evenIdx]!;
        const evenImag = imag[evenIdx]!;

        real[evenIdx] = evenReal + tempReal;
        imag[evenIdx] = evenImag + tempImag;
        real[oddIdx] = evenReal - tempReal;
        imag[oddIdx] = evenImag - tempImag;
      }
    }
  }
}

export function computeBandAverage(
  data: Uint8Array,
  sampleRate: number,
  fftSize: number,
  minHz: number,
  maxHz: number,
  bandType: 'bass' | 'mid' | 'treble',
): number {
  if (data.length === 0 || sampleRate <= 0 || fftSize <= 0) return 0;
  const resolutionHz = sampleRate / fftSize;
  const nyquistHz = sampleRate / 2;
  const minClamped = Math.min(nyquistHz, Math.max(0, minHz));
  const maxClamped = Math.min(nyquistHz, Math.max(minClamped, maxHz));
  const startCandidate = Math.ceil(minClamped / resolutionHz);
  const endCandidate = Math.ceil(maxClamped / resolutionHz);
  let start: number;
  let end: number;

  if (endCandidate <= startCandidate) {
    const representative = Math.min(
      data.length - 1,
      Math.max(0, Math.floor(((minClamped + maxClamped) * 0.5) / resolutionHz)),
    );
    start = representative;
    end = representative + 1;
  } else {
    start = Math.min(data.length - 1, Math.max(0, startCandidate));
    end = Math.min(data.length, Math.max(start + 1, endCandidate));
  }

  let sum = 0;
  let weightTotal = 0;
  const count = end - start;
  const invRange = count > 1 ? 1 / (count - 1) : 0;
  for (let index = start; index < end; index += 1) {
    const position = (index - start) * invRange;
    const weight =
      bandType === 'bass'
        ? 1.2 - position * 0.3
        : bandType === 'treble'
          ? 0.9 + position * 0.25
          : 1;
    sum += (data[index] ?? 0) * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? sum / (weightTotal * 255) : 0;
}

/** Waveform byte for one PCM sample in [-1, 1], as the worklet posts it. */
export function byteFromSample(sample: number): number {
  return Math.min(255, Math.max(0, Math.round((sample * 0.5 + 0.5) * 255)));
}

/**
 * Spectrum bytes for one analysis block, exactly as the worklet computes
 * them: Hann window, radix-2 FFT, magnitude / binCount, then the
 * AnalyserNode-compatible dB→byte mapping. `block.length` is the FFT size;
 * `out` receives `block.length / 2` bins.
 */
export function analyseBlockBytes(
  block: Float32Array,
  window: Float32Array,
  twiddles: ReturnType<typeof buildTwiddleTable>,
  out: Uint8Array,
  scratch: { real: Float32Array; imag: Float32Array },
  magnitudesOut?: Float32Array,
): void {
  const size = block.length;
  const binCount = size / 2;
  for (let i = 0; i < size; i += 1) {
    scratch.real[i] = block[i] * window[i];
    scratch.imag[i] = 0;
  }
  fft(scratch.real, scratch.imag, twiddles);
  const invBinCount = 1 / binCount;
  for (let i = 0; i < binCount; i += 1) {
    const r = scratch.real[i]!;
    const im = scratch.imag[i]!;
    const magnitude = Math.sqrt(r * r + im * im) * invBinCount;
    if (magnitudesOut) {
      magnitudesOut[i] = magnitude;
    }
    out[i] = byteFromMagnitude(magnitude);
  }
}
