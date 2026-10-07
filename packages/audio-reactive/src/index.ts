/**
 * audio-reactive — public API.
 *
 * Everything here is pure TypeScript with no DOM or AudioWorklet globals, so
 * it runs on the main thread, in a worker, or in Bun/Node for offline
 * analysis. The AudioWorklet processor is deliberately NOT re-exported: it
 * calls `registerProcessor` at module top level and needs the
 * AudioWorkletGlobalScope. Load it through the `audio-reactive/worklet`
 * entry with `audioContext.audioWorklet.addModule(...)`.
 */

// Spectrum maths shared by the worklet and offline tools.
export {
  analyseBlockBytes,
  buildHannWindow,
  buildTwiddleTable,
  byteFromSample,
  computeBandAverage,
  validateFftSize,
} from './analyser-core.ts';
// "Audio is running but silent until a user gesture" observable.
export {
  isAudioAwaitingGesture,
  reportAudioAwaitingGesture,
  resetAudioGestureGate,
  subscribeAudioGestureGate,
} from './audio-gesture-gate.ts';
// Hermite interpolation between worklet packets.
export {
  type AudioEnergySnapshot,
  type AudioReactivityInterpolator,
  createAudioReactivityInterpolator,
} from './audio-interpolator.ts';
// AudioContext lifecycle contract (state machine + generation token).
export {
  type AudioContextLike,
  AudioGenerationToken,
  type AudioLifecycleState,
  AudioLifecycleTracker,
  type AudioSourceKind,
  PERMISSION_REQUIRED_SOURCES,
} from './audio-lifecycle.ts';
// Beat tracking.
export {
  type AudioBandLevels,
  type BeatTrackerOptions,
  type BeatTrackerUpdate,
  createBeatTracker,
} from './beat.ts';
// Harmonic/percussive separation (median-filter HPSS, Wiener masks).
export {
  createHarmonicPercussiveAnalyser,
  type HarmonicPercussiveLevels,
  type HarmonicPercussiveOptions,
} from './harmonic-percussive.ts';
// Reactivity metrics: band levels, weighted energy, transients, peak
// tracking, waveform auto-gain.
export {
  type BandLevels,
  type BandRatios,
  type BandWeights,
  createWaveformAutoGain,
  DEFAULT_FREQUENCY_BAND_RANGES,
  type ExtendedBandLevels,
  type FourBandTransientMetrics,
  type FrequencyBandRange,
  type FrequencyBandRanges,
  getBandLevels,
  getExtendedFrequencyBandLevels,
  getFourBandTransientMetrics,
  getFrequencyBandLevels,
  getWeightedEnergy,
  updateEnergyPeak,
} from './reactivity.ts';
// Spectral features (RMS, centroid, flatness, rolloff).
export {
  computeRms,
  computeSpectralCentroid,
  computeSpectralFlatness,
  computeSpectralRolloff,
  extractSpectralFeatures,
  type SpectralFeatureSnapshot,
} from './spectral-features.ts';
