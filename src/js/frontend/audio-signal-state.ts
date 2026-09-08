/**
 * Whether audio is not just *selected* but actually *arriving*.
 *
 * The stage has always shown an energy bar, and the bar has always been
 * honest — but it answers a question nobody was asking. A flat bar means
 * "nothing is coming through", and that single fact has at least three
 * causes with three different fixes: no source is running at all; a source
 * is running but the browser is still holding the AudioContext for a user
 * gesture; or a source is genuinely connected and silent (wrong input
 * device, muted tab, a paused track). Those are indistinguishable from a
 * bar at rest, so the visitor is left to guess which one they are in.
 *
 * `audio-gesture-gate.ts` already reports the middle case. This module adds
 * the third by watching the energy store over time, and collapses all of it
 * into one value the UI can render and name.
 *
 * Nothing here starts, stops, or resumes audio — like the gesture gate, it
 * only reports.
 */

import { useEffect, useRef, useState } from 'react';
import {
  isAudioAwaitingGesture,
  subscribeAudioGestureGate,
} from '../core/audio-gesture-gate.ts';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';

export type AudioSignalState =
  /** No source is running. */
  | 'off'
  /** A source is running, but the browser is holding it for a gesture. */
  | 'awaiting-gesture'
  /** A source is running and unblocked, and nothing is coming through. */
  | 'silent'
  /** Signal is arriving. */
  | 'live';

/**
 * Energy below which a frame counts as "nothing came through".
 *
 * A judgment call, not a measurement, and deliberately well above the
 * store's own 0.001 change dead zone: a connected-but-quiet microphone in a
 * still room reads as small non-zero room noise, and calling that "live"
 * would make the state useless exactly where it is most needed. Raising it
 * further starts calling genuinely quiet passages silent, which is the worse
 * error — this reads as reassurance, not as a fault light.
 */
export const SILENCE_ENERGY_FLOOR = 0.02;

/**
 * How long the signal must stay under the floor before we say so.
 *
 * Long enough to sit through a breakdown, a track gap, or the tail of a
 * fade without the control flickering; short enough that someone who picked
 * the wrong input device finds out while they are still looking at it.
 */
export const SILENCE_GRACE_MS = 4000;

/** Cadence for re-evaluating elapsed silence. */
const POLL_MS = 500;

/**
 * The "we last heard something at" mark, refreshed from the current level.
 *
 * Pulled out of the hook because the subtle half is here: the mark has to be
 * recomputed from a *sample*, not merely carried forward. The energy store
 * notifies on change only, so a level that is high but perfectly steady — a
 * held tone, or a stalled pipeline repeating its last value — produces no
 * events, and a mark that only advanced on notification goes stale under
 * exactly the condition it is meant to detect.
 */
export function nextSignalMark(
  energy: number,
  previousMark: number | null,
  now: number,
): number | null {
  return energy >= SILENCE_ENERGY_FLOOR ? now : previousMark;
}

/**
 * Whether a sampled level can be believed yet for a freshly selected source.
 *
 * The energy store is not cleared when the source changes — it holds the last
 * value the previous source published until the new one overwrites it. So
 * nulling the mark on a source change is not enough on its own: the very next
 * sample reads the old source's level and re-marks it, which is exactly the
 * "fresh microphone reported live on the strength of the demo track" the reset
 * exists to prevent.
 *
 * A level counts once it has moved off the value inherited at switch time.
 * If a new source coincidentally publishes the identical level, this keeps
 * withholding and the state settles on 'silent' after the grace window —
 * the safe direction to be wrong in, since it prompts a check rather than
 * asserting everything is fine.
 */
export function isInheritedLevel(
  energy: number,
  inherited: number | null,
): boolean {
  return inherited !== null && energy === inherited;
}

export function classifyAudioSignal({
  hasSource,
  awaitingGesture,
  msSinceSignal,
  graceMs = SILENCE_GRACE_MS,
}: {
  hasSource: boolean;
  awaitingGesture: boolean;
  /** Time since energy was last at or above the floor; null if never. */
  msSinceSignal: number | null;
  graceMs?: number;
}): AudioSignalState {
  if (!hasSource) return 'off';
  if (awaitingGesture) return 'awaiting-gesture';
  if (msSinceSignal === null || msSinceSignal >= graceMs) return 'silent';
  return 'live';
}

/** Plain-language state, shared by the visible label and the accessible name. */
export function describeAudioSignal(
  state: AudioSignalState,
  sourceName: string | null,
): { label: string; detail: string } {
  switch (state) {
    case 'off':
      return {
        label: 'No audio',
        detail:
          'Nothing is playing. Pick a source to give the visuals something to react to.',
      };
    case 'awaiting-gesture':
      return {
        label: 'Tap for sound',
        detail: `${sourceName ?? 'Audio'} is ready, and your browser is holding it until you interact with the page.`,
      };
    case 'silent':
      return {
        label: 'No signal',
        detail: `${sourceName ?? 'The source'} is connected, but nothing is coming through.`,
      };
    case 'live':
      return {
        label: sourceName ?? 'Audio',
        detail: `${sourceName ?? 'Audio'} is playing and the visuals are reacting to it.`,
      };
  }
}

/**
 * Live signal state for the current source.
 *
 * The energy store only notifies on change, so silence produces no events at
 * all — the moment the level settles at zero, the last notification has
 * already been delivered. Elapsed silence therefore has to be polled rather
 * than derived from the subscription alone; the subscription's job is only to
 * keep the "last time we heard something" mark fresh.
 */
export function useAudioSignalState(hasSource: boolean): AudioSignalState {
  const [state, setState] = useState<AudioSignalState>(() =>
    classifyAudioSignal({
      hasSource,
      awaitingGesture: isAudioAwaitingGesture(),
      msSinceSignal: null,
    }),
  );
  const lastSignalAtRef = useRef<number | null>(null);

  useEffect(() => {
    // A source change restarts the judgement: carrying the previous source's
    // mark forward would report a fresh microphone as live on the strength of
    // the demo track that preceded it.
    lastSignalAtRef.current = null;
    // Nulling the mark alone does not achieve that, because the energy store
    // keeps publishing the previous source's last value until the new one
    // overwrites it. Hold the inherited level aside and disbelieve it until
    // it moves; see isInheritedLevel.
    let inherited: number | null = getAudioEnergy();

    // Samples the level itself rather than trusting the subscription to have
    // fired. The store only notifies on *change*, so a level that is high but
    // perfectly steady — a held tone, or a stalled pipeline repeating its last
    // value — delivers no events at all, and a version of this that only
    // re-timed the previous mark reported "no signal" over a meter sitting at
    // half scale. Reading here makes the subscription a latency optimisation
    // instead of the only source of truth.
    const evaluate = () => {
      const now = Date.now();
      const energy = getAudioEnergy();
      if (!isInheritedLevel(energy, inherited)) inherited = null;
      lastSignalAtRef.current = nextSignalMark(
        inherited === null ? energy : 0,
        lastSignalAtRef.current,
        now,
      );
      const lastSignalAt = lastSignalAtRef.current;
      setState(
        classifyAudioSignal({
          hasSource,
          awaitingGesture: isAudioAwaitingGesture(),
          msSinceSignal: lastSignalAt === null ? null : now - lastSignalAt,
        }),
      );
    };

    evaluate();
    const unsubscribeEnergy = subscribeAudioEnergy(evaluate);
    const unsubscribeGate = subscribeAudioGestureGate(evaluate);
    // Only a running source can go silent, so an idle stage schedules nothing.
    const timer = hasSource ? setInterval(evaluate, POLL_MS) : null;

    return () => {
      unsubscribeEnergy();
      unsubscribeGate();
      if (timer !== null) clearInterval(timer);
    };
  }, [hasSource]);

  return state;
}
