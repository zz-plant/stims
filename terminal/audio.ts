import type { BeatTrackerUpdate } from '../assets/js/utils/audio-beat';
import { createBeatTracker } from '../assets/js/utils/audio-beat';
import {
  getBandLevels,
  getWeightedEnergy,
} from '../assets/js/utils/audio-reactivity';
import { computeSpectrum } from './fft';
import type { WavFile } from './wav';

export interface BandLevels {
  bass: number;
  mid: number;
  treble: number;
  sub?: number;
}

export interface BeatState {
  isBeat: boolean;
  isBeatBass: boolean;
  isBeatMid: boolean;
  isBeatTreble: boolean;
  beatIntensity: number;
  spectralFlux: number;
}

export interface AudioFrame {
  time: number;
  progress: number;
  bands: BandLevels;
  smoothedBands: BandLevels;
  spectrum: Float64Array;
  waveform: Float64Array;
  rms: number;
  rmsSmoothed: number;
  beat: BeatState;
  weightedEnergy: number;
}

const FFT_SIZE = 1024;

function toUint8Spectrum(spectrum: Float64Array): Uint8Array {
  const out = new Uint8Array(spectrum.length);
  for (let i = 0; i < spectrum.length; i++) {
    out[i] = Math.min(255, Math.max(0, Math.round((spectrum[i] ?? 0) * 21.25)));
  }
  return out;
}

function smoothValue(
  current: number,
  next: number,
  deltaMs: number,
  attackMs: number,
  releaseMs: number,
): number {
  const tc = next > current ? attackMs : releaseMs;
  const coeff = Math.exp(-Math.max(0, deltaMs) / tc);
  return current * coeff + next * (1 - coeff);
}

function beatUpdateToState(u: BeatTrackerUpdate): BeatState {
  return {
    isBeat: u.isBeat,
    isBeatBass: u.beatBass,
    isBeatMid: u.beatMid,
    isBeatTreble: u.beatTreble,
    beatIntensity: u.beatIntensity,
    spectralFlux: u.spectralFlux,
  };
}

export function createAudioPipeline(wav: WavFile, startTime: number) {
  const { samples, sampleRate } = wav;
  const totalFrames = samples.length;
  let frameIndex = 0;
  let rmsSmooth = 0;

  const beatTracker = createBeatTracker();

  function nextFrame(nowMs: number): AudioFrame | null {
    const frameStart = frameIndex;
    frameIndex += sampleRate / 60;
    if (frameStart >= totalFrames) return null;

    const windowSize = Math.min(FFT_SIZE, totalFrames - frameStart);
    const window = new Float64Array(FFT_SIZE);
    for (let i = 0; i < windowSize; i++) {
      window[i] = samples[frameStart + i] ?? 0;
    }

    const { spectrum, rms } = computeSpectrum(window, FFT_SIZE);

    const waveform = new Float64Array(256);
    const stride = Math.max(1, Math.floor(windowSize / 256));
    for (let i = 0; i < 256; i++) {
      waveform[i] = samples[frameStart + i * stride] ?? 0;
    }

    const bands = getBandLevels({ data: toUint8Spectrum(spectrum) });

    const weightedEnergy = getWeightedEnergy(bands);

    const deltaMs = nowMs - startTime - (frameStart / sampleRate) * 1000;
    const effectiveDelta = Math.max(
      1,
      Math.min(50, deltaMs > 0 ? deltaMs : 1000 / 60),
    );

    rmsSmooth = smoothValue(rmsSmooth, rms, effectiveDelta, 44, 180);

    const trackerResult = beatTracker.update(
      { bands, weightedEnergy, deltaMs: effectiveDelta },
      nowMs,
    );

    const progress = frameStart / totalFrames;

    return {
      time: nowMs / 1000,
      progress,
      bands,
      smoothedBands: trackerResult.smoothedBands,
      spectrum,
      waveform,
      rms,
      rmsSmoothed: rmsSmooth,
      beat: beatUpdateToState(trackerResult),
      weightedEnergy,
    };
  }

  return { nextFrame, sampleRate, totalFrames, fftSize: FFT_SIZE };
}
