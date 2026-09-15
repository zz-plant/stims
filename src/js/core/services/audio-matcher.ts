import {
  type VisualSearchRequest,
  VisualSearchResponseSchema,
} from '../edge-contracts.ts';
import { resolveOptionalApiUrl } from './optional-api.ts';

export interface AudioProfile {
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  beatIntensity: number;
  rms: number;
  /**
   * Present only on windowed profiles: the loudest instant in the analysed
   * span. The ratio against `rms` is the music's crest factor — how much
   * dynamic headroom it keeps, which is what separates a compressed wall of
   * sound from a punchy, transient-driven one at equal loudness.
   */
  peakRms?: number;
  /** Present only on windowed profiles: detected bass onsets per second. */
  onsetRate?: number;
}

/**
 * One reading of the live audio signal, sampled on the engine's frame cadence.
 * A window of these — a couple of seconds, not one frame — is what a piece of
 * music actually sounds like; any single frame is a coin flip between a kick
 * drum and the silence between kicks.
 */
export interface AudioWindowSample {
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  /** Timestamp in ms (performance.now()-scale), used for onset pacing. */
  t: number;
}

export function buildAudioProfile(snapshot: {
  audioEnergy?: number;
  fftBands?: number[];
}): AudioProfile {
  const energy = snapshot.audioEnergy ?? 0;

  if (snapshot.fftBands && snapshot.fftBands.length >= 3) {
    const [bass, mid, treble] = snapshot.fftBands;
    return {
      bassEnergy: bass,
      midEnergy: mid,
      trebleEnergy: treble,
      beatIntensity: energy > 0.04 ? 1 : 0,
      rms: energy,
    };
  }

  return {
    bassEnergy: energy * 0.6,
    midEnergy: energy * 0.3,
    trebleEnergy: energy * 0.1,
    beatIntensity: energy > 0.04 ? 1 : 0,
    rms: energy,
  };
}

/** Below this window mean the signal is silence, not quiet music. */
const WINDOW_SILENCE_RMS = 0.005;

/** Absolute bass floor for onset detection, keeping noise from counting. */
const ONSET_FLOOR = 0.08;

/** Fewer samples than this cannot characterise a window. */
const MIN_WINDOW_SAMPLES = 4;

/**
 * Profiles a span of audio rather than one frame of it, so the description
 * tracks the piece — its balance, dynamics, and beat — instead of whichever
 * transient happened to be playing when someone clicked.
 *
 * Returns null for a silent window: callers keep their own "nothing is
 * playing" handling rather than searching against a fabrication.
 */
export function buildWindowAudioProfile(
  samples: AudioWindowSample[],
): AudioProfile | null {
  if (samples.length < MIN_WINDOW_SAMPLES) return null;

  let sumRms = 0;
  let peakRms = 0;
  let sumBass = 0;
  let sumMid = 0;
  let sumTreble = 0;
  for (const sample of samples) {
    sumRms += sample.rms;
    if (sample.rms > peakRms) peakRms = sample.rms;
    sumBass += sample.bass;
    sumMid += sample.mid;
    sumTreble += sample.treble;
  }
  const n = samples.length;
  const rms = sumRms / n;
  if (rms < WINDOW_SILENCE_RMS) return null;

  // Onsets: bass local peaks that stand clear of the window's own bass
  // average. The relative threshold adapts to the mix; the absolute floor
  // keeps a hissing hi-hat track from registering as bass pulses.
  const bassMean = sumBass / n;
  const bassThreshold = Math.max(ONSET_FLOOR, bassMean * 1.3);
  let onsets = 0;
  for (let i = 1; i < n - 1; i += 1) {
    const level = samples[i]!.bass;
    if (
      level >= bassThreshold &&
      level > samples[i - 1]!.bass &&
      level >= samples[i + 1]!.bass
    ) {
      onsets += 1;
    }
  }

  const spanMs = samples[n - 1]!.t - samples[0]!.t;
  const seconds = Math.max(0.25, spanMs / 1000);

  return {
    bassEnergy: sumBass / n,
    midEnergy: sumMid / n,
    trebleEnergy: sumTreble / n,
    // A steady groove at 120bpm lands near 2 onsets/s; intensity saturates
    // there rather than at the old binary loudness flag.
    beatIntensity: Math.min(1, onsets / seconds / 2.5),
    rms,
    peakRms,
    onsetRate: onsets / seconds,
  };
}

/**
 * Turns a profile into query text in the same vocabulary the catalog is
 * described with (see describeFrameParts in visual-embedding.ts) — palette,
 * edges, motion, and nothing else, so the two sides of the index can match.
 *
 * This used to read `rms` and ignore the other five fields, which left the
 * whole feature with five possible queries. Spectral balance picks the
 * palette and edge language, and on a windowed profile the edge language is
 * earned by measured transients and dynamics rather than by raw loudness, so
 * a smooth ambient track and a punchy one no longer describe themselves
 * identically.
 */
export function describeAudioProfile(profile: AudioProfile): string {
  const { rms, bassEnergy, midEnergy, trebleEnergy, beatIntensity } = profile;

  if (rms < 0.005)
    return 'dominant monochrome neutral, smooth gradients, static';

  // Which band leads decides the colour language. The mapping is a
  // convention, not physics: bass reads warm and heavy, treble reads cool and
  // bright, which is how the catalog's own palettes tend to be described.
  const bands = bassEnergy + midEnergy + trebleEnergy || 1;
  const bassShare = bassEnergy / bands;
  const trebleShare = trebleEnergy / bands;
  const hue =
    bassShare > 0.5
      ? 'red'
      : trebleShare > 0.4
        ? 'cyan'
        : bassShare > trebleShare
          ? 'orange'
          : 'blue';

  const palette =
    rms < 0.02
      ? `monochrome ${hue}`
      : rms < 0.08
        ? `${hue}-dominant palette`
        : `vibrant ${hue}-centered palette`;

  // Busyness comes from treble content and from transients. A single frame
  // cannot see transients, so without window stats loudness stands in (the
  // binary beat flag); with them, measured onsets and crest decide.
  let edges: string;
  if (profile.onsetRate !== undefined && profile.peakRms !== undefined) {
    const crest = profile.peakRms / Math.max(rms, 0.0001);
    edges =
      trebleShare > 0.5 || profile.onsetRate > 3
        ? 'dense edges'
        : trebleShare > 0.35 || profile.onsetRate > 1 || crest > 2.5
          ? 'moderate edges'
          : 'smooth gradients';
  } else {
    edges =
      trebleShare > 0.35 || beatIntensity > 0
        ? trebleShare > 0.5
          ? 'dense edges'
          : 'moderate edges'
        : 'smooth gradients';
  }

  const motion =
    rms < 0.02
      ? 'subtle motion'
      : rms < 0.06
        ? 'moderate motion'
        : 'high motion';

  return `dominant ${palette}, ${edges}, ${motion}`;
}

export async function searchByAudioProfile(
  profile: AudioProfile,
  signal?: AbortSignal,
  topK?: number,
): Promise<Array<{ presetId: string; score: number }>> {
  const endpoint = resolveOptionalApiUrl('/api/visual-search');
  if (!endpoint) return [];

  const request: VisualSearchRequest = {
    description: describeAudioProfile(profile),
  };
  if (topK !== undefined) {
    request.topK = topK;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) return [];
  // Audio match is a background suggestion, so a malformed body degrades to
  // "no suggestions" rather than throwing into the caller's render path.
  const parsed = VisualSearchResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.results : [];
}
