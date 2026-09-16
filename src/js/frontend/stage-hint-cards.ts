/**
 * The one-time empty-state cards on the live stage — Perform (bottom-left)
 * and the Cue deck (bottom-right) — and whether each has been dismissed.
 *
 * Kept in one store rather than a private flag per component so the cards
 * can take turns. Both used to appear together the moment a returning
 * visitor pressed play: two explainer panels in opposite corners of a stage
 * they came back to for the visuals. The cue deck now waits until the
 * Perform card has been dealt with (dismissed, or made moot by pinning a
 * control), so a session meets at most one of them.
 *
 * Persisted per card under its original key, so nothing anyone already
 * dismissed comes back.
 */

import { useSyncExternalStore } from 'react';
import { getBrowserStorage } from '../core/state/browser-storage.ts';

export type StageHintCard = 'perform' | 'cue';

const STORAGE_KEYS: Record<StageHintCard, string> = {
  perform: 'stims:perform-empty-hint-dismissed',
  cue: 'stims:cue-empty-hint-dismissed',
};

const dismissed = new Map<StageHintCard, boolean>();
const listeners = new Set<() => void>();

function read(card: StageHintCard): boolean {
  const cached = dismissed.get(card);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = getBrowserStorage()?.getItem(STORAGE_KEYS[card]) === '1';
  } catch {
    value = false;
  }
  dismissed.set(card, value);
  return value;
}

export function isStageHintDismissed(card: StageHintCard): boolean {
  return read(card);
}

export function dismissStageHint(card: StageHintCard): void {
  if (read(card)) return;
  dismissed.set(card, true);
  try {
    getBrowserStorage()?.setItem(STORAGE_KEYS[card], '1');
  } catch {
    console.debug(`Unable to persist ${card} hint dismissal`);
  }
  for (const listener of listeners) listener();
}

export function subscribeStageHints(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this card has been dismissed; re-renders when any card is. */
export function useStageHintDismissed(card: StageHintCard): boolean {
  return useSyncExternalStore(
    subscribeStageHints,
    () => read(card),
    () => true,
  );
}

/** Test seam: forget the cached answers so storage is read again. */
export function resetStageHintCache(): void {
  dismissed.clear();
}
