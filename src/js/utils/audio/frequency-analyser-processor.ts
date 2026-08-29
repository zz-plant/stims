/* global AudioWorkletProcessor, registerProcessor, currentTime */

import {
  createHarmonicPercussiveAnalyser,
  type HarmonicPercussiveLevels,
} from './harmonic-percussive.ts';

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

function computeBandAverage(
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
  for (let index = start; index < end; index += 1) {
    const position =
      end - start <= 1 ? 0 : (index - start) / Math.max(1, end - start - 1);
    const weight =
      bandType === 'bass'
        ? 1.2 - position * 0.3
        : bandType === 'treble'
          ? 0.9 + position * 0.25
          : 1;
    sum += (data[index] ?? 0) * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? sum / weightTotal / 255 : 0;
}

class FrequencyAnalyserProcessor extends AudioWorkletProcessor {
  private readonly fftSize: number;
  private readonly sampleRate: number;
  private readonly frequencyBinCount: number;
  private readonly window: Float32Array;
  private readonly buffer: Float32Array;
  private readonly bufferR: Float32Array;
  private bufferIndex = 0;
  private readonly outputReal: Float32Array;
  private readonly outputImag: Float32Array;
  private readonly outputRealR: Float32Array;
  private readonly outputImagR: Float32Array;
  private freqBuf: Uint8Array;
  private waveBuf: Uint8Array;
  private freqBufR: Uint8Array;
  private waveBufR: Uint8Array;
  private timeDomainBuf: Float32Array;
  private readonly prevMagnitudes: Float32Array;
  private readonly twiddles: ReturnType<typeof buildTwiddleTable>;
  private readonly messageEvery: number;
  private readonly hpAnalyser: ReturnType<
    typeof createHarmonicPercussiveAnalyser
  >;
  private hpLevels: HarmonicPercussiveLevels | null = null;
  private analyseCount = 0;
  private hasStereoInput = false;

  private readonly historySize = 64;
  private readonly energyHistoryBass = new Float32Array(64);
  private readonly energyHistoryMid = new Float32Array(64);
  private readonly energyHistoryTreble = new Float32Array(64);
  private historyIndex = 0;
  private historyCount = 0;
  private prevKick = 0;
  private prevTreble = 0;

  private pmRunningAvg = 0;
  private pmBeatIntensity = 0;
  private pmLastBeatTime = 0;
  private readonly pmCoeff = 0.1;
  private readonly pmBeatDecay = 0.92;
  private beatRunningAvgBass = 0;
  private beatRunningAvgMid = 0;
  private beatRunningAvgTreble = 0;
  private beatIntensityBass = 0;
  private beatIntensityMid = 0;
  private beatIntensityTreble = 0;
  private lastBassBeatTime = 0;
  private lastMidBeatTime = 0;
  private lastTrebleBeatTime = 0;
  private readonly beatThreshold = 0.085;
  private readonly beatMinIntervalMs = 150;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const resolvedOptions = options ?? {};
    this.fftSize = validateFftSize(resolvedOptions.processorOptions?.fftSize);
    this.sampleRate =
      typeof resolvedOptions.processorOptions?.sampleRate === 'number' &&
      resolvedOptions.processorOptions.sampleRate > 0
        ? resolvedOptions.processorOptions.sampleRate
        : typeof sampleRate === 'number' && sampleRate > 0
          ? sampleRate
          : 44100;
    this.frequencyBinCount = this.fftSize / 2;
    this.window = buildHannWindow(this.fftSize);
    this.buffer = new Float32Array(this.fftSize);
    this.bufferR = new Float32Array(this.fftSize);
    this.outputReal = new Float32Array(this.fftSize);
    this.outputImag = new Float32Array(this.fftSize);
    this.outputRealR = new Float32Array(this.fftSize);
    this.outputImagR = new Float32Array(this.fftSize);
    this.freqBuf = new Uint8Array(this.frequencyBinCount);
    this.waveBuf = new Uint8Array(this.fftSize);
    this.freqBufR = new Uint8Array(this.frequencyBinCount);
    this.waveBufR = new Uint8Array(this.fftSize);
    this.timeDomainBuf = new Float32Array(this.fftSize);
    this.prevMagnitudes = new Float32Array(this.frequencyBinCount);
    this.twiddles = buildTwiddleTable(this.fftSize);
    this.messageEvery = Math.max(
      1,
      resolvedOptions.processorOptions?.messageEvery ?? 1,
    );
    this.hpAnalyser = createHarmonicPercussiveAnalyser();

    this.port.onmessage = (event) => {
      if (event.data?.type === 'recycle-buffers') {
        const { freq, wave, timeDomain } = event.data;
        if (Array.isArray(freq)) {
          for (let i = 0; i < freq.length; i += 1) {
            const buf = freq[i];
            if (
              buf instanceof ArrayBuffer &&
              buf.byteLength === this.frequencyBinCount &&
              this.freeFreqBuffers.length < 16
            ) {
              this.freeFreqBuffers.push(buf);
            }
          }
        }
        if (Array.isArray(wave)) {
          for (let i = 0; i < wave.length; i += 1) {
            const buf = wave[i];
            if (
              buf instanceof ArrayBuffer &&
              buf.byteLength === this.fftSize &&
              this.freeWaveBuffers.length < 16
            ) {
              this.freeWaveBuffers.push(buf);
            }
          }
        }
        if (Array.isArray(timeDomain)) {
          for (let i = 0; i < timeDomain.length; i += 1) {
            const buf = timeDomain[i];
            if (
              buf instanceof ArrayBuffer &&
              buf.byteLength === this.fftSize * 4 &&
              this.freeTimeDomainBuffers.length < 16
            ) {
              this.freeTimeDomainBuffers.push(buf);
            }
          }
        }
      }
    };
  }

  private readonly freeFreqBuffers: ArrayBuffer[] = [];
  private readonly freeWaveBuffers: ArrayBuffer[] = [];
  private readonly freeTimeDomainBuffers: ArrayBuffer[] = [];

  private analyse() {
    for (let i = 0; i < this.fftSize; i += 1) {
      this.outputReal[i] = this.buffer[i] * this.window[i];
      this.outputImag[i] = 0;
      this.outputRealR[i] = this.bufferR[i] * this.window[i];
      this.outputImagR[i] = 0;
    }

    let sumSquares = 0;
    let zeroCrossings = 0;
    for (let i = 0; i < this.fftSize; i += 1) {
      const sample = this.buffer[i];
      sumSquares += sample * sample;
      if (i > 0 && sample >= 0 !== this.buffer[i - 1] >= 0) {
        zeroCrossings += 1;
      }
    }
    const rms = Math.sqrt(sumSquares / this.fftSize);
    const zeroCrossingRate = zeroCrossings / (this.fftSize - 1);

    fft(this.outputReal, this.outputImag, this.twiddles);
    if (this.hasStereoInput) {
      fft(this.outputRealR, this.outputImagR, this.twiddles);
    }

    this.analyseCount += 1;

    // Byte-map every analyse — not just on message ticks — so the HPSS
    // time-median history advances at full analyse cadence. The byte domain
    // matches what the main-thread fallback consumed, keeping the two paths
    // bit-compatible (the relative normalization washes out any scale drift).
    for (let i = 0; i < this.frequencyBinCount; i += 1) {
      const magnitude =
        Math.sqrt(
          this.outputReal[i] * this.outputReal[i] +
            this.outputImag[i] * this.outputImag[i],
        ) / this.frequencyBinCount;
      this.freqBuf[i] = byteFromMagnitude(magnitude);
      if (this.hasStereoInput) {
        const magnitudeR =
          Math.sqrt(
            this.outputRealR[i] * this.outputRealR[i] +
              this.outputImagR[i] * this.outputImagR[i],
          ) / this.frequencyBinCount;
        this.freqBufR[i] = byteFromMagnitude(magnitudeR);
      }
    }

    this.hpLevels = this.hpAnalyser.analyse(this.freqBuf, this.sampleRate);

    if (this.analyseCount % this.messageEvery === 0) {
      let maxMag = 0;
      let sumMag = 0;
      let spectralFlux = 0;

      for (let i = 0; i < this.frequencyBinCount; i += 1) {
        const magnitude =
          Math.sqrt(
            this.outputReal[i] * this.outputReal[i] +
              this.outputImag[i] * this.outputImag[i],
          ) / this.frequencyBinCount;

        const diff = magnitude - this.prevMagnitudes[i];
        if (diff > 0) {
          spectralFlux += diff;
        }
        this.prevMagnitudes[i] = magnitude;

        if (magnitude > maxMag) maxMag = magnitude;
        sumMag += magnitude;
      }

      const meanMag = sumMag / Math.max(1, this.frequencyBinCount);
      const spectralCrest = maxMag / (meanMag + 1e-6);

      let stereoBalance = 0;
      let stereoWidth = 0;
      if (this.hasStereoInput) {
        let sumL = 0;
        let sumR = 0;
        let dotLR = 0;
        let dotLL = 0;
        let dotRR = 0;
        for (let i = 0; i < this.fftSize; i += 1) {
          const l = this.buffer[i];
          const r = this.bufferR[i];
          sumL += Math.abs(l);
          sumR += Math.abs(r);
          dotLR += l * r;
          dotLL += l * l;
          dotRR += r * r;
        }
        stereoBalance = (sumL - sumR) / (sumL + sumR + 1e-6);
        const norm = Math.sqrt(dotLL * dotRR);
        const corr = norm > 1e-6 ? dotLR / norm : 1;
        stereoWidth = Math.max(0, Math.min(1, 1 - corr));
      }

      for (let i = 0; i < this.fftSize; i += 1) {
        const sample = this.buffer[i];
        this.waveBuf[i] = Math.min(
          255,
          Math.max(0, Math.round((sample * 0.5 + 0.5) * 255)),
        );
        if (this.hasStereoInput) {
          const sampleR = this.bufferR[i];
          this.waveBufR[i] = Math.min(
            255,
            Math.max(0, Math.round((sampleR * 0.5 + 0.5) * 255)),
          );
        }
      }
      this.timeDomainBuf.set(this.buffer);

      // Off-main-thread multi-band energy calculation
      const bass = computeBandAverage(
        this.freqBuf,
        this.sampleRate,
        this.fftSize,
        24,
        320,
        'bass',
      );
      const mid = computeBandAverage(
        this.freqBuf,
        this.sampleRate,
        this.fftSize,
        320,
        2800,
        'mid',
      );
      const treble = computeBandAverage(
        this.freqBuf,
        this.sampleRate,
        this.fftSize,
        2800,
        12000,
        'treble',
      );
      const subBass = computeBandAverage(
        this.freqBuf,
        this.sampleRate,
        this.fftSize,
        24,
        60,
        'bass',
      );
      const kick = computeBandAverage(
        this.freqBuf,
        this.sampleRate,
        this.fftSize,
        60,
        250,
        'bass',
      );

      // Off-thread energy envelope tracking & transient metrics
      const subBassEnv = Math.min(1, subBass * 1.35);
      const kickDelta = Math.max(0, kick - this.prevKick);
      const kickTransient = Math.min(1, kickDelta * 3.8 + kick * 0.4);
      const vocalMidEnv = Math.min(1, mid * 1.2);
      const snareDelta = Math.max(0, treble - this.prevTreble);
      const snareSnap = Math.min(1, snareDelta * 4.2 + treble * 0.3);

      this.prevKick = kick;
      this.prevTreble = treble;

      // Update off-thread energy history & averages
      this.energyHistoryBass[this.historyIndex] = bass;
      this.energyHistoryMid[this.historyIndex] = mid;
      this.energyHistoryTreble[this.historyIndex] = treble;
      this.historyIndex = (this.historyIndex + 1) % this.historySize;
      this.historyCount = Math.min(this.historyCount + 1, this.historySize);

      let bassSum = 0;
      let midSum = 0;
      let trebleSum = 0;
      for (let i = 0; i < this.historyCount; i += 1) {
        bassSum += this.energyHistoryBass[i];
        midSum += this.energyHistoryMid[i];
        trebleSum += this.energyHistoryTreble[i];
      }
      const energyAverages = {
        bass: this.historyCount > 0 ? bassSum / this.historyCount : 0,
        mid: this.historyCount > 0 ? midSum / this.historyCount : 0,
        treble: this.historyCount > 0 ? trebleSum / this.historyCount : 0,
      };

      const nowMs = (typeof currentTime === 'number' ? currentTime : 0) * 1000;
      const weightedEnergy = Math.min(
        1,
        bass * 0.55 + mid * 0.3 + treble * 0.15,
      );

      this.pmRunningAvg += this.pmCoeff * (weightedEnergy - this.pmRunningAvg);
      const pmThreshold = this.pmRunningAvg * (1 + this.beatThreshold * 3);
      const pmIsBeat =
        weightedEnergy > pmThreshold &&
        nowMs - this.pmLastBeatTime > this.beatMinIntervalMs;
      if (pmIsBeat) {
        this.pmBeatIntensity = Math.min(1, this.pmBeatIntensity + 0.5);
        this.pmLastBeatTime = nowMs;
      } else {
        this.pmBeatIntensity *= this.pmBeatDecay;
      }

      const bassCoeff = 0.08;
      const midCoeff = 0.06;
      const trebleCoeff = 0.05;
      this.beatRunningAvgBass += bassCoeff * (bass - this.beatRunningAvgBass);
      this.beatRunningAvgMid += midCoeff * (mid - this.beatRunningAvgMid);
      this.beatRunningAvgTreble +=
        trebleCoeff * (treble - this.beatRunningAvgTreble);

      const beatBass =
        bass > this.beatRunningAvgBass * (1 + this.beatThreshold * 2.5) &&
        nowMs - this.lastBassBeatTime > this.beatMinIntervalMs;
      const beatMid =
        mid > this.beatRunningAvgMid * (1 + this.beatThreshold * 2.0) &&
        nowMs - this.lastMidBeatTime > this.beatMinIntervalMs;
      const beatTreble =
        treble > this.beatRunningAvgTreble * (1 + this.beatThreshold * 1.8) &&
        nowMs - this.lastTrebleBeatTime > this.beatMinIntervalMs;

      if (beatBass) {
        this.beatIntensityBass = Math.min(1, 0.35 + bass);
        this.lastBassBeatTime = nowMs;
      } else {
        this.beatIntensityBass *= this.pmBeatDecay;
      }
      if (beatMid) {
        this.beatIntensityMid = Math.min(1, 0.28 + mid);
        this.lastMidBeatTime = nowMs;
      } else {
        this.beatIntensityMid *= this.pmBeatDecay;
      }
      if (beatTreble) {
        this.beatIntensityTreble = Math.min(1, 0.22 + treble);
        this.lastTrebleBeatTime = nowMs;
      } else {
        this.beatIntensityTreble *= this.pmBeatDecay;
      }

      const beatDetection = {
        isBeat: pmIsBeat,
        beatIntensity: this.pmBeatIntensity,
        beatBass,
        beatMid,
        beatTreble,
        bassBeatIntensity: this.beatIntensityBass,
        midBeatIntensity: this.beatIntensityMid,
        trebleBeatIntensity: this.beatIntensityTreble,
      };

      const freqTransfer = this.freqBuf.buffer as ArrayBuffer;
      const waveTransfer = this.waveBuf.buffer as ArrayBuffer;
      const timeDomainTransfer = this.timeDomainBuf.buffer as ArrayBuffer;

      const payload: Record<string, unknown> = {
        frequencyData: freqTransfer,
        waveformData: waveTransfer,
        timeDomainData: timeDomainTransfer,
        rms,
        zeroCrossingRate,
        spectralFlux,
        spectralCrest,
        stereoBalance,
        stereoWidth,
        energy: { bass, mid, treble },
        energyAverages,
        beatDetection,
        transientMetrics: {
          subBassEnv,
          kickTransient,
          vocalMidEnv,
          snareSnap,
        },
        harmonicPercussive: this.hpLevels ? { ...this.hpLevels } : null,
      };
      const transfers = [freqTransfer, waveTransfer, timeDomainTransfer];
      if (this.hasStereoInput) {
        const freqRTransfer = this.freqBufR.buffer as ArrayBuffer;
        const waveRTransfer = this.waveBufR.buffer as ArrayBuffer;
        payload.frequencyDataL = freqTransfer;
        payload.frequencyDataR = freqRTransfer;
        payload.waveformDataL = waveTransfer;
        payload.waveformDataR = waveRTransfer;
        transfers.push(freqRTransfer, waveRTransfer);
      }
      this.port.postMessage(payload, transfers);

      const nextFreq = this.freeFreqBuffers.pop();
      this.freqBuf = nextFreq
        ? new Uint8Array(nextFreq)
        : new Uint8Array(this.frequencyBinCount);

      const nextWave = this.freeWaveBuffers.pop();
      this.waveBuf = nextWave
        ? new Uint8Array(nextWave)
        : new Uint8Array(this.fftSize);

      const nextTimeDomain = this.freeTimeDomainBuffers.pop();
      this.timeDomainBuf = nextTimeDomain
        ? new Float32Array(nextTimeDomain)
        : new Float32Array(this.fftSize);

      if (this.hasStereoInput) {
        const nextFreqR = this.freeFreqBuffers.pop();
        this.freqBufR = nextFreqR
          ? new Uint8Array(nextFreqR)
          : new Uint8Array(this.frequencyBinCount);

        const nextWaveR = this.freeWaveBuffers.pop();
        this.waveBufR = nextWaveR
          ? new Uint8Array(nextWaveR)
          : new Uint8Array(this.fftSize);
      }
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
