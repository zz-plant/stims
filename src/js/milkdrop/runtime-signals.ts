/**
 * MilkDrop Runtime Signal Tracker — tracks, smooths, and packages audio-reactive signals (`bass`, `mid`,
 * `treb`, `bass_att`, `vol`), beat triggers, and spectral analysis for per-frame EEL evaluation.
 */

import { createBeatTracker } from 'audio-reactive';
import type { FrequencyAnalyser } from '../core/audio-handler';
import { createMilkdropAudioSignalProcessor } from './audio-signal-processor';
import type { MilkdropRuntimeSignals } from './types';
import { defaultSignalEnv } from './vm/frame-generation';

const SPECTRAL_ANALYSIS_FRAME_INTERVAL = 4;

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

export function createMilkdropSignalTracker(options?: {
  beatDetectionMode?: 'default' | 'projectM';
}) {
  const signalProcessor = createMilkdropAudioSignalProcessor();
  const beatTracker = createBeatTracker({
    threshold: 0.08,
    onsetThreshold: 0.016,
    minIntervalMs: 170,
    beatDecay: 0.88,
    mode: options?.beatDetectionMode ?? 'default',
  });
  let frame = 0;
  let rms = 0;
  let spectralAnalyser: FrequencyAnalyser | null = null;
  // The worklet's beat verdict for the message it last reported, so a beat
  // is reported once, not on every frame until the next message arrives.
  let lastWorkletBeat: object | null = null;
  let cachedSpectralFeatures: ReturnType<
    FrequencyAnalyser['getSpectralFeatures']
  > = null;
  let lastSpectralAnalysisFrame = Number.NEGATIVE_INFINITY;
  // Relationship lock: pins the preset-facing `time`/`frame` at the values
  // from the first locked update, while the internal `frame` counter above
  // keeps advancing (spectral-analysis cadence, beat timing) so audio
  // responsiveness is unaffected. See docs/SENSORY_ACCESSIBILITY.md.
  let lockedTime: number | null = null;
  let lockedFrame: number | null = null;

  // The VM's defaults plus the harmonic/percussive split this tracker adds.
  // The audio buffers start empty (the type wants arrays; update() fills them).
  const signalCache = {
    ...defaultSignalEnv(),
    percussive: 1,
    harmonic: 1,
    percussiveLow: 1,
    percussiveMid: 1,
    percussiveHigh: 1,
    percussiveRatio: 0.5,
    percussive_low: 1,
    percussive_mid: 1,
    percussive_high: 1,
    percussive_ratio: 0.5,
    frequencyData: null,
    waveformData: null,
  } as unknown as MilkdropRuntimeSignals;

  let latestWeightedEnergy = 0;
  // Kept alongside the weighted energy so the catalog search can describe
  // spectral balance rather than loudness alone. Attenuated (smoothed) rather
  // than instantaneous, because a one-shot search query wants the character
  // of the last moment, not whichever frame the user happened to click on.
  let latestBass = 0;
  let latestMid = 0;
  let latestTreble = 0;

  const workletBeatUpdateCache: import('audio-reactive').BeatTrackerUpdate = {
    smoothedBands: { bass: 0, mid: 0, treble: 0 },
    beatIntensity: 0,
    isBeat: false,
    isTransient: false,
    spectralFlux: 0,
    bandFlux: 0,
    beatBass: false,
    beatMid: false,
    beatTreble: false,
  };

  const beatTrackerInputCache = {
    bands: { bass: 0, mid: 0, treble: 0 },
    weightedEnergy: 0,
    deltaMs: 16.67,
  };

  return {
    reset() {
      frame = 0;
      rms = 0;
      spectralAnalyser = null;
      lastWorkletBeat = null;
      cachedSpectralFeatures = null;
      lastSpectralAnalysisFrame = Number.NEGATIVE_INFINITY;
      lockedTime = null;
      lockedFrame = null;
      latestWeightedEnergy = 0;
      latestBass = 0;
      latestMid = 0;
      latestTreble = 0;
      signalProcessor.reset();
      beatTracker.reset();
    },
    getLatestAudioEnergy() {
      return latestWeightedEnergy;
    },
    getLatestAudioBands() {
      return { bass: latestBass, mid: latestMid, treble: latestTreble };
    },
    update({
      time,
      deltaMs,
      analyser,
      frequencyData,
      waveformData,
      frequencyDataL,
      frequencyDataR,
      waveformDataL,
      waveformDataR,
      target,
      relationshipLock,
      bandOverride,
    }: {
      time: number;
      deltaMs: number;
      analyser: FrequencyAnalyser | null;
      frequencyData: Uint8Array;
      waveformData?: Uint8Array;
      frequencyDataL?: Uint8Array | null;
      frequencyDataR?: Uint8Array | null;
      waveformDataL?: Uint8Array | null;
      waveformDataR?: Uint8Array | null;
      /** Capture-only band pin; see ToyRuntimeFrameState.bandOverride. */
      bandOverride?: { bass: number; mid: number; treble: number };
      target?: Partial<MilkdropRuntimeSignals>;
      relationshipLock?: boolean;
    }): MilkdropRuntimeSignals {
      const out = target ? (target as MilkdropRuntimeSignals) : signalCache;
      const resolvedWaveformData = waveformData ?? analyser?.getWaveformData();
      const resolvedFrequencyDataL =
        frequencyDataL ?? analyser?.getFrequencyDataL?.() ?? null;
      const resolvedFrequencyDataR =
        frequencyDataR ?? analyser?.getFrequencyDataR?.() ?? null;
      const resolvedWaveformDataL =
        waveformDataL ?? analyser?.getWaveformDataL?.() ?? null;
      const resolvedWaveformDataR =
        waveformDataR ?? analyser?.getWaveformDataR?.() ?? null;
      // After getWaveformData() above, so the AGC gain these getters apply
      // matches the byte buffers resolved this frame.
      const resolvedWaveformFloat = analyser?.getWaveformFloatData?.() ?? null;
      const resolvedWaveformFloatL =
        analyser?.getWaveformFloatDataL?.() ?? null;
      const resolvedWaveformFloatR =
        analyser?.getWaveformFloatDataR?.() ?? null;
      const sampleRate =
        typeof analyser?.getSampleRate === 'function'
          ? analyser.getSampleRate()
          : undefined;
      frame += 1;
      const processedSignals = signalProcessor.update({
        analyser,
        sampleRate,
        frequencyData,
        deltaMs,
      });
      const { bands, rawWeightedEnergy, weightedEnergy } = processedSignals;
      // A capture can pin the preset-facing bands. Our analyser and
      // projectM's beat detector normalise the same signal differently — a
      // steady tone converges to 1.0 here and to 2/3 there — so a parity
      // capture supplies projectM's value rather than letting the two drift
      // apart while claiming to compare renders.
      const relativeBands = bandOverride ?? processedSignals.relativeBands;
      const relativeAttenuatedBands =
        bandOverride ?? processedSignals.relativeAttenuatedBands;

      // Meyda performs a full FFT over the time-domain buffer. Sampling it
      // every fourth frame keeps the small spectral energy boost responsive
      // without paying for another main-thread FFT on every rendered frame.
      if (analyser !== spectralAnalyser) {
        spectralAnalyser = analyser;
        cachedSpectralFeatures = null;
        lastSpectralAnalysisFrame = Number.NEGATIVE_INFINITY;
      }
      if (
        analyser?.getSpectralFeatures &&
        frame - lastSpectralAnalysisFrame >= SPECTRAL_ANALYSIS_FRAME_INTERVAL
      ) {
        cachedSpectralFeatures = analyser.getSpectralFeatures();
        lastSpectralAnalysisFrame = frame;
      }
      const spectral = cachedSpectralFeatures;
      const rate = sampleRate ?? analyser?.getSampleRate?.() ?? 48_000;
      const spectralBrightness = spectral
        ? Math.min(1, spectral.spectralCentroid / Math.max(1, rate / 2))
        : 0;
      const spectralFocus = spectral
        ? 1 - Math.min(1, spectral.spectralFlatness)
        : 0;
      const spectralBoost =
        1.0 + spectralBrightness * 0.18 + spectralFocus * 0.14;
      const finalWeightedEnergy = Math.min(1, weightedEnergy * spectralBoost);
      const finalRawWeightedEnergy = Math.min(
        1,
        rawWeightedEnergy * spectralBoost,
      );

      const workletBeat = analyser?.getWorkletBeatDetection?.() ?? null;
      let update: import('audio-reactive').BeatTrackerUpdate;
      if (workletBeat) {
        // The analyser keeps returning the same verdict object until the next
        // worklet message (every 1024 samples: ~1.4 frames at 44.1 kHz, ~3
        // at 22.05 kHz). Beats are events, as the JS tracker's are: report
        // one on the first frame of the message that detected it, not on
        // every frame after, or `beat` would last a sample-rate-dependent
        // number of frames.
        const fresh = workletBeat !== lastWorkletBeat;
        lastWorkletBeat = workletBeat;
        workletBeatUpdateCache.smoothedBands.bass = bands.bass;
        workletBeatUpdateCache.smoothedBands.mid = bands.mid;
        workletBeatUpdateCache.smoothedBands.treble = bands.treble;
        workletBeatUpdateCache.beatIntensity = workletBeat.beatIntensity;
        workletBeatUpdateCache.isBeat = fresh && workletBeat.isBeat;
        workletBeatUpdateCache.isTransient = workletBeat.beatIntensity > 0.6;
        workletBeatUpdateCache.spectralFlux =
          analyser?.getSpectralFlux?.() ?? 0;
        workletBeatUpdateCache.bandFlux = 0;
        workletBeatUpdateCache.beatBass = fresh && workletBeat.beatBass;
        workletBeatUpdateCache.beatMid = fresh && workletBeat.beatMid;
        workletBeatUpdateCache.beatTreble = fresh && workletBeat.beatTreble;
        update = workletBeatUpdateCache;
      } else {
        beatTrackerInputCache.bands.bass = bands.bass;
        beatTrackerInputCache.bands.mid = bands.mid;
        beatTrackerInputCache.bands.treble = bands.treble;
        beatTrackerInputCache.weightedEnergy =
          finalRawWeightedEnergy * 0.62 + finalWeightedEnergy * 0.38;
        beatTrackerInputCache.deltaMs = deltaMs;
        update = beatTracker.update(beatTrackerInputCache, time * 1000);
      }

      rms = smoothLevel(
        rms,
        spectral?.rms ?? analyser?.getRmsLevel() ?? finalWeightedEnergy,
        deltaMs,
        44,
        180,
      );

      out.time = time;
      out.deltaMs = deltaMs;
      out.frame = frame;
      // Relationship lock: pin preset-facing time/frame at the first locked
      // frame's values. The internal `frame` counter above still advances (and
      // the raw `time` argument still feeds the beat tracker), so audio
      // responsiveness is untouched — only the clock-driven terms presets read
      // stay put. See docs/SENSORY_ACCESSIBILITY.md Layer 2 Q1.
      if (relationshipLock) {
        lockedTime = lockedTime ?? time;
        lockedFrame = lockedFrame ?? frame;
        out.time = lockedTime;
        out.frame = lockedFrame;
        out.relationshipLock = true;
      } else {
        lockedTime = null;
        lockedFrame = null;
        out.relationshipLock = false;
      }
      out.fps = deltaMs > 0 ? 1000 / deltaMs : 60;
      // Preset-facing registers use MilkDrop's relative scale (1.0 = the
      // track's own average for that band), not the 0..1 spectrum average.
      // Preset code is written against that scale — `above(bass, 1)` and
      // `bass_thresh = 1.3` are the two most common idioms in the catalog and
      // never fire on a 0..1 signal.
      out.bass = relativeBands.bass;
      out.mid = relativeBands.mid;
      out.mids = relativeBands.mid;
      out.treb = relativeBands.treble;
      out.treble = relativeBands.treble;
      out.bassAtt = relativeAttenuatedBands.bass;
      out.midAtt = relativeAttenuatedBands.mid;
      out.midsAtt = relativeAttenuatedBands.mid;
      out.trebleAtt = relativeAttenuatedBands.treble;
      out.bass_att = relativeAttenuatedBands.bass;
      out.mid_att = relativeAttenuatedBands.mid;
      out.mids_att = relativeAttenuatedBands.mid;
      out.treb_att = relativeAttenuatedBands.treble;
      out.treble_att = relativeAttenuatedBands.treble;
      out.rms = rms;
      // MilkDrop's vol is the mean of the relative bands (~1 during steady
      // music, <0.75 in quiet passages), not an absolute 0..1 level. The
      // bModWaveAlphaByVolume gate and preset code like `above(vol, 1.2)`
      // are written against that scale; raw rms never reaches it.
      out.vol =
        (relativeBands.bass + relativeBands.mid + relativeBands.treble) / 3;
      out.music = finalWeightedEnergy;
      out.beat = update.isBeat ? 1 : 0;
      out.beatPulse = update.beatIntensity;
      out.beat_pulse = update.beatIntensity;
      out.transient = update.isTransient ? 1 : 0;
      out.spectralFlux = update.spectralFlux;
      out.bandFlux = update.bandFlux;
      out.beatBass = update.beatBass ? 1 : 0;
      out.beatMid = update.beatMid ? 1 : 0;
      out.beatTreble = update.beatTreble ? 1 : 0;
      out.beat_bass = update.beatBass ? 1 : 0;
      out.beat_mid = update.beatMid ? 1 : 0;
      out.beat_treb = update.beatTreble ? 1 : 0;
      out.weightedEnergy = finalWeightedEnergy;
      const hp = processedSignals.harmonicPercussive;
      out.percussive = hp.percussive;
      out.harmonic = hp.harmonic;
      out.percussiveLow = hp.percussiveLow;
      out.percussiveMid = hp.percussiveMid;
      out.percussiveHigh = hp.percussiveHigh;
      out.percussiveRatio = hp.percussiveRatio;
      out.percussive_low = hp.percussiveLow;
      out.percussive_mid = hp.percussiveMid;
      out.percussive_high = hp.percussiveHigh;
      out.percussive_ratio = hp.percussiveRatio;
      out.frequencyData = processedSignals.frequencyData;
      out.waveformData = resolvedWaveformData;
      out.frequencyDataL = resolvedFrequencyDataL;
      out.frequencyDataR = resolvedFrequencyDataR;
      out.waveformDataL = resolvedWaveformDataL;
      out.waveformDataR = resolvedWaveformDataR;
      out.waveformFloatData = resolvedWaveformFloat;
      out.waveformFloatDataL = resolvedWaveformFloatL;
      out.waveformFloatDataR = resolvedWaveformFloatR;
      latestWeightedEnergy = finalWeightedEnergy;
      latestBass = relativeAttenuatedBands.bass;
      latestMid = relativeAttenuatedBands.mid;
      latestTreble = relativeAttenuatedBands.treble;

      return out;
    },
  };
}
