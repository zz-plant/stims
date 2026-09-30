/**
 * AudioWorklet Frequency Analyser Processor — runs zero-allocation audio analysis in an isolated
 * AudioWorklet thread, computing multi-band FFT spectra, harmonic/percussive separation, and beat envelopes.
 */

/* global AudioWorkletProcessor, registerProcessor, currentTime */

import {
  analyseBlockBytes,
  buildHannWindow,
  buildTwiddleTable,
  byteFromSample,
  computeBandAverage,
  validateFftSize,
} from './analyser-core.ts';
import {
  createHarmonicPercussiveAnalyser,
  type HarmonicPercussiveLevels,
} from './harmonic-percussive.ts';
import {
  computeSpectralCentroid,
  computeSpectralFlatness,
  computeSpectralRolloff,
} from './spectral-features.ts';

/**
 * Exported so offline tools (scripts/audio-file-inputs.ts) can drive the exact
 * processor the browser runs; the worklet scope itself only uses the
 * registerProcessor call below.
 */
export class FrequencyAnalyserProcessor extends AudioWorkletProcessor {
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
  private readonly scratchL: { real: Float32Array; imag: Float32Array };
  private readonly scratchR: { real: Float32Array; imag: Float32Array };
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
    this.scratchL = { real: this.outputReal, imag: this.outputImag };
    this.scratchR = { real: this.outputRealR, imag: this.outputImagR };
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

    this.analyseCount += 1;

    // Byte-map every analyse — not just on message ticks — so the HPSS
    // time-median history advances at full analyse cadence. The byte domain
    // matches what the main-thread fallback consumed, keeping the two paths
    // bit-compatible (the relative normalization washes out any scale drift).
    // analyseBlockBytes is shared with the offline audio-file reader, so the
    // lab's WAV spectra are the bytes this worklet would have posted.
    analyseBlockBytes(
      this.buffer,
      this.window,
      this.twiddles,
      this.freqBuf,
      this.scratchL,
    );
    if (this.hasStereoInput) {
      analyseBlockBytes(
        this.bufferR,
        this.window,
        this.twiddles,
        this.freqBufR,
        this.scratchR,
      );
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
      const spectralCentroid = computeSpectralCentroid(
        this.prevMagnitudes,
        this.sampleRate,
        this.fftSize,
      );
      const spectralFlatness = computeSpectralFlatness(this.prevMagnitudes);
      const spectralRolloff = computeSpectralRolloff(
        this.prevMagnitudes,
        this.sampleRate,
        this.fftSize,
      );

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
        this.waveBuf[i] = byteFromSample(sample);
        if (this.hasStereoInput) {
          const sampleR = this.bufferR[i];
          this.waveBufR[i] = byteFromSample(sampleR);
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
        spectralCentroid,
        spectralFlatness,
        spectralRolloff,
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
