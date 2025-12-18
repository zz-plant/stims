const createHannWindow = (size: number) => {
  const window = new Float32Array(size);
  const denominator = size - 1;
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denominator));
  }
  return window;
};

const bitReverse = (value: number, bits: number) => {
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
};

const fft = (real: Float32Array, imag: Float32Array) => {
  const n = real.length;
  const levels = Math.log2(n);
  if (Math.floor(levels) !== levels) {
    throw new Error('FFT size must be a power of 2');
  }

  const cosTable = new Float32Array(n / 2);
  const sinTable = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    cosTable[i] = Math.cos((2 * Math.PI * i) / n);
    sinTable[i] = Math.sin((2 * Math.PI * i) / n);
  }

  for (let i = 0; i < n; i += 1) {
    const j = bitReverse(i, levels);
    if (j > i) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const tableStep = n / size;
    for (let i = 0; i < n; i += size) {
      let k = 0;
      for (let j = i; j < i + halfSize; j += 1) {
        const l = j + halfSize;
        const tpre = real[l] * cosTable[k] + imag[l] * sinTable[k];
        const tpim = -real[l] * sinTable[k] + imag[l] * cosTable[k];
        real[l] = real[j] - tpre;
        imag[l] = imag[j] - tpim;
        real[j] += tpre;
        imag[j] += tpim;
        k += tableStep;
      }
    }
  }
};

class FFTAnalyserProcessor extends AudioWorkletProcessor {
  fftSize: number;
  timeDomain: Float32Array;
  window: Float32Array;
  writeIndex: number;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.fftSize = (options.processorOptions?.fftSize as number) || 256;
    this.timeDomain = new Float32Array(this.fftSize);
    this.window = createHannWindow(this.fftSize);
    this.writeIndex = 0;
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i += 1) {
      this.timeDomain[this.writeIndex] = channelData[i];
      this.writeIndex += 1;

      if (this.writeIndex >= this.fftSize) {
        this.writeIndex = 0;
        this.computeFFT();
      }
    }

    return true;
  }

  computeFFT() {
    const real = new Float32Array(this.fftSize);
    const imag = new Float32Array(this.fftSize);

    let sumSquares = 0;
    for (let i = 0; i < this.fftSize; i += 1) {
      const windowed = this.timeDomain[i] * this.window[i];
      real[i] = windowed;
      sumSquares += windowed * windowed;
    }

    fft(real, imag);

    const spectrumSize = this.fftSize / 2;
    const frequencyData = new Uint8Array(spectrumSize);
    const normFactor = 1 / this.fftSize;

    for (let i = 0; i < spectrumSize; i += 1) {
      const magnitude = Math.sqrt(
        real[i] * real[i] + imag[i] * imag[i]
      ) * normFactor;
      const db = 20 * Math.log10(magnitude + 1e-12);
      const normalized = Math.min(1, Math.max(0, (db + 100) / 100));
      frequencyData[i] = Math.round(normalized * 255);
    }

    const rms = Math.sqrt(sumSquares / this.fftSize);

    this.port.postMessage(
      { type: 'fft', data: frequencyData.buffer, average: rms },
      [frequencyData.buffer]
    );
  }
}

registerProcessor('audio-analyser', FFTAnalyserProcessor);
