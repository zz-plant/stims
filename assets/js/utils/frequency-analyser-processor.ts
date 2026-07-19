/* global AudioWorkletProcessor, registerProcessor */

const TWO_PI = Math.PI * 2;

function buildHannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / (length - 1)));
  }
  return window;
}

function validateFftSize(value: unknown): number {
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

function buildTwiddleTable(length: number) {
  const cos = new Float32Array(length / 2);
  const sin = new Float32Array(length / 2);
  for (let index = 0; index < length / 2; index += 1) {
    const phase = (-TWO_PI * index) / length;
    cos[index] = Math.cos(phase);
    sin[index] = Math.sin(phase);
  }
  return { cos, sin };
}

function fft(
  real: Float32Array,
  imag: Float32Array,
  twiddles: ReturnType<typeof buildTwiddleTable>,
): void {
  const n = real.length;
  const bits = Math.log2(n);

  for (let i = 0; i < n; i += 1) {
    const j = reverseBits(i, bits);
    if (j > i) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const tableStep = n / size;

    for (let start = 0; start < n; start += size) {
      for (let i = 0; i < halfSize; i += 1) {
        const twiddleIndex = i * tableStep;
        const cos = twiddles.cos[twiddleIndex] ?? 1;
        const sin = twiddles.sin[twiddleIndex] ?? 0;

        const evenReal = real[start + i];
        const evenImag = imag[start + i];
        const oddReal = real[start + i + halfSize];
        const oddImag = imag[start + i + halfSize];

        const tempReal = oddReal * cos - oddImag * sin;
        const tempImag = oddReal * sin + oddImag * cos;

        real[start + i] = evenReal + tempReal;
        imag[start + i] = evenImag + tempImag;
        real[start + i + halfSize] = evenReal - tempReal;
        imag[start + i + halfSize] = evenImag - tempImag;
      }
    }
  }
}

class FrequencyAnalyserProcessor extends AudioWorkletProcessor {
  private readonly fftSize: number;
  private readonly frequencyBinCount: number;
  private readonly window: Float32Array;
  private readonly buffer: Float32Array;
  private readonly bufferR: Float32Array;
  private bufferIndex = 0;
  private readonly outputReal: Float32Array;
  private readonly outputImag: Float32Array;
  private readonly outputRealR: Float32Array;
  private readonly outputImagR: Float32Array;
  private readonly twiddles: ReturnType<typeof buildTwiddleTable>;
  private readonly messageEvery: number;
  private analyseCount = 0;
  private hasStereoInput = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const resolvedOptions = options ?? {};
    this.fftSize = validateFftSize(resolvedOptions.processorOptions?.fftSize);
    this.frequencyBinCount = this.fftSize / 2;
    this.window = buildHannWindow(this.fftSize);
    this.buffer = new Float32Array(this.fftSize);
    this.bufferR = new Float32Array(this.fftSize);
    this.outputReal = new Float32Array(this.fftSize);
    this.outputImag = new Float32Array(this.fftSize);
    this.outputRealR = new Float32Array(this.fftSize);
    this.outputImagR = new Float32Array(this.fftSize);
    this.twiddles = buildTwiddleTable(this.fftSize);
    this.messageEvery = Math.max(
      1,
      resolvedOptions.processorOptions?.messageEvery ?? 1,
    );
  }

  private analyse() {
    for (let i = 0; i < this.fftSize; i += 1) {
      this.outputReal[i] = this.buffer[i] * this.window[i];
      this.outputImag[i] = 0;
      this.outputRealR[i] = this.bufferR[i] * this.window[i];
      this.outputImagR[i] = 0;
    }

    let sumSquares = 0;
    for (let i = 0; i < this.fftSize; i += 1) {
      const sample = this.buffer[i];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / this.fftSize);

    fft(this.outputReal, this.outputImag, this.twiddles);
    if (this.hasStereoInput) {
      fft(this.outputRealR, this.outputImagR, this.twiddles);
    }

    this.analyseCount += 1;
    if (this.analyseCount % this.messageEvery === 0) {
      const freqBuf = new Uint8Array(this.frequencyBinCount);
      const waveBuf = new Uint8Array(this.fftSize);
      const freqBufR = this.hasStereoInput
        ? new Uint8Array(this.frequencyBinCount)
        : null;
      const waveBufR = this.hasStereoInput
        ? new Uint8Array(this.fftSize)
        : null;
      for (let i = 0; i < this.frequencyBinCount; i += 1) {
        const magnitude =
          Math.sqrt(
            this.outputReal[i] * this.outputReal[i] +
              this.outputImag[i] * this.outputImag[i],
          ) / this.frequencyBinCount;
        freqBuf[i] = Math.min(255, Math.max(0, Math.round(magnitude * 255)));
        if (freqBufR) {
          const magnitudeR =
            Math.sqrt(
              this.outputRealR[i] * this.outputRealR[i] +
                this.outputImagR[i] * this.outputImagR[i],
            ) / this.frequencyBinCount;
          freqBufR[i] = Math.min(
            255,
            Math.max(0, Math.round(magnitudeR * 255)),
          );
        }
      }
      for (let i = 0; i < this.fftSize; i += 1) {
        const sample = this.buffer[i];
        waveBuf[i] = Math.min(
          255,
          Math.max(0, Math.round((sample * 0.5 + 0.5) * 255)),
        );
        if (waveBufR) {
          const sampleR = this.bufferR[i];
          waveBufR[i] = Math.min(
            255,
            Math.max(0, Math.round((sampleR * 0.5 + 0.5) * 255)),
          );
        }
      }
      const timeDomainBuf = this.buffer.slice();
      const payload: Record<string, ArrayBuffer | number> = {
        frequencyData: freqBuf.buffer,
        waveformData: waveBuf.buffer,
        timeDomainData: timeDomainBuf.buffer,
        rms,
      };
      const transfers = [freqBuf.buffer, waveBuf.buffer, timeDomainBuf.buffer];
      if (freqBufR && waveBufR) {
        payload.frequencyDataL = freqBuf.buffer;
        payload.frequencyDataR = freqBufR.buffer;
        payload.waveformDataL = waveBuf.buffer;
        payload.waveformDataR = waveBufR.buffer;
        transfers.push(freqBufR.buffer, waveBufR.buffer);
      }
      this.port.postMessage(payload, transfers);
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const channels = inputs[0];
    const input = channels?.[0];
    const inputR = channels?.[1];
    const outputChannel = outputs[0]?.[0];

    if (!input) {
      return true;
    }

    const nextHasStereoInput = Boolean(inputR);
    if (nextHasStereoInput !== this.hasStereoInput && this.bufferIndex > 0) {
      this.buffer.fill(0);
      this.bufferR.fill(0);
      this.bufferIndex = 0;
    }
    this.hasStereoInput = nextHasStereoInput;

    for (let i = 0; i < input.length; i += 1) {
      this.buffer[this.bufferIndex] = input[i];
      this.bufferR[this.bufferIndex] = inputR?.[i] ?? input[i];
      this.bufferIndex += 1;

      if (this.bufferIndex >= this.fftSize) {
        this.bufferIndex = 0;
        this.analyse();
      }
    }

    if (outputChannel) {
      outputChannel.fill(0);
    }

    return true;
  }
}

registerProcessor('frequency-analyser', FrequencyAnalyserProcessor);

export {};
