/**
 * Frame-rate ceiling for animation loops.
 *
 * The loop still ticks on every vsync — browsers give no way to request a
 * slower rAF cadence — but a gated tick returns before any simulation or draw
 * work. Practically all of the energy is in that skipped work, so a 30Hz gate
 * on a 60Hz panel really does approach half the GPU draw.
 */

/**
 * How early a frame may arrive and still count as on-schedule.
 *
 * Without this the gate is pathological at exactly the rates people use. A 30Hz
 * cap on a 60Hz display wants frames 33.33ms apart, but vsyncs land at 16.67ms
 * multiples: any jitter that puts a tick a hair before the deadline pushes the
 * frame to the *next* vsync, turning a 30fps cap into 20fps. 4ms covers rAF
 * jitter and a full 240Hz vsync interval while staying well under the 8.33ms
 * gap that would let a 120Hz display double its rate.
 */
export const FRAME_GATE_TOLERANCE_MS = 4;

export type FrameGate = {
  /**
   * True when this tick should do its work. Call exactly once per tick — it
   * advances the schedule as a side effect.
   */
  shouldRenderFrame: (nowMs: number) => boolean;
  reset: () => void;
};

/**
 * @param getFrameCapHz Read every tick so the cap can change mid-session
 *   (unplugging a laptop, toggling the setting). `null` or a non-positive value
 *   means uncapped.
 */
export function createFrameGate(getFrameCapHz: () => number | null): FrameGate {
  let nextFrameAtMs: number | null = null;
  let activeCapHz: number | null = null;

  const reset = () => {
    nextFrameAtMs = null;
    activeCapHz = null;
  };

  return {
    shouldRenderFrame(nowMs: number): boolean {
      const capHz = getFrameCapHz();
      if (capHz === null || !Number.isFinite(capHz) || capHz <= 0) {
        reset();
        return true;
      }

      const intervalMs = 1000 / capHz;

      // First gated frame, or the cap just changed: render now and start the
      // schedule from here rather than honouring a deadline set at another rate.
      if (nextFrameAtMs === null || capHz !== activeCapHz) {
        activeCapHz = capHz;
        nextFrameAtMs = nowMs + intervalMs;
        return true;
      }

      if (nowMs < nextFrameAtMs - FRAME_GATE_TOLERANCE_MS) {
        return false;
      }

      // Advance from the deadline, not from `now`, so rounding does not make the
      // effective rate drift below the cap over a long session.
      nextFrameAtMs += intervalMs;
      // Unless we fell far behind (tab wake, long GC, a stalled preset compile),
      // in which case resync instead of firing every missed frame back to back.
      if (nextFrameAtMs <= nowMs) {
        nextFrameAtMs = nowMs + intervalMs;
      }
      return true;
    },
    reset,
  };
}
