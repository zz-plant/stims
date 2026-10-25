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

function fftRealInput(
  real: Float32Array,
  imag: Float32Array,
  twiddles: ReturnType<typeof buildTwiddleTable>,
): void {
  const n = real.length;
  const cosTable = twiddles.cos;
  const sinTable = twiddles.sin;

  for (let size = 8; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const tableStep = n / size;

    // i = 0 (cos = 1, sin = 0): avoid trigonometric multiplication
    for (let start = 0; start < n; start += size) {
      const oddIdx = start + halfSize;
      const evenReal = real[start] ?? 0;
      const oddReal = real[oddIdx] ?? 0;
      const evenImag = imag[start] ?? 0;
      const oddImag = imag[oddIdx] ?? 0;
      real[start] = evenReal + oddReal;
      imag[start] = evenImag + oddImag;
      real[oddIdx] = evenReal - oddReal;
      imag[oddIdx] = evenImag - oddImag;
    }

    for (let i = 1; i < halfSize; i += 1) {
      const twiddleIndex = i * tableStep;
      const cos = cosTable[twiddleIndex] ?? 1;
      const sin = sinTable[twiddleIndex] ?? 0;

      for (let start = 0; start < n; start += size) {
        const evenIdx = start + i;
        const oddIdx = evenIdx + halfSize;
        const oddReal = real[oddIdx] ?? 0;
        const oddImag = imag[oddIdx] ?? 0;

        const tempReal = oddReal * cos - oddImag * sin;
        const tempImag = oddReal * sin + oddImag * cos;

        const evenReal = real[evenIdx] ?? 0;
        const evenImag = imag[evenIdx] ?? 0;

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
  const binCount = size >> 1;
  const real = scratch.real;
  const imag = scratch.imag;
  const bitRev = twiddles.bitRev;

  if (size === 2) {
    const x0 = (block[0] ?? 0) * (window[0] ?? 0);
    const x1 = (block[1] ?? 0) * (window[1] ?? 0);
    real[0] = x0 + x1;
    real[1] = x0 - x1;
    imag[0] = 0;
    imag[1] = 0;
  } else {
    // Single fused pass: windowing + bit-reversal + imag zeroing + radix-4
    // (stages 1 & 2) real-input base butterflies without intermediate passes.
    for (let start = 0; start < size; start += 4) {
      const i0 = bitRev[start] ?? 0;
      const i1 = bitRev[start + 1] ?? 0;
      const i2 = bitRev[start + 2] ?? 0;
      const i3 = bitRev[start + 3] ?? 0;

      const x0 = (block[i0] ?? 0) * (window[i0] ?? 0);
      const x1 = (block[i1] ?? 0) * (window[i1] ?? 0);
      const x2 = (block[i2] ?? 0) * (window[i2] ?? 0);
      const x3 = (block[i3] ?? 0) * (window[i3] ?? 0);

      const s0 = x0 + x1;
      const d0 = x0 - x1;
      const s1 = x2 + x3;
      const d1 = x2 - x3;

      real[start] = s0 + s1;
      imag[start] = 0;
      real[start + 1] = d0;
      imag[start + 1] = -d1;
      real[start + 2] = s0 - s1;
      imag[start + 2] = 0;
      real[start + 3] = d0;
      imag[start + 3] = d1;
    }
  }

  fftRealInput(real, imag, twiddles);

  const invBinCount = 1 / binCount;
  for (let i = 0; i < binCount; i += 1) {
    const r = real[i] ?? 0;
    const im = imag[i] ?? 0;
    const magnitude = Math.sqrt(r * r + im * im) * invBinCount;
    if (magnitudesOut) {
      magnitudesOut[i] = magnitude;
    }
    out[i] = byteFromMagnitude(magnitude);
  }
}
