/**
 * Tempo and bar position, derived from the beat flags the signal tracker
 * already produces.
 *
 * `createBeatTracker` (utils/audio/beat.ts) answers "is this frame a beat" and
 * nothing else — it carries no memory between beats, so there is no tempo, no
 * phase, and no way to ask "when is the next downbeat". Everything that wants
 * to land *on* the music rather than near it needs that memory: quantized
 * preset advances, bar-length crossfades, a tempo readout.
 *
 * This is deliberately not a beat *detector*. It consumes detected beats and
 * keeps the small amount of history needed to estimate a period, which is why
 * it is pure, synchronous, and testable without audio.
 *
 * Confidence is the honest part. Onset detection on real music misfires, and a
 * tempo derived from three intervals of noise is worse than no tempo at all
 * because callers will quantize to it. So intervals outside a plausible range
 * are counted as beats but excluded from the estimate, and `confidence`
 * reports what share of recent intervals actually agree with the median.
 * Callers are expected to check it before trusting `bpm` or `barPosition`.
 *
 * A tempo set by hand (tapped, or followed from a MIDI clock; see
 * core/manual-tempo.ts) replaces the estimate while it is set: the snapshot
 * reports it at full confidence, and beats fall on its grid rather than on
 * detected onsets. Onsets keep feeding the estimate underneath, so clearing
 * the manual tempo hands back a warm one instead of starting from silence.
 */
import type { ManualTempo } from '../../core/manual-tempo.ts';

/** Slowest and fastest inter-beat intervals treated as tempo evidence:
 * 240 BPM down to 30 BPM. Anything outside is a double-trigger or a gap. */
const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 2000;

/** Intervals kept for the median. Long enough to ride out one bad onset,
 * short enough to follow a real tempo change within a couple of bars. */
const HISTORY_SIZE = 8;

/** Estimates need a quorum: below this, confidence is reported as 0 rather
 * than as a high score over two samples that happen to agree. */
const MIN_SAMPLES_FOR_TEMPO = 4;

/** How far an interval may sit from the median and still count as agreeing. */
const AGREEMENT_TOLERANCE = 0.15;

/** A tempo estimate is stale once no beat has arrived for this long — the
 * track ended, went ambient, or the source was muted. */
const STALE_AFTER_MS = 4000;

export type MilkdropBeatClockSnapshot = {
  /** Estimated tempo, or null when there is not enough agreeing evidence. */
  bpm: number | null;
  /** 0–1 share of recent intervals agreeing with the median. */
  confidence: number;
  /** Monotonic count of beats observed since the last reset; with a manual
   * tempo, the beat's number on that tempo's grid. */
  beatIndex: number;
  /** Beat position within the bar, 0 on the downbeat. */
  barPosition: number;
  /** Timestamp of the most recent beat, or null before the first one. */
  lastBeatAt: number | null;
};

export type MilkdropBeatClock = ReturnType<typeof createMilkdropBeatClock>;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function createMilkdropBeatClock({
  beatsPerBar = 4,
  getManualTempo = () => null,
}: {
  beatsPerBar?: number;
  /** Read every frame with the frame time; null leaves the tempo to the
   * detected beats. */
  getManualTempo?: (now: number) => ManualTempo | null;
} = {}) {
  const intervals: number[] = [];
  let beatIndex = 0;
  let lastBeatAt: number | null = null;
  /** The manual grid beat the last frame was in, or null off the grid. */
  let lastGridBeat: number | null = null;

  const gridBeatAt = (manual: ManualTempo, now: number): number =>
    Math.floor((now - manual.anchorAt) / (60_000 / manual.bpm));

  /**
   * The bar phase is anchored to a beat rather than to `beatIndex % 4`,
   * because dropped beats would otherwise rotate the bar permanently: miss
   * one onset and every "downbeat" after it lands on beat two. Re-anchoring
   * whenever the clock goes stale keeps a new track starting its own bar
   * instead of inheriting the previous one's phase.
   */
  let barAnchorIndex = 0;

  const tempoIntervalMs = (): number | null =>
    intervals.length >= MIN_SAMPLES_FOR_TEMPO ? median(intervals) : null;

  const confidence = (): number => {
    const centre = tempoIntervalMs();
    if (centre === null) return 0;
    const agreeing = intervals.filter(
      (value) => Math.abs(value - centre) <= centre * AGREEMENT_TOLERANCE,
    ).length;
    return agreeing / intervals.length;
  };

  const reset = () => {
    lastGridBeat = null;
    intervals.length = 0;
    beatIndex = 0;
    lastBeatAt = null;
    barAnchorIndex = 0;
  };

  return {
    /** Records a detected beat. `now` is the frame timestamp in ms. */
    noteBeat(now: number): void {
      if (lastBeatAt === null) {
        // First beat of a cold clock opens the bar, matching how the first
        // beat after a silence gap is treated. Any anchor is arbitrary
        // without knowing the real phase; the two paths agreeing is not.
        barAnchorIndex = beatIndex + 1;
      } else {
        const interval = now - lastBeatAt;
        if (interval > STALE_AFTER_MS) {
          // A gap this long is a new musical context, not a slow tempo.
          // Keep counting beats, but start the estimate and the bar over.
          intervals.length = 0;
          barAnchorIndex = beatIndex + 1;
        } else if (interval >= MIN_INTERVAL_MS && interval <= MAX_INTERVAL_MS) {
          intervals.push(interval);
          if (intervals.length > HISTORY_SIZE) intervals.shift();
        }
        // Intervals inside the stale window but outside the plausible range
        // (a double-trigger on one kick) still advance the beat count; they
        // just contribute no tempo evidence.
      }
      lastBeatAt = now;
      beatIndex += 1;
    },

    /**
     * Whether this frame lands a beat. Without a manual tempo that is the
     * detected onset the caller passes in; with one, it is the first frame
     * at or past each beat of the manual grid, and onsets are ignored.
     *
     * A grid that jumps backwards (a re-sync tap, a phase nudge) fires
     * nothing until it passes the next beat, so moving the bar line never
     * reads as an extra beat.
     */
    frameBeat(now: number, detectedBeat: boolean): boolean {
      const manual = getManualTempo(now);
      if (!manual) {
        lastGridBeat = null;
        return detectedBeat;
      }
      const beat = gridBeatAt(manual, now);
      const crossed = lastGridBeat !== null && beat > lastGridBeat;
      lastGridBeat = beat;
      return crossed;
    },

    /**
     * True when the most recent beat opened a bar. Meaningless without
     * tempo confidence — callers should gate on `snapshot().confidence`.
     * Pass the frame time so a manual grid can answer for that frame.
     */
    isDownbeat(now?: number): boolean {
      const manual = now === undefined ? null : getManualTempo(now);
      if (manual && now !== undefined) {
        const beat = gridBeatAt(manual, now);
        return ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
      }
      return (beatIndex - barAnchorIndex) % beatsPerBar === 0;
    },

    /** Drops tempo history without forgetting that beats have occurred. */
    noteSilence(now: number): void {
      if (lastBeatAt !== null && now - lastBeatAt > STALE_AFTER_MS) {
        intervals.length = 0;
      }
    },

    snapshot(now?: number): MilkdropBeatClockSnapshot {
      const manual = now === undefined ? null : getManualTempo(now);
      if (manual && now !== undefined) {
        const beat = gridBeatAt(manual, now);
        return {
          bpm: manual.bpm,
          confidence: 1,
          beatIndex: beat,
          barPosition: ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar,
          lastBeatAt: manual.anchorAt + beat * (60_000 / manual.bpm),
        };
      }
      const stale =
        lastBeatAt !== null &&
        now !== undefined &&
        now - lastBeatAt > STALE_AFTER_MS;
      const interval = stale ? null : tempoIntervalMs();
      return {
        bpm: interval === null ? null : 60_000 / interval,
        confidence: stale ? 0 : confidence(),
        beatIndex,
        barPosition: (beatIndex - barAnchorIndex) % beatsPerBar,
        lastBeatAt,
      };
    },

    reset,
  };
}
