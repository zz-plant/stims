const CACHE = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function buildTwiddle(halfN: number) {
  const cached = CACHE.get(halfN);
  if (cached) return cached;
  const n = halfN * 2;
  const cos = new Float64Array(halfN);
  const sin = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) {
    const angle = (-2 * Math.PI * i) / n;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }
  const table = { cos, sin };
  CACHE.set(halfN, table);
  return table;
}

function bitReverse(n: number, bits: number): number {
  let rev = 0;
  for (let i = 0; i < bits; i++) {
    rev = (rev << 1) | (n & 1);
    n >>= 1;
  }
  return rev;
}

export function fft(re: Float64Array, im: Float64Array, size: number) {
  const bits = Math.log2(size);
  if ((bits | 0) !== bits) throw new Error('FFT size must be a power of 2');

  for (let i = 0; i < size; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }

  const halfN = size / 2;
  const table = buildTwiddle(halfN);

  for (let step = 2; step <= size; step <<= 1) {
    const half = step >> 1;
    const stepFactor = size / step;
    for (let group = 0; group < size; group += step) {
      for (let pair = 0; pair < half; pair++) {
        const even = group + pair;
        const odd = even + half;
        const twiddleIdx = pair * stepFactor;
        const wCos = table.cos[twiddleIdx]!;
        const wSin = table.sin[twiddleIdx]!;
        const tRe = re[odd]! * wCos - im[odd]! * wSin;
        const tIm = re[odd]! * wSin + im[odd]! * wCos;
        re[odd] = re[even]! - tRe;
        im[odd] = im[even]! - tIm;
        re[even] = re[even]! + tRe;
        im[even] = im[even]! + tIm;
      }
    }
  }
}

export function hannWindow(data: Float64Array, len: number) {
  for (let i = 0; i < len; i++) {
    data[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
  }
}

export function magnitude(
  re: Float64Array,
  im: Float64Array,
  len: number,
): Float64Array {
  const mag = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    mag[i] = Math.sqrt(re[i]! * re[i]! + im[i]! * im[i]!);
  }
  return mag;
}

export function computeSpectrum(
  samples: Float64Array,
  fftSize: number,
): { spectrum: Float64Array; rms: number } {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let sumSq = 0;
  for (let i = 0; i < fftSize; i++) {
    const s = samples[i] ?? 0;
    re[i] = s;
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / fftSize);
  hannWindow(re, fftSize);
  fft(re, im, fftSize);
  const half = fftSize / 2;
  const spec = magnitude(re, im, half);
  for (let i = 0; i < half; i++) {
    spec[i] = (spec[i]! / half) * 12;
  }
  return { spectrum: spec, rms };
}
