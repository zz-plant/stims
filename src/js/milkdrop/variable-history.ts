/**
 * Rolling per-variable history behind the editor's Inspect tab.
 *
 * Pure so it can be tested without a DOM: feed it frames, read back rows.
 * Each variable's window is a `SampleRing` — a fixed-capacity Float32Array
 * ring, so the per-frame push the render loop drives is O(1) with no
 * reallocation (the old `Array.shift` grew or slid a backing store every
 * frame per variable).
 *
 * Frames can carry the audio levels they were rendered with. Each variable's
 * recent history is then correlated with every band, and a variable that
 * clearly follows one is tagged with it — the answer to "why doesn't my
 * preset react?" is usually that nothing in it follows the audio.
 */
import { SampleRing } from './sample-ring.ts';

/** The audio a frame was rendered with, under the names equations use. */
export type AudioLevels = Readonly<Record<AudioBand, number>>;

export const AUDIO_BANDS = [
  'bass',
  'mid',
  'treb',
  'bass_att',
  'mid_att',
  'treb_att',
] as const;
export type AudioBand = (typeof AUDIO_BANDS)[number];

/** The band a variable follows, and how closely (Pearson r, sign kept). */
export type Reactivity = { band: AudioBand; r: number };

/** Below this |r| a variable is not reported as following a band. */
export const REACTIVITY_THRESHOLD = 0.6;
/**
 * The frame-to-frame changes must agree too, at least this closely. Two slow
 * drifts correlate in level by coincidence all the time; a variable that is
 * actually driven by a band also moves when the band moves.
 */
export const REACTIVITY_CHANGE_THRESHOLD = 0.3;
/** Samples needed before a correlation means anything. */
export const REACTIVITY_MIN_SAMPLES = 30;
export type VariableRow = {
  name: string;
  value: number;
  min: number;
  max: number;
  /** Oldest → newest, at most `capacity` samples. */
  history: SampleRing;
  /** True once the value has ever moved; constants are usually noise. */
  changing: boolean;
  pinned: boolean;
  /** Set when the variable clearly follows one audio band. */
  reacts: Reactivity | null;
};

type Track = {
  history: SampleRing;
  min: number;
  max: number;
  first: number;
  changing: boolean;
};

const Q_VAR = /^q(\d+)$/u;

function compareNames(a: string, b: string) {
  const qa = Q_VAR.exec(a);
  const qb = Q_VAR.exec(b);
  if (qa && qb) return Number(qa[1]) - Number(qb[1]);
  if (qa) return -1;
  if (qb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pearson correlation of the last `n` samples of two series, or 0 when either
 * is flat over that window (a constant follows nothing). Each series is read
 * newest-aligned, so a long history correlates correctly against a short one.
 */
type RingSeries = SampleRing | readonly number[];
const seriesCount = (s: RingSeries): number =>
  s instanceof SampleRing ? s.count : s.length;
const seriesAt = (s: RingSeries, index: number): number =>
  s instanceof SampleRing ? s.at(index) : (s[index] as number);

export function correlate(a: RingSeries, b: RingSeries): number {
  const n = Math.min(seriesCount(a), seriesCount(b));
  if (n < 2) return 0;
  const offA = seriesCount(a) - n;
  const offB = seriesCount(b) - n;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += seriesAt(a, offA + i);
    meanB += seriesAt(b, offB + i);
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = seriesAt(a, offA + i) - meanA;
    const db = seriesAt(b, offB + i) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA < 1e-12 || varB < 1e-12) return 0;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Pearson correlation of the frame-to-frame changes of two rings, newest
 * aligned: two slow drifts correlate in level by coincidence all the time,
 * while a variable actually driven by a band also moves when the band moves.
 * Reads the rings in place — no differenced copies are materialized.
 */
function correlateRingChanges(a: SampleRing, b: SampleRing): number {
  const n = Math.min(a.count, b.count);
  if (n < 3) return 0;
  const diffs = n - 1;
  const offA = a.count - diffs;
  const offB = b.count - diffs;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < diffs; i += 1) {
    meanA += a.at(offA + i) - a.at(offA + i - 1);
    meanB += b.at(offB + i) - b.at(offB + i - 1);
  }
  meanA /= diffs;
  meanB /= diffs;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < diffs; i += 1) {
    const da = a.at(offA + i) - a.at(offA + i - 1) - meanA;
    const db = b.at(offB + i) - b.at(offB + i - 1) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA < 1e-12 || varB < 1e-12) return 0;
  return cov / Math.sqrt(varA * varB);
}

export function createVariableHistory(capacity = 120) {
  const tracks = new Map<string, Track>();
  const pins = new Set<string>();
  const audio = new Map<AudioBand, SampleRing>(
    AUDIO_BANDS.map((band) => [band, new SampleRing(capacity)]),
  );

  const reactivityOf = (track: Track): Reactivity | null => {
    if (!track.changing || track.history.count < REACTIVITY_MIN_SAMPLES) {
      return null;
    }
    let best: Reactivity | null = null;
    for (const band of AUDIO_BANDS) {
      const levels = audio.get(band);
      if (!levels || levels.count < REACTIVITY_MIN_SAMPLES) continue;
      const r = correlate(track.history, levels);
      if (Math.abs(r) < REACTIVITY_THRESHOLD) continue;
      const change = correlateRingChanges(track.history, levels);
      if (change * Math.sign(r) < REACTIVITY_CHANGE_THRESHOLD) continue;
      if (
        Math.abs(r) >= REACTIVITY_THRESHOLD &&
        (!best || Math.abs(r) > Math.abs(best.r))
      ) {
        best = { band, r };
      }
    }
    return best;
  };

  return {
    push(variables: Readonly<Record<string, number>>, levels?: AudioLevels) {
      if (levels) {
        for (const band of AUDIO_BANDS) {
          const series = audio.get(band);
          if (!series) continue;
          const raw = levels[band];
          series.push(Number.isFinite(raw) ? raw : 0);
        }
      }
      for (const name of Object.keys(variables)) {
        const raw = variables[name];
        const value = Number.isFinite(raw) ? raw : 0;
        let track = tracks.get(name);
        if (!track) {
          track = {
            history: new SampleRing(capacity),
            min: value,
            max: value,
            first: value,
            changing: false,
          };
          tracks.set(name, track);
        }
        track.history.push(value);
        if (value < track.min) track.min = value;
        if (value > track.max) track.max = value;
        if (value !== track.first) track.changing = true;
      }
    },
    togglePin(name: string) {
      if (pins.has(name)) pins.delete(name);
      else pins.add(name);
    },
    isPinned: (name: string) => pins.has(name),
    /** Drop all samples (new preset, or the author pressed reset). Pins stay. */
    /**
     * Which variables follow the audio, strongest first. `measuring` until
     * there are enough frames; `silent` when the audio itself has not moved,
     * since then nothing could follow it and "no" would be misleading.
     */
    reactivitySummary():
      | { state: 'measuring' }
      | { state: 'silent' }
      | {
          state: 'measured';
          followers: Array<{ name: string } & Reactivity>;
        } {
      const bass = audio.get('bass');
      if (!bass || bass.count < REACTIVITY_MIN_SAMPLES) {
        return { state: 'measuring' };
      }
      const moving = AUDIO_BANDS.some((band) => {
        const series = audio.get(band);
        if (!series || series.count === 0) return false;
        const first = series.at(0);
        for (let i = 1; i < series.count; i += 1) {
          if (series.at(i) !== first) return true;
        }
        return false;
      });
      if (!moving) return { state: 'silent' };
      const followers: Array<{ name: string } & Reactivity> = [];
      for (const [name, track] of tracks) {
        const reacts = reactivityOf(track);
        if (reacts) followers.push({ name, ...reacts });
      }
      followers.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
      return { state: 'measured', followers };
    },
    reset() {
      tracks.clear();
      for (const series of audio.values()) series.clear();
    },
    /**
     * Pinned first, then q-vars in numeric order, then the rest by name.
     * `onlyChanging` hides variables that have never moved.
     */
    rows(
      options: { onlyChanging?: boolean; filter?: string } = {},
    ): VariableRow[] {
      const needle = options.filter?.trim().toLowerCase() ?? '';
      const rows: VariableRow[] = [];
      for (const [name, track] of tracks) {
        const pinned = pins.has(name);
        if (!pinned) {
          if (options.onlyChanging && !track.changing) continue;
          if (needle && !name.toLowerCase().includes(needle)) continue;
        }
        rows.push({
          name,
          value: track.history.newest(),
          min: track.min,
          max: track.max,
          history: track.history,
          changing: track.changing,
          pinned,
          reacts: reactivityOf(track),
        });
      }
      return rows.sort((a, b) =>
        a.pinned !== b.pinned
          ? a.pinned
            ? -1
            : 1
          : compareNames(a.name, b.name),
      );
    },
  };
}
