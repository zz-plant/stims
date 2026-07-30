import { useEffect } from 'react';
import { updateAgentTelemetry } from '../agent-bridge.ts';

const REPORT_INTERVAL_MS = 500;
/** Matches the smoothing used by the adaptive quality controller. */
const EMA_ALPHA = 0.18;

/**
 * Samples presented animation frames and publishes the result as the agent
 * telemetry `fps` field.
 *
 * The renderer's own `adaptiveQuality` timings are not usable here: its
 * `averageFrameMs` measures CPU work inside a frame rather than the frame
 * period, and its `averageCadenceMs` reads several times longer than the
 * interval at which frames are actually presented. On a Galaxy S22 running a
 * preset at a verified ~50fps they reported ~4.6fps and ~14.7fps respectively.
 * Counting animation frames here is the one measurement that is unambiguous.
 *
 * Only runs in agent mode: this field exists for automated harnesses, and a
 * permanent extra rAF loop is not worth the battery on a handheld.
 */
export function useAgentFrameRate(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    let rafId = 0;
    let lastFrameAt = performance.now();
    let lastReportAt = lastFrameAt;
    let emaFrameMs: number | null = null;
    let disposed = false;

    const tick = (now: number) => {
      if (disposed) {
        return;
      }

      const deltaMs = now - lastFrameAt;
      lastFrameAt = now;

      // Ignore the long gap produced when the tab is backgrounded and resumed.
      if (deltaMs > 0 && deltaMs < 1000) {
        emaFrameMs =
          emaFrameMs === null
            ? deltaMs
            : emaFrameMs + (deltaMs - emaFrameMs) * EMA_ALPHA;
      }

      if (now - lastReportAt >= REPORT_INTERVAL_MS && emaFrameMs !== null) {
        lastReportAt = now;
        updateAgentTelemetry({
          fps: Math.round((1000 / emaFrameMs) * 10) / 10,
        });
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}
