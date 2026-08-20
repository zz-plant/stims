/**
 * Adapts raw analyser output into the named signals presets actually read.
 *
 * Sits between `core/audio-handler.ts` and the VM, deriving the bass/mid/treb
 * levels, their attenuated variants, and the harmonic/percussive split that
 * MilkDrop equations reference by name. Also provides synthetic beat data so
 * demo mode and headless tests can run a preset with no real audio present.
 *
 * These signals are the entire vocabulary a preset has for "what is the music
 * doing", so smoothing choices here are visible in every preset at once — a
 * change that makes one preset feel snappier can make another strobe. Measure
 * with `bun run lab:reactivity` across several presets, never one.
 */
import type { FrequencyAnalyser } from '../core/audio-handler';
import {
  createHarmonicPercussiveAnalyser,
  type HarmonicPercussiveLevels,
} from '../utils/audio/harmonic-percussive';
import {
  type BandLevels,
  getBandLevels,
  getWeightedEnergy,
  updateEnergyPeak,
} from '../utils/audio/reactivity';

type BandKey = 'bass' | 'mid' | 'treble';

type SpectrumSourceAnalyser = FrequencyAnalyser & {
  getFrequencyData?: () => Uint8Array;
};

type MilkdropAudioSignalUpdate = {
  frequencyData: Uint8Array;
  bands: BandLevels;
  attenuatedBands: BandLevels;
  /**
   * MilkDrop-relative band levels: each band divided by its own long-term
   * average, so 1.0 means "as loud as this track usually is" rather than
   * "full scale". Presets are written against these semantics — idioms like
   * `above(bass, 1)` or `bass_thresh = 1.3` only fire on this scale.
   */
  relativeBands: BandLevels;
  relativeAttenuatedBands: BandLevels;
  rawWeightedEnergy: number;
  weightedEnergy: number;
  /**
   * Harmonic/percussive decomposition of the spectrum (see
   * `utils/audio/harmonic-percussive`). Energies are on the same
   * MilkDrop-relative scale as `relativeBands` — 1.0 means "as much
   * percussive/harmonic energy as this track usually carries" — except
   * `percussiveRatio`, which stays an absolute 0..1 fraction.
   */
  harmonicPercussive: HarmonicPercussiveLevels;
};

const BAND_KEYS: readonly BandKey[] = ['bass', 'mid', 'treble'];

const BAND_BASELINE_MS: Record<BandKey, number> = {
  bass: 260,
  mid: 230,
  treble: 200,
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
  bass: 130,
  mid: 110,
  treble: 85,
};

const BAND_FLOOR: Record<BandKey, number> = {
  bass: 0.05,
  mid: 0.042,
  treble: 0.036,
};

/**
 * Time constants for the MilkDrop-relative band normalization. The long
 * average tracks the track's overall loudness (so quiet passages still reach
 * 1.0).
 */
const RELATIVE_LONG_AVG_MS = 3400;
/**
 * `*_att` smoothing. MilkDrop's bass_att/mid_att/treb_att are damped copies of
 * the relative band — they chase it with a fast attack and slower release, so
 * they cross 1.0 on every real beat. A windowed-average ratio can't do that
 * (it hugs <=1 by construction), which left `max(bass_att-1,0)`-style preset
 * gates permanently shut.
 */
const RELATIVE_ATT_ATTACK_MS = 70;
const RELATIVE_ATT_RELEASE_MS = 260;
/** MilkDrop leaves these unbounded; clamp so a near-silent long average can't
 * hand presets an effectively infinite multiplier. */
const RELATIVE_MAX = 5;
/** Below this the long average is treated as silence and the relative level
 * reads neutral (1.0), matching MilkDrop's own guard. */
const RELATIVE_SILENCE_EPSILON = 0.001;

const INV_LOG1P_6_2 = 1 / Math.log1p(6.2);
const FALLBACK_SYNTHETIC_BUFFER = new Uint8Array(128);

const RAW_ENERGY_OPTIONS = {
  weights: { bass: 0.58, mid: 0.27, treble: 0.15 },
  boost: 1.08,
};

const ATTENUATED_ENERGY_OPTIONS = {
  weights: { bass: 0.56, mid: 0.28, treble: 0.16 },
  boost: 1,
};

const ENERGY_PEAK_OPTIONS = {
  decay: 0.96,
  floor: 0.12,
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

export function createSyntheticBeatFrequencyData(
  buffer: Uint8Array,
  timeMs: number = Date.now(),
): Uint8Array {
  const bpm = 120;
  const beatIntervalMs = (60 / bpm) * 1000;
  const phase = (timeMs % beatIntervalMs) / beatIntervalMs;
  const beatPulse = Math.max(0, 1 - phase * 3);

  for (let i = 0; i < buffer.length; i += 1) {
    const freqRatio = i / Math.max(1, buffer.length - 1);
    const bass = (1 - freqRatio) * beatPulse * 220;
    const mid = Math.sin(timeMs * 0.005 + i * 0.1) * 80 + 60;
    const treble = (freqRatio > 0.6 ? 1 : 0) * Math.cos(timeMs * 0.01) * 70;
    buffer[i] = Math.min(255, Math.max(0, Math.floor(bass + mid + treble)));
  }

  return buffer;
}

function resolveSpectrumSource(
  analyser: FrequencyAnalyser | null,
  fallback: Uint8Array,
) {
  if (fallback.length > 0) {
    return fallback;
  }
  const rawData = (
    analyser as SpectrumSourceAnalyser | null
  )?.getFrequencyData?.();
  if (rawData instanceof Uint8Array && rawData.length > 0) {
    return rawData;
  }
  return createSyntheticBeatFrequencyData(FALLBACK_SYNTHETIC_BUFFER);
}

function spectralCompensationForRatio(ratio: number) {
  const bassBody = (1 - ratio) * 0.18;
  const trebleAir = Math.max(0, ratio - 0.7) * 0.42;
  return 1.02 + bassBody + trebleAir;
}

/** Keys of the HPSS output that get relative normalization; the ratio is left
 * on its own absolute 0..1 scale. */
const HP_ENERGY_KEYS = [
  'percussive',
  'harmonic',
  'percussiveLow',
  'percussiveMid',
  'percussiveHigh',
] as const;

type HpEnergyKey = (typeof HP_ENERGY_KEYS)[number];

function createHpState(): Record<HpEnergyKey, number> {
  return {
    percussive: 0,
    harmonic: 0,
    percussiveLow: 0,
    percussiveMid: 0,
    percussiveHigh: 0,
  };
}

export function createMilkdropAudioSignalProcessor() {
  let bandBaseline = createBandState();
  let bandPeak = createBandState();
  let bandAttenuation = createBandState();
  let bandLongAverage = createBandState();
  let relativeAveragesSeeded = false;
  const relativeBands = createBandState();
  const relativeAttenuatedBands = createBandState();
  const harmonicPercussiveAnalyser = createHarmonicPercussiveAnalyser();
  let hpLongAverage = createHpState();
  let hpAveragesSeeded = false;
  const relativeHarmonicPercussive: HarmonicPercussiveLevels = {
    percussive: 1,
    harmonic: 1,
    percussiveLow: 1,
    percussiveMid: 1,
    percussiveHigh: 1,
    percussiveRatio: 0.5,
  };
  let energyPeak = 0.12;
  let smoothedSpectrum = new Float32Array(0);
  let spectrumNoiseFloor = new Float32Array(0);
  let previousSpectrum = new Float32Array(0);
  let shapedSpectrum = new Uint8Array(0);
  const updateResult: MilkdropAudioSignalUpdate = {
    frequencyData: shapedSpectrum,
    bands: createBandState(),
    attenuatedBands: bandAttenuation,
    relativeBands,
    relativeAttenuatedBands,
    rawWeightedEnergy: 0,
    weightedEnergy: 0,
    harmonicPercussive: relativeHarmonicPercussive,
  };

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
    const len = source.length;
    ensureSpectrumBuffers(len);

    const safeDelta = Math.max(0, deltaMs);
    const coeffFloorAttack = Math.exp(-safeDelta / 220);
    const coeffFloorRelease = Math.exp(-safeDelta / 900);
    const coeffSmoothAttack = Math.exp(-safeDelta / 26);
    const coeffSmoothRelease = Math.exp(-safeDelta / 170);

    let previous = len > 0 ? source[0] / 255 : 0;
    for (let index = 0; index < len; index += 1) {
      const current = source[index] / 255;
      const next = index + 1 < len ? source[index + 1] / 255 : current;
      const ratio = len > 1 ? index / (len - 1) : 0;
      const spatial = previous * 0.18 + current * 0.64 + next * 0.18;
      previous = current;

      const prevFloor = spectrumNoiseFloor[index];
      const coeffFloor =
        spatial > prevFloor ? coeffFloorAttack : coeffFloorRelease;
      const floorVal = prevFloor * coeffFloor + spatial * (1 - coeffFloor);
      spectrumNoiseFloor[index] = floorVal;

      const denoised = Math.max(0, spatial - Math.min(0.085, floorVal * 0.72));
      const compensated =
        denoised * spectralCompensationForRatio(ratio) +
        Math.max(0, current - previousSpectrum[index]) * (0.42 + ratio * 0.08);
      const compressed =
        Math.log1p(clamp(compensated, 0, 1.6) * 6.2) * INV_LOG1P_6_2;
      const target = clamp(compressed, 0, 1);

      const prevSmooth = smoothedSpectrum[index];
      const coeffSmooth =
        target > prevSmooth ? coeffSmoothAttack : coeffSmoothRelease;
      const smoothed = prevSmooth * coeffSmooth + target * (1 - coeffSmooth);
      smoothedSpectrum[index] = smoothed;
      shapedSpectrum[index] = (clamp(smoothed, 0, 1) * 255) | 0;
      previousSpectrum[index] = current;
    }

    return shapedSpectrum;
  };

  const updateBandAttenuation = (bands: BandLevels, deltaMs: number) => {
    for (let i = 0; i < BAND_KEYS.length; i += 1) {
      const key = BAND_KEYS[i];
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
    }

    return bandAttenuation;
  };

  const updateRelativeBands = (bands: BandLevels, deltaMs: number) => {
    if (!relativeAveragesSeeded) {
      // Seeding the average from the first frame keeps the opening second
      // from reading as a huge transient while the long average climbs off 0.
      for (let i = 0; i < BAND_KEYS.length; i += 1) {
        const key = BAND_KEYS[i];
        bandLongAverage[key] = bands[key];
      }
      relativeAveragesSeeded = true;
    }

    for (let i = 0; i < BAND_KEYS.length; i += 1) {
      const key = BAND_KEYS[i];
      const current = bands[key];
      bandLongAverage[key] = smoothLevel(
        bandLongAverage[key],
        current,
        deltaMs,
        RELATIVE_LONG_AVG_MS,
        RELATIVE_LONG_AVG_MS,
      );

      const longAverage = bandLongAverage[key];
      if (longAverage < RELATIVE_SILENCE_EPSILON) {
        relativeBands[key] = 1;
        relativeAttenuatedBands[key] = 1;
        continue;
      }
      relativeBands[key] = clamp(current / longAverage, 0, RELATIVE_MAX);
      relativeAttenuatedBands[key] = clamp(
        smoothLevel(
          relativeAttenuatedBands[key],
          relativeBands[key],
          deltaMs,
          RELATIVE_ATT_ATTACK_MS,
          RELATIVE_ATT_RELEASE_MS,
        ),
        0,
        RELATIVE_MAX,
      );
    }
  };

  const updateHarmonicPercussive = (
    raw: HarmonicPercussiveLevels,
    deltaMs: number,
  ) => {
    if (!hpAveragesSeeded) {
      // Same seeding rule as the bands: start the long average at the first
      // frame so the opening second doesn't read as one huge transient.
      for (let i = 0; i < HP_ENERGY_KEYS.length; i += 1) {
        const key = HP_ENERGY_KEYS[i];
        hpLongAverage[key] = raw[key];
      }
      hpAveragesSeeded = true;
    }

    for (let i = 0; i < HP_ENERGY_KEYS.length; i += 1) {
      const key = HP_ENERGY_KEYS[i];
      const current = raw[key];
      hpLongAverage[key] = smoothLevel(
        hpLongAverage[key],
        current,
        deltaMs,
        RELATIVE_LONG_AVG_MS,
        RELATIVE_LONG_AVG_MS,
      );
      const longAverage = hpLongAverage[key];
      relativeHarmonicPercussive[key] =
        longAverage < RELATIVE_SILENCE_EPSILON
          ? 1
          : clamp(current / longAverage, 0, RELATIVE_MAX);
    }
    relativeHarmonicPercussive.percussiveRatio = clamp(
      raw.percussiveRatio,
      0,
      1,
    );
    return relativeHarmonicPercussive;
  };

  return {
    reset() {
      bandBaseline = createBandState();
      bandPeak = createBandState();
      bandAttenuation = createBandState();
      bandLongAverage = createBandState();
      relativeAveragesSeeded = false;
      for (let i = 0; i < BAND_KEYS.length; i += 1) {
        relativeBands[BAND_KEYS[i]] = 1;
        relativeAttenuatedBands[BAND_KEYS[i]] = 1;
      }
      harmonicPercussiveAnalyser.reset();
      hpLongAverage = createHpState();
      hpAveragesSeeded = false;
      for (let i = 0; i < HP_ENERGY_KEYS.length; i += 1) {
        relativeHarmonicPercussive[HP_ENERGY_KEYS[i]] = 1;
      }
      relativeHarmonicPercussive.percussiveRatio = 0.5;
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
      updateRelativeBands(bands, deltaMs);
      const rawWeightedEnergy = getWeightedEnergy(bands, RAW_ENERGY_OPTIONS);
      const attenuatedWeightedEnergy = getWeightedEnergy(
        attenuatedBands,
        ATTENUATED_ENERGY_OPTIONS,
      );
      ENERGY_PEAK_OPTIONS.decay = Math.exp(-Math.max(0, deltaMs) / 860);
      energyPeak = updateEnergyPeak(
        energyPeak,
        Math.max(rawWeightedEnergy, attenuatedWeightedEnergy * 0.94),
        ENERGY_PEAK_OPTIONS,
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

      updateResult.frequencyData = buildSpectrumFrame(rawSpectrum, deltaMs);
      updateResult.bands = bands;
      updateResult.attenuatedBands = attenuatedBands;
      updateResult.relativeBands = relativeBands;
      updateResult.relativeAttenuatedBands = relativeAttenuatedBands;
      // Prefer the worklet's off-thread HPSS levels when they are available
      // (they advance at analyse cadence on the audio thread). Fall back to
      // the main-thread analyser on the byte spectrum otherwise — the
      // analyser-node path, the window before the first worklet message, or
      // an older worklet without HPSS.
      const workletLevels = analyser?.getHarmonicPercussiveLevels?.() ?? null;
      const rawLevels =
        workletLevels ??
        harmonicPercussiveAnalyser.analyse(rawSpectrum, sampleRate);
      updateResult.harmonicPercussive = updateHarmonicPercussive(
        rawLevels,
        deltaMs,
      );
      updateResult.rawWeightedEnergy = rawWeightedEnergy;
      updateResult.weightedEnergy = weightedEnergy;
      return updateResult;
    },
  };
}
