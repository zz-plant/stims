/**
 * A tempo the performer sets instead of one inferred from the audio: tapped
 * on a key or pad, or followed from an external MIDI clock.
 *
 * The beat clock (milkdrop/runtime/beat-clock.ts) estimates tempo from onsets,
 * which is right for a listener and wrong for a set. Ambient intros, breaks
 * and half-time drops leave it with no confident tempo, so auto-advance falls
 * back to the nearest beat or to a timer exactly when a performer wants cuts
 * on the bar. A tempo set by hand does not drift with the mix, and its
 * downbeat is wherever the performer says the one is.
 *
 * A module store, like `preset-lock.ts`: the runtime reads it every frame and
 * the shell writes it from a key, a pad or the clock listener, and neither
 * owns the other. The runtime pulls it rather than subscribing because the
 * clock path replaces it 24 times a beat; listeners hear only changes a person
 * would notice (see `notifyIfChanged`).
 *
 * Not persisted. A tempo belongs to the track playing now.
 */

export type ManualTempoSource = 'tap' | 'midi-clock';

export type ManualTempo = {
  bpm: number;
  /**
   * A downbeat on the `performance.now()` timeline. Beats fall every
   * 60000 / bpm ms from here, in both directions, and every fourth one opens
   * a bar.
   */
  anchorAt: number;
  source: ManualTempoSource;
};

export type TapTempoResult =
  /** The first tap of a series, with no tempo to re-sync yet. */
  | { kind: 'counting' }
  /** Two or more taps set (or reset) the tempo. */
  | { kind: 'tempo'; bpm: number }
  /** One tap after a pause moved the downbeat and kept the tempo. */
  | { kind: 'resync'; bpm: number }
  /** An external clock owns the tempo; the tap changed nothing. */
  | { kind: 'clock-locked'; bpm: number }
  /** Too soon after the previous tap to be a beat: a key repeat or a bounce. */
  | { kind: 'ignored' };

/** A pause this long ends a tap series; the next tap starts a new one. */
export const TAP_SERIES_GAP_MS = 2000;

/** Fastest tap rate counted as beats (300 BPM). Faster is key repeat. */
const MIN_TAP_INTERVAL_MS = 200;

/** Taps kept for the fit: two bars at most, so a tempo change takes over
 * within a bar instead of being averaged against the old one. */
const MAX_TAPS = 8;

const BEATS_PER_BAR = 4;

/**
 * A clock that has sent nothing for this long has gone, Stop message or not:
 * a cable pulled or a mixer switched off sends no Stop. Ticks arrive every
 * 21 ms at 120 BPM, so a second of silence is unambiguous.
 */
export const MIDI_CLOCK_STALE_MS = 1000;

/** Clock-driven updates smaller than these are jitter, not news. */
const NOTIFY_BPM_DELTA = 0.5;
const NOTIFY_ANCHOR_DELTA_MS = 20;

type Listener = () => void;

const listeners = new Set<Listener>();
let tempo: ManualTempo | null = null;
/** The tempo listeners last heard about. */
let announced: ManualTempo | null = null;
/** A tap and its beat number within the current series. */
type TapPoint = { index: number; at: number };

let taps: TapPoint[] = [];
/** When the followed MIDI clock last reported, for spotting a dead one. */
let clockSeenAt = 0;

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function beatMs(bpm: number): number {
  return 60_000 / bpm;
}

/** Distance between two anchors on the beat grid, ignoring whole beats. */
function phaseDistance(a: number, b: number, period: number): number {
  const offset = (((a - b) % period) + period) % period;
  return Math.min(offset, period - offset);
}

function notifyIfChanged(): void {
  const before = announced;
  const after = tempo;
  const changed =
    before === null || after === null
      ? before !== after
      : before.source !== after.source ||
        Math.abs(before.bpm - after.bpm) >= NOTIFY_BPM_DELTA ||
        phaseDistance(before.anchorAt, after.anchorAt, beatMs(after.bpm)) >=
          NOTIFY_ANCHOR_DELTA_MS;
  if (!changed) return;
  announced = after;
  for (const listener of listeners) listener();
}

function setTempo(next: ManualTempo | null): void {
  tempo = next;
  notifyIfChanged();
}

/**
 * Least-squares fit of tap times against their beat index: the slope is the
 * beat length and the intercept is when beat 0, the downbeat, fell. Averaging
 * the intervals would weight only the first and last taps, and anchoring on
 * the raw first tap would carry that tap's error into every bar after it.
 *
 * Indices count from the start of the series rather than from the oldest tap
 * kept, so once old taps are dropped the intercept is still the series'
 * downbeat and the bar line does not move.
 */
function fitTaps(points: TapPoint[]): { period: number; downbeatAt: number } {
  const n = points.length;
  const meanIndex = points.reduce((sum, p) => sum + p.index, 0) / n;
  const meanTime = points.reduce((sum, p) => sum + p.at, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.index - meanIndex) * (point.at - meanTime);
    variance += (point.index - meanIndex) ** 2;
  }
  const period = covariance / variance;
  return { period, downbeatAt: meanTime - period * meanIndex };
}

/**
 * How many beats a tap is after the previous one: one, unless the series
 * already has a tempo and the gap is close to a whole number of beats. A
 * missed tap then counts as the beat it skipped instead of a slow beat that
 * drags the fit.
 */
function beatsSince(previousAt: number, at: number): number {
  if (taps.length < 2) return 1;
  const { period } = fitTaps(taps);
  const beats = Math.round((at - previousAt) / period);
  if (beats < 2) return 1;
  const error = Math.abs(at - previousAt - beats * period);
  return error <= period * 0.2 ? beats : 1;
}

/**
 * Records a tap. The first tap of a series is the downbeat: tap on the one.
 *
 * Two or more taps set the tempo. A single tap after a pause, with a tempo
 * already set, moves the downbeat to that tap and keeps the tempo, which is
 * how a performer puts the bar line back after the mix has drifted.
 */
export function tapTempo(at: number = now()): TapTempoResult {
  const current = getManualTempo(at);
  if (current?.source === 'midi-clock') {
    return { kind: 'clock-locked', bpm: current.bpm };
  }
  const previous = taps.at(-1);
  if (previous !== undefined) {
    const gap = at - previous.at;
    if (gap < MIN_TAP_INTERVAL_MS) return { kind: 'ignored' };
    if (gap > TAP_SERIES_GAP_MS) taps = [];
  }
  const index =
    previous === undefined || taps.length === 0
      ? 0
      : previous.index + beatsSince(previous.at, at);
  taps.push({ index, at });
  if (taps.length > MAX_TAPS) taps.shift();

  if (index === 0) {
    if (tempo === null) return { kind: 'counting' };
    setTempo({ ...tempo, anchorAt: at });
    return { kind: 'resync', bpm: tempo.bpm };
  }

  const { period, downbeatAt } = fitTaps(taps);
  const bpm = 60_000 / period;
  setTempo({ bpm, anchorAt: downbeatAt, source: 'tap' });
  return { kind: 'tempo', bpm };
}

/**
 * Follows an external MIDI clock (a DJ mixer, a DAW). While it runs it owns
 * the tempo and taps are refused; when it stops, the tempo goes back to the
 * music. Returns what changed so the caller can say so once, not per tick.
 */
export function followMidiClock(
  clock: { bpm: number | null; running: boolean; barPosition: number },
  at: number = now(),
): 'started' | 'stopped' | 'unchanged' {
  const following = tempo?.source === 'midi-clock';
  if (!clock.running || clock.bpm === null || !(clock.bpm > 0)) {
    if (!following) return 'unchanged';
    setTempo(null);
    return 'stopped';
  }
  const period = beatMs(clock.bpm);
  clockSeenAt = at;
  taps = [];
  setTempo({
    bpm: clock.bpm,
    anchorAt: at - clock.barPosition * BEATS_PER_BAR * period,
    source: 'midi-clock',
  });
  return following ? 'unchanged' : 'started';
}

/**
 * Shifts the beat grid by `deltaMs` (positive = later) without changing the
 * tempo: the phase nudge for a downbeat that sits a little off the music.
 */
export function nudgeManualTempo(deltaMs: number): ManualTempo | null {
  if (tempo === null || tempo.source !== 'tap') return tempo;
  setTempo({ ...tempo, anchorAt: tempo.anchorAt + deltaMs });
  return tempo;
}

/** Hands the tempo back to the audio. Returns false when none was set. */
export function clearManualTempo(): boolean {
  taps = [];
  if (tempo === null) return false;
  setTempo(null);
  return true;
}

/** The tempo set by hand or by a clock, or null while the audio decides. */
export function getManualTempo(at: number = now()): ManualTempo | null {
  if (
    tempo?.source === 'midi-clock' &&
    at - clockSeenAt > MIDI_CLOCK_STALE_MS
  ) {
    setTempo(null);
  }
  return tempo;
}

/** A stable primitive for React: who owns the tempo, if not the audio. */
export function getManualTempoSource(): ManualTempoSource | null {
  return announced?.source ?? null;
}

export function subscribeManualTempo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drop subscribers, taps and any tempo between cases. */
export function resetManualTempo(): void {
  listeners.clear();
  tempo = null;
  announced = null;
  taps = [];
  clockSeenAt = 0;
}
