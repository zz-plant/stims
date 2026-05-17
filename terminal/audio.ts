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

const BAND_RANGES = {
  sub: { startRatio: 0.0, endRatio: 0.03 },
  bass: { startRatio: 0.0, endRatio: 0.12 },
  mid: { startRatio: 0.12, endRatio: 0.5 },
  treble: { startRatio: 0.5, endRatio: 0.9 },
};

function getBandAverage(
  spectrum: Float64Array,
  startRatio: number,
  endRatio: number,
): number {
  const len = spectrum.length;
  const start = Math.floor(startRatio * len);
  const end = Math.min(Math.floor(endRatio * len), len);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += spectrum[i] ?? 0;
  }
  const avg = sum / (end - start);
  return Number.isFinite(avg) ? avg : 0;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothLevel(
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

export function createAudioPipeline(wav: WavFile, startTime: number) {
  const { samples, sampleRate } = wav;
  const totalFrames = samples.length;
  let frameIndex = 0;
  let rmsSmooth = 0;

  const smoothed: BandLevels & { sub: number } = {
    bass: 0,
    mid: 0,
    treble: 0,
    sub: 0,
  };
  const prevBands = { bass: 0, mid: 0, treble: 0 };
  const baselines = { bass: 0, mid: 0, treble: 0, energy: 0 };
  let beatIntensity = 0;
  let bassBeatIntensity = 0;
  let midBeatIntensity = 0;
  let trebleBeatIntensity = 0;
  let lastBeatMs = 0;

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

    const bands: BandLevels = {
      bass: getBandAverage(
        spectrum,
        BAND_RANGES.bass.startRatio,
        BAND_RANGES.bass.endRatio,
      ),
      mid: getBandAverage(
        spectrum,
        BAND_RANGES.mid.startRatio,
        BAND_RANGES.mid.endRatio,
      ),
      treble: getBandAverage(
        spectrum,
        BAND_RANGES.treble.startRatio,
        BAND_RANGES.treble.endRatio,
      ),
    };
    const subBass = getBandAverage(
      spectrum,
      BAND_RANGES.sub.startRatio,
      BAND_RANGES.sub.endRatio,
    );

    const deltaMs = nowMs - startTime - (frameStart / sampleRate) * 1000;
    const effectiveDelta = Math.max(
      1,
      Math.min(50, deltaMs > 0 ? deltaMs : 1000 / 60),
    );

    smoothed.bass = smoothLevel(
      smoothed.bass,
      bands.bass,
      effectiveDelta,
      34,
      130,
    );
    smoothed.mid = smoothLevel(
      smoothed.mid,
      bands.mid,
      effectiveDelta,
      42,
      110,
    );
    smoothed.treble = smoothLevel(
      smoothed.treble,
      bands.treble,
      effectiveDelta,
      28,
      85,
    );
    smoothed.sub = smoothLevel(smoothed.sub, subBass, effectiveDelta, 50, 160);

    rmsSmooth = smoothLevel(rmsSmooth, rms, effectiveDelta, 44, 180);

    const weightedEnergy =
      smoothed.bass * 0.58 + smoothed.mid * 0.27 + smoothed.treble * 0.15;

    const baselineCoeff = Math.exp(-effectiveDelta / 260);
    baselines.bass =
      baselines.bass * baselineCoeff + smoothed.bass * (1 - baselineCoeff);
    baselines.mid =
      baselines.mid * baselineCoeff + smoothed.mid * (1 - baselineCoeff);
    baselines.treble =
      baselines.treble * baselineCoeff + smoothed.treble * (1 - baselineCoeff);
    baselines.energy =
      baselines.energy * baselineCoeff + weightedEnergy * (1 - baselineCoeff);

    const bassRise = Math.max(0, bands.bass - prevBands.bass);
    const midRise = Math.max(0, bands.mid - prevBands.mid);
    const trebleRise = Math.max(0, bands.treble - prevBands.treble);
    const energyRise = Math.max(0, weightedEnergy - baselines.energy);
    const bassProminence = Math.max(0, smoothed.bass - baselines.bass);
    const midProminence = Math.max(0, smoothed.mid - baselines.mid);
    const trebleProminence = Math.max(0, smoothed.treble - baselines.treble);

    prevBands.bass = bands.bass;
    prevBands.mid = bands.mid;
    prevBands.treble = bands.treble;

    const beatScore =
      bassProminence * 2.1 +
      bassRise * 3.6 +
      energyRise * 1.15 +
      energyRise * 1.8;
    const isBeatBass =
      bassRise > 0.016 &&
      bassProminence > 0.08 &&
      beatScore > 0.176 &&
      nowMs - lastBeatMs > 170;
    const isBeatMid =
      midRise > 0.011 && midProminence > 0.06 && nowMs - lastBeatMs > 170;
    const isBeatTreble =
      trebleRise > 0.008 && trebleProminence > 0.04 && nowMs - lastBeatMs > 170;
    const isBeat = isBeatBass || isBeatMid || isBeatTreble;

    const spectralFlux = (bassRise + midRise + trebleRise) / 3;

    if (isBeatBass) {
      bassBeatIntensity = clamp(0.35 + beatScore, 0, 1);
      lastBeatMs = nowMs;
    } else {
      bassBeatIntensity *= 0.88 ** Math.max(0.25, effectiveDelta / 16.67);
    }
    if (isBeatMid) {
      midBeatIntensity = clamp(
        0.35 + midProminence * 1.6 + midRise * 2.8,
        0,
        1,
      );
    } else {
      midBeatIntensity *= 0.88 ** Math.max(0.25, effectiveDelta / 16.67);
    }
    if (isBeatTreble) {
      trebleBeatIntensity = clamp(
        0.35 + trebleProminence * 1.3 + trebleRise * 2.2,
        0,
        1,
      );
    } else {
      trebleBeatIntensity *= 0.88 ** Math.max(0.25, effectiveDelta / 16.67);
    }

    beatIntensity = isBeat
      ? Math.max(bassBeatIntensity, midBeatIntensity, trebleBeatIntensity)
      : beatIntensity * 0.88 ** Math.max(0.25, effectiveDelta / 16.67);

    const progress = frameStart / totalFrames;

    return {
      time: nowMs / 1000,
      progress,
      bands,
      smoothedBands: {
        bass: smoothed.bass,
        mid: smoothed.mid,
        treble: smoothed.treble,
      },
      spectrum,
      waveform,
      rms,
      rmsSmoothed: rmsSmooth,
      beat: {
        isBeat,
        isBeatBass,
        isBeatMid,
        isBeatTreble,
        beatIntensity,
        spectralFlux,
      },
      weightedEnergy,
    };
  }

  return { nextFrame, sampleRate, totalFrames, fftSize: FFT_SIZE };
}
