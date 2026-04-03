import type { FrequencyAnalyser } from '../core/audio-handler';
import {
  type BandLevels,
  getBandLevels,
  getWeightedEnergy,
  updateEnergyPeak,
} from '../utils/audio-reactivity';

type BandKey = 'bass' | 'mid' | 'treble';

type SpectrumSourceAnalyser = FrequencyAnalyser & {
  getFrequencyData?: () => Uint8Array;
};

type MilkdropAudioSignalUpdate = {
  frequencyData: Uint8Array;
  bands: BandLevels;
  attenuatedBands: BandLevels;
  rawWeightedEnergy: number;
  weightedEnergy: number;
};

const BAND_KEYS: readonly BandKey[] = ['bass', 'mid', 'treble'];

const BAND_BASELINE_MS: Record<BandKey, number> = {
  bass: 520,
  mid: 460,
  treble: 400,
};

const BAND_PEAK_DECAY_MS: Record<BandKey, number> = {
  bass: 1800,
  mid: 1500,
  treble: 1200,
};

const BAND_ATTACK_MS: Record<BandKey, number> = {
  bass: 34,
  mid: 42,
  treble: 28,
};

const BAND_RELEASE_MS: Record<BandKey, number> = {
  bass: 260,
  mid: 220,
  treble: 170,
};

const BAND_FLOOR: Record<BandKey, number> = {
  bass: 0.05,
  mid: 0.042,
  treble: 0.036,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothLevel(
  current: number,
  next: number,
  deltaMs: number,
  attackMs: number,
  releaseMs: number,
) {
  const timeConstantMs = next > current ? attackMs : releaseMs;
  const coefficient = Math.exp(-Math.max(0, deltaMs) / timeConstantMs);
  return current * coefficient + next * (1 - coefficient);
}

function createBandState() {
  return { bass: 0, mid: 0, treble: 0 };
}

function resolveSpectrumSource(
  analyser: FrequencyAnalyser | null,
  fallback: Uint8Array,
) {
  const rawData = (
    analyser as SpectrumSourceAnalyser | null
  )?.getFrequencyData?.();
  if (rawData instanceof Uint8Array && rawData.length > 0) {
    return rawData;
  }
  return fallback;
}

function spectralCompensationForRatio(ratio: number) {
  const bassBody = (1 - ratio) * 0.18;
  const trebleAir = Math.max(0, ratio - 0.7) * 0.42;
  return 1.02 + bassBody + trebleAir;
}

export function createMilkdropAudioSignalProcessor() {
  let bandBaseline = createBandState();
  let bandPeak = createBandState();
  let bandAttenuation = createBandState();
  let energyPeak = 0.12;
  let smoothedSpectrum = new Float32Array(0);
  let spectrumNoiseFloor = new Float32Array(0);
  let previousSpectrum = new Float32Array(0);
  let shapedSpectrum = new Uint8Array(0);

  const ensureSpectrumBuffers = (length: number) => {
    if (smoothedSpectrum.length === length) {
      return;
    }
    smoothedSpectrum = new Float32Array(length);
    spectrumNoiseFloor = new Float32Array(length);
    previousSpectrum = new Float32Array(length);
    shapedSpectrum = new Uint8Array(length);
  };

  const buildSpectrumFrame = (source: Uint8Array, deltaMs: number) => {
    ensureSpectrumBuffers(source.length);

    for (let index = 0; index < source.length; index += 1) {
      const previous = (source[index - 1] ?? source[index] ?? 0) / 255;
      const current = (source[index] ?? 0) / 255;
      const next = (source[index + 1] ?? source[index] ?? 0) / 255;
      const ratio =
        source.length > 1 ? index / Math.max(1, source.length - 1) : 0;
      const spatial = previous * 0.18 + current * 0.64 + next * 0.18;

      spectrumNoiseFloor[index] = smoothLevel(
        spectrumNoiseFloor[index] ?? 0,
        spatial,
        deltaMs,
        220,
        900,
      );

      const denoised = Math.max(
        0,
        spatial - Math.min(0.085, (spectrumNoiseFloor[index] ?? 0) * 0.72),
      );
      const compensated =
        denoised * spectralCompensationForRatio(ratio) +
        Math.max(0, current - (previousSpectrum[index] ?? 0)) *
          (0.42 + ratio * 0.08);
      const compressed =
        Math.log1p(clamp(compensated, 0, 1.6) * 6.2) / Math.log1p(6.2);
      const target = clamp(compressed, 0, 1);

      smoothedSpectrum[index] = smoothLevel(
        smoothedSpectrum[index] ?? 0,
        target,
        deltaMs,
        26,
        170,
      );
      shapedSpectrum[index] = Math.round(
        clamp(smoothedSpectrum[index] ?? 0, 0, 1) * 255,
      );
      previousSpectrum[index] = current;
    }

    return shapedSpectrum;
  };

  const updateBandAttenuation = (bands: BandLevels, deltaMs: number) => {
    const nextAttenuation = createBandState();

    for (const key of BAND_KEYS) {
      const current = bands[key];
      bandBaseline[key] = smoothLevel(
        bandBaseline[key],
        current,
        deltaMs,
        BAND_BASELINE_MS[key],
        BAND_BASELINE_MS[key] * 1.15,
      );
      bandPeak[key] = Math.max(
        bandPeak[key] *
          Math.exp(-Math.max(0, deltaMs) / BAND_PEAK_DECAY_MS[key]),
        current,
        BAND_FLOOR[key],
      );

      const baseline = bandBaseline[key];
      const peak = bandPeak[key];
      const relative = clamp(
        (current - baseline) / Math.max(peak - baseline, BAND_FLOOR[key]),
        0,
        1,
      );
      const prominence = clamp((current - baseline) * 3.2, 0, 1);
      const normalized = clamp(current / Math.max(peak, BAND_FLOOR[key]), 0, 1);
      const target = clamp(
        current * 0.32 +
          normalized * 0.24 +
          relative * 0.29 +
          prominence * 0.35,
        0,
        1,
      );

      bandAttenuation[key] = smoothLevel(
        bandAttenuation[key],
        target,
        deltaMs,
        BAND_ATTACK_MS[key],
        BAND_RELEASE_MS[key],
      );
      nextAttenuation[key] = bandAttenuation[key];
    }

    return nextAttenuation;
  };

  return {
    reset() {
      bandBaseline = createBandState();
      bandPeak = createBandState();
      bandAttenuation = createBandState();
      energyPeak = 0.12;
      smoothedSpectrum = new Float32Array(0);
      spectrumNoiseFloor = new Float32Array(0);
      previousSpectrum = new Float32Array(0);
      shapedSpectrum = new Uint8Array(0);
    },
    update({
      analyser,
      frequencyData,
      sampleRate,
      deltaMs,
    }: {
      analyser: FrequencyAnalyser | null;
      frequencyData: Uint8Array;
      sampleRate?: number;
      deltaMs: number;
    }): MilkdropAudioSignalUpdate {
      const rawSpectrum = resolveSpectrumSource(analyser, frequencyData);
      const bands = getBandLevels({
        analyser,
        data: rawSpectrum,
        sampleRate,
      });
      const attenuatedBands = updateBandAttenuation(bands, deltaMs);
      const rawWeightedEnergy = getWeightedEnergy(bands, {
        weights: { bass: 0.58, mid: 0.27, treble: 0.15 },
        boost: 1.08,
      });
      const attenuatedWeightedEnergy = getWeightedEnergy(attenuatedBands, {
        weights: { bass: 0.56, mid: 0.28, treble: 0.16 },
        boost: 1,
      });
      energyPeak = updateEnergyPeak(
        energyPeak,
        Math.max(rawWeightedEnergy, attenuatedWeightedEnergy * 0.94),
        {
          decay: Math.exp(-Math.max(0, deltaMs) / 860),
          floor: 0.12,
        },
      );
      const normalizedRawEnergy = clamp(
        rawWeightedEnergy / Math.max(energyPeak, 0.12),
        0,
        1,
      );
      const normalizedAttenuatedEnergy = clamp(
        attenuatedWeightedEnergy / Math.max(energyPeak, 0.12),
        0,
        1,
      );
      const weightedEnergy = clamp(
        rawWeightedEnergy * 0.28 +
          normalizedRawEnergy * 0.32 +
          attenuatedWeightedEnergy * 0.14 +
          normalizedAttenuatedEnergy * 0.26,
        0,
        1,
      );

      return {
        frequencyData: buildSpectrumFrame(rawSpectrum, deltaMs),
        bands,
        attenuatedBands,
        rawWeightedEnergy,
        weightedEnergy,
      };
    },
  };
}
