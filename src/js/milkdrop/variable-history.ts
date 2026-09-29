/**
 * Rolling per-variable history behind the editor's Inspect tab.
 *
 * Pure so it can be tested without a DOM: feed it frames, read back rows.
 *
 * Frames can carry the audio levels they were rendered with. Each variable's
 * recent history is then correlated with every band, and a variable that
 * clearly follows one is tagged with it — the answer to "why doesn't my
 * preset react?" is usually that nothing in it follows the audio.
 */

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
  history: readonly number[];
  /** True once the value has ever moved; constants are usually noise. */
  changing: boolean;
  pinned: boolean;
  /** Set when the variable clearly follows one audio band. */
  reacts: Reactivity | null;
};

type Track = {
  history: number[];
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
 * is flat over that window (a constant follows nothing).
 */
export function correlate(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const offA = a.length - n;
  const offB = b.length - n;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[offA + i] as number;
    meanB += b[offB + i] as number;
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (a[offA + i] as number) - meanA;
    const db = (b[offB + i] as number) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA < 1e-12 || varB < 1e-12) return 0;
  return cov / Math.sqrt(varA * varB);
}

function differences(series: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    out.push((series[i] as number) - (series[i - 1] as number));
  }
  return out;
}

export function createVariableHistory(capacity = 120) {
  const tracks = new Map<string, Track>();
  const pins = new Set<string>();
  const audio = new Map<AudioBand, number[]>(
    AUDIO_BANDS.map((band) => [band, []]),
  );

  const reactivityOf = (track: Track): Reactivity | null => {
    if (!track.changing || track.history.length < REACTIVITY_MIN_SAMPLES) {
      return null;
    }
    let best: Reactivity | null = null;
    for (const band of AUDIO_BANDS) {
      const levels = audio.get(band) ?? [];
      if (levels.length < REACTIVITY_MIN_SAMPLES) continue;
      const r = correlate(track.history, levels);
      if (Math.abs(r) < REACTIVITY_THRESHOLD) continue;
      const change = correlate(differences(track.history), differences(levels));
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
          const series = audio.get(band) as number[];
          const raw = levels[band];
          series.push(Number.isFinite(raw) ? raw : 0);
          if (series.length > capacity) series.shift();
        }
      }
      for (const name of Object.keys(variables)) {
        const raw = variables[name];
        const value = Number.isFinite(raw) ? raw : 0;
        let track = tracks.get(name);
        if (!track) {
          track = {
            history: [],
            min: value,
            max: value,
            first: value,
            changing: false,
          };
          tracks.set(name, track);
        }
        track.history.push(value);
        if (track.history.length > capacity) track.history.shift();
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
      const bass = audio.get('bass') ?? [];
      if (bass.length < REACTIVITY_MIN_SAMPLES) return { state: 'measuring' };
      const moving = AUDIO_BANDS.some((band) => {
        const series = audio.get(band) ?? [];
        return series.some((value) => value !== series[0]);
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
      for (const series of audio.values()) series.length = 0;
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
          value: track.history[track.history.length - 1] ?? 0,
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
