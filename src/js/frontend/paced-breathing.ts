/**
 * Paced breathing mode (#1625): the session around the guided breathing
 * clock in `core/services/guided-breathing.ts`.
 *
 * Starting a session runs the clock (which sets the stage's swell and the
 * guide's phase), turns Reduce flashing on for the session and restores the
 * visitor's own setting after, holds a screen wake lock, and ends a timed
 * session on its own. Nothing here edits the preset: the swell is applied
 * to each frame, so ending leaves the preset exactly as it was.
 *
 * The setup sheet's open state lives here too, so the palette action and a
 * `?breathe=` link can open it without a prop chain into the stage.
 */

import {
  getActiveAccessibilityPreference,
  setAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import {
  type BreathingShape,
  clampBreathsPerMinute,
  getGuidedBreathing,
  startGuidedBreathing,
  stopGuidedBreathing,
} from '../core/services/guided-breathing.ts';
import { connectWakeLock } from './wake-lock.ts';

export type { BreathingShape };

export interface PacedBreathingOptions {
  /** Breaths a minute, clamped to 4.5-7. */
  rate: number;
  shape: BreathingShape;
  /** Session length in ms; null is open-ended. */
  lengthMs: number | null;
  /** Clock for the session start; defaults to performance.now(). */
  now?: number;
}

let activeStop: (() => void) | null = null;

export function isPacedBreathingActive(): boolean {
  return activeStop !== null && getGuidedBreathing() !== null;
}

export function startPacedBreathing(
  options: PacedBreathingOptions,
): () => void {
  stopPacedBreathing();

  startGuidedBreathing(
    {
      breathsPerMinute: clampBreathsPerMinute(options.rate),
      shape: options.shape,
      lengthMs: options.lengthMs,
    },
    options.now ?? performance.now(),
  );

  const previousReduceFlashing =
    getActiveAccessibilityPreference().reduceFlashing;
  if (!previousReduceFlashing) {
    setAccessibilityPreference({ reduceFlashing: true });
  }

  let stopped = false;
  const releaseWakeLock = connectWakeLock(() => !stopped);
  const timer =
    options.lengthMs !== null && options.lengthMs > 0
      ? setTimeout(() => stop(), options.lengthMs)
      : null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    releaseWakeLock();
    stopGuidedBreathing();
    // Only undo what the session did: a visitor who already had Reduce
    // flashing on is not touched at either end.
    if (!previousReduceFlashing) {
      setAccessibilityPreference({ reduceFlashing: false });
    }
    if (activeStop === stop) activeStop = null;
  };

  activeStop = stop;
  return stop;
}

export function stopPacedBreathing(): void {
  activeStop?.();
}

/** Prefill for the setup sheet, from a link or the visitor's last choice. */
export interface BreathingSetupRequest {
  rate: number;
}

let setupRequest: BreathingSetupRequest | null = null;
const setupListeners = new Set<() => void>();

export function openBreathingSetup(
  request: BreathingSetupRequest = { rate: 6 },
): void {
  setupRequest = { rate: clampBreathsPerMinute(request.rate) };
  for (const listener of setupListeners) listener();
}

export function closeBreathingSetup(): void {
  if (!setupRequest) return;
  setupRequest = null;
  for (const listener of setupListeners) listener();
}

export function getBreathingSetupRequest(): BreathingSetupRequest | null {
  return setupRequest;
}

export function subscribeBreathingSetup(listener: () => void): () => void {
  setupListeners.add(listener);
  return () => {
    setupListeners.delete(listener);
  };
}

/** `?breathe=6` asks for the setup sheet at that rate; absent or junk is null. */
export function readBreatheParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('breathe');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? clampBreathsPerMinute(value)
    : null;
}
