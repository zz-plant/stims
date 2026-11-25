/**
 * Guided breathing clock (#1625): one source of truth for the paced
 * breathing guide's phase and the stage's swell.
 *
 * The guide's bar and label read `guidedBreathingPhase(now)`; the frame loop
 * reads `guidedBreathingExpansion(now)` and feeds it to the same
 * `applyBreathingExpansion` the Breathing pulse dial uses. Both derive the
 * phase from elapsed time since start, so they cannot drift apart or drift
 * over a long session, and nothing touches the preset's source: the swell
 * is applied to the frame, after the VM, and before motion dampening, so a
 * viewer with motion at Still keeps the guide and loses the swell.
 */

/** Breaths a minute the guide offers; 6 is the usual default. */
export const MIN_BREATHS_PER_MINUTE = 4.5;
export const MAX_BREATHS_PER_MINUTE = 7;
export const DEFAULT_BREATHS_PER_MINUTE = 6;
/** Inhale share of each breath for "Longer out": 40% in, 60% out. */
export const LONGER_OUT_INHALE_SHARE = 0.4;
/**
 * Swell depth as a feedback-zoom factor. The dial's 0.02 reads as a nudge;
 * a guide the viewer follows needs a visible swell without streaming.
 */
export const GUIDED_BREATHING_AMPLITUDE = 0.03;
/** A timed session settles to rest over its last few seconds. */
export const GUIDED_BREATHING_SETTLE_MS = 4000;

export type BreathingShape = 'even' | 'longer-out';

export interface GuidedBreathingSession {
  startedAt: number;
  breathsPerMinute: number;
  shape: BreathingShape;
  /** Wall-clock end, or null for an open session. */
  endsAt: number | null;
}

let active: GuidedBreathingSession | null = null;
const listeners = new Set<() => void>();

export function clampBreathsPerMinute(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BREATHS_PER_MINUTE;
  }
  return Math.min(
    MAX_BREATHS_PER_MINUTE,
    Math.max(MIN_BREATHS_PER_MINUTE, value),
  );
}

export function inhaleShareFor(shape: BreathingShape): number {
  return shape === 'longer-out' ? LONGER_OUT_INHALE_SHARE : 0.5;
}

/**
 * The swell at a phase in [0, 1): -1 at the start of the inhale, +1 at the
 * turn, back to -1 at the end of the exhale. Each half is a half cosine, so
 * the picture eases in and out of both turns instead of reversing sharply.
 */
export function breathShape(phase: number, inhaleShare: number): number {
  const p = phase - Math.floor(phase);
  if (p < inhaleShare) return -Math.cos((Math.PI * p) / inhaleShare);
  return Math.cos((Math.PI * (p - inhaleShare)) / (1 - inhaleShare));
}

export function startGuidedBreathing(
  options: {
    breathsPerMinute: number;
    shape: BreathingShape;
    lengthMs: number | null;
  },
  now: number,
): GuidedBreathingSession {
  active = {
    startedAt: now,
    breathsPerMinute: clampBreathsPerMinute(options.breathsPerMinute),
    shape: options.shape,
    endsAt:
      options.lengthMs !== null && options.lengthMs > 0
        ? now + options.lengthMs
        : null,
  };
  for (const listener of listeners) listener();
  return active;
}

export function stopGuidedBreathing(): void {
  if (!active) return;
  active = null;
  for (const listener of listeners) listener();
}

export function getGuidedBreathing(): GuidedBreathingSession | null {
  return active;
}

export function subscribeGuidedBreathing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface GuidedBreathingPhase {
  /** Position within the current breath, 0-1. */
  phase: number;
  inhale: boolean;
  /** Whole breaths completed since the start. */
  breath: number;
  /** Ms left in a timed session, null when open. */
  remainingMs: number | null;
}

export function guidedBreathingPhase(now: number): GuidedBreathingPhase | null {
  if (!active) return null;
  const periodMs = 60000 / active.breathsPerMinute;
  const cycles = Math.max(0, now - active.startedAt) / periodMs;
  const phase = cycles - Math.floor(cycles);
  return {
    phase,
    inhale: phase < inhaleShareFor(active.shape),
    breath: Math.floor(cycles),
    remainingMs:
      active.endsAt === null ? null : Math.max(0, active.endsAt - now),
  };
}

/**
 * The expansion factor for the frame at `now`, or null with no session (so
 * the frame loop falls back to the dial). A timed session's swell fades to
 * 0 over its last `GUIDED_BREATHING_SETTLE_MS`.
 */
export function guidedBreathingExpansion(now: number): number | null {
  const state = guidedBreathingPhase(now);
  if (!state || !active) return null;
  let depth = GUIDED_BREATHING_AMPLITUDE;
  if (state.remainingMs !== null) {
    depth *= Math.min(1, state.remainingMs / GUIDED_BREATHING_SETTLE_MS);
  }
  return depth * breathShape(state.phase, inhaleShareFor(active.shape));
}
