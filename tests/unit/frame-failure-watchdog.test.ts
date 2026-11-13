/**
 * Phase 3 of docs/architecture/vm-worker-isolation.md: the frame loop's crash
 * recovery is an explicit watchdog. A single failure skips the frame and logs
 * once; a streak that reaches the limit asks for recovery exactly once; a
 * successful frame clears the streak.
 */
import { describe, expect, test } from 'bun:test';
import {
  createFrameFailureWatchdog,
  DEFAULT_MAX_CONSECUTIVE_FRAME_FAILURES,
} from '../../src/js/milkdrop/runtime/frame-failure-watchdog.ts';

describe('frame failure watchdog', () => {
  test('the first failure logs, later ones in the streak do not', () => {
    const w = createFrameFailureWatchdog({ maxConsecutiveFailures: 5 });
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: true });
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: false });
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: false });
    expect(w.count()).toBe(3);
  });

  test('reaching the limit recovers exactly once, then resets', () => {
    const w = createFrameFailureWatchdog({ maxConsecutiveFailures: 3 });
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: true });
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: false });
    expect(w.recordFailure()).toEqual({ verdict: 'recover', log: true });
    expect(w.count()).toBe(0);
    // The next streak starts fresh.
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: true });
  });

  test('a successful frame clears the streak', () => {
    const w = createFrameFailureWatchdog({ maxConsecutiveFailures: 3 });
    w.recordFailure();
    w.recordFailure();
    w.recordSuccess();
    expect(w.count()).toBe(0);
    // Two more failures must not reach the old streak's limit.
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: true });
    expect(w.recordFailure()).toEqual({ verdict: 'skip', log: false });
  });

  test('the default limit matches the frame loop constant', () => {
    expect(DEFAULT_MAX_CONSECUTIVE_FRAME_FAILURES).toBe(120);
  });

  test('rejects a non-positive limit', () => {
    expect(() =>
      createFrameFailureWatchdog({ maxConsecutiveFailures: 0 }),
    ).toThrow();
    expect(() =>
      createFrameFailureWatchdog({ maxConsecutiveFailures: -1 }),
    ).toThrow();
  });
});
