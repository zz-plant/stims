import { afterEach, describe, expect, test } from 'bun:test';
import {
  breathShape,
  clampBreathsPerMinute,
  GUIDED_BREATHING_AMPLITUDE,
  GUIDED_BREATHING_SETTLE_MS,
  guidedBreathingExpansion,
  guidedBreathingPhase,
  LONGER_OUT_INHALE_SHARE,
  startGuidedBreathing,
  stopGuidedBreathing,
} from '../../src/js/core/services/guided-breathing.ts';

const FRAME_MS = 1000 / 60;
const TWENTY_MINUTES = 20 * 60_000;

afterEach(() => stopGuidedBreathing());

describe('guided breathing clock', () => {
  for (const rate of [4.5, 5, 5.5, 6, 7]) {
    for (const shape of ['even', 'longer-out'] as const) {
      test(`${rate} a minute, ${shape}: every turn lands within a frame for 20 minutes`, () => {
        const start = 1234.5;
        startGuidedBreathing(
          { breathsPerMinute: rate, shape, lengthMs: null },
          start,
        );
        const period = 60_000 / rate;
        const share = shape === 'even' ? 0.5 : LONGER_OUT_INHALE_SHARE;
        const breaths = Math.floor(TWENTY_MINUTES / period);
        for (const n of [0, 1, Math.floor(breaths / 2), breaths - 1]) {
          const turn = start + n * period + share * period;
          const end = start + (n + 1) * period;
          // One frame either side of each turn reads the right half.
          expect(guidedBreathingPhase(turn - FRAME_MS)?.inhale).toBe(true);
          expect(guidedBreathingPhase(turn + FRAME_MS)?.inhale).toBe(false);
          expect(guidedBreathingPhase(end - FRAME_MS)?.inhale).toBe(false);
          expect(guidedBreathingPhase(end + FRAME_MS)?.inhale).toBe(true);
          expect(guidedBreathingPhase(end + FRAME_MS)?.breath).toBe(n + 1);
        }
      });
    }
  }

  test('even shape is symmetric; longer out peaks at 40% and spends 60% falling', () => {
    expect(breathShape(0, 0.5)).toBeCloseTo(-1, 6);
    expect(breathShape(0.25, 0.5)).toBeCloseTo(0, 6);
    expect(breathShape(0.5, 0.5)).toBeCloseTo(1, 6);
    expect(breathShape(0.75, 0.5)).toBeCloseTo(0, 6);
    expect(breathShape(0.4, 0.4)).toBeCloseTo(1, 6);
    expect(breathShape(0.2, 0.4)).toBeCloseTo(0, 6);
    // Half way through the 60% exhale.
    expect(breathShape(0.7, 0.4)).toBeCloseTo(0, 6);
    // Still rising at 35%, already falling at 45%.
    expect(breathShape(0.35, 0.4)).toBeGreaterThan(breathShape(0.3, 0.4));
    expect(breathShape(0.45, 0.4)).toBeLessThan(breathShape(0.4, 0.4));
  });

  test('no session means no guided expansion, so the dial is used', () => {
    expect(guidedBreathingExpansion(1000)).toBeNull();
    expect(guidedBreathingPhase(1000)).toBeNull();
  });

  test('the swell peaks at the turn and a timed session settles to rest', () => {
    const lengthMs = 60_000;
    startGuidedBreathing({ breathsPerMinute: 6, shape: 'even', lengthMs }, 0);
    expect(guidedBreathingExpansion(5000)).toBeCloseTo(
      GUIDED_BREATHING_AMPLITUDE,
      6,
    );
    // Half way through the settle the depth is half; the turn at 55 s
    // lands inside it.
    expect(
      guidedBreathingExpansion(
        lengthMs - GUIDED_BREATHING_SETTLE_MS / 2 - 3000,
      ),
    ).toBeCloseTo(GUIDED_BREATHING_AMPLITUDE, 6);
    expect(guidedBreathingExpansion(55_000)).toBeCloseTo(
      GUIDED_BREATHING_AMPLITUDE *
        (5000 >= GUIDED_BREATHING_SETTLE_MS
          ? 1
          : 5000 / GUIDED_BREATHING_SETTLE_MS),
      6,
    );
    expect(Math.abs(guidedBreathingExpansion(lengthMs) ?? 1)).toBe(0);
    expect(guidedBreathingPhase(lengthMs - 1500)?.remainingMs).toBe(1500);
  });

  test('rates outside 4.5-7 clamp, and junk falls back to 6', () => {
    expect(clampBreathsPerMinute(2)).toBe(4.5);
    expect(clampBreathsPerMinute(12)).toBe(7);
    expect(clampBreathsPerMinute(Number.NaN)).toBe(6);
    expect(clampBreathsPerMinute('6')).toBe(6);
  });
});
