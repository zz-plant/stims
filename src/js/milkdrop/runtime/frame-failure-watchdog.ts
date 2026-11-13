/**
 * Bounded recovery for a frame loop that throws (Phase 3 of
 * docs/architecture/vm-worker-isolation.md).
 *
 * One crashing preset must not leave a frozen canvas, and a preset that keeps
 * throwing must eventually be replaced rather than retried forever. The frame
 * loop used to inline that as a counter plus two magic numbers; this module
 * makes the policy explicit and testable:
 *
 *   - the first failure of a streak logs once (not 120 times),
 *   - a streak that reaches `maxConsecutiveFailures` asks for a recovery
 *     (advance/reload) exactly once, then resets,
 *   - a successful frame clears the streak.
 *
 * Pure and dependency-free so the policy can be tested without a renderer.
 */

export type FrameFailureVerdict = 'skip' | 'recover';

export type FrameFailureWatchdog = {
  /** Records a failed frame; returns what the caller should do next. */
  recordFailure(): { verdict: FrameFailureVerdict; log: boolean };
  /** Records a successful frame and clears the streak. */
  recordSuccess(): void;
  /** Current consecutive-failure count (for tests and diagnostics). */
  count(): number;
};

export const DEFAULT_MAX_CONSECUTIVE_FRAME_FAILURES = 120;

export function createFrameFailureWatchdog({
  maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FRAME_FAILURES,
}: {
  maxConsecutiveFailures?: number;
} = {}): FrameFailureWatchdog {
  if (!Number.isFinite(maxConsecutiveFailures) || maxConsecutiveFailures < 1) {
    throw new Error('maxConsecutiveFailures must be a positive number');
  }
  let failures = 0;
  return {
    recordFailure() {
      failures += 1;
      if (failures >= maxConsecutiveFailures) {
        failures = 0;
        return { verdict: 'recover', log: true };
      }
      // Log the first failure of a streak; the rest are the same error.
      return { verdict: 'skip', log: failures === 1 };
    },
    recordSuccess() {
      failures = 0;
    },
    count() {
      return failures;
    },
  };
}
