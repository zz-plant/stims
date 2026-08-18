/**
 * Preset engagement telemetry: how long each preset stayed on screen, and
 * whether it was skipped quickly. Feeds catalog curation — dwell/skip rates
 * are the only signal that captures "looks good with music" without a
 * human reviewer in the loop.
 *
 * One beacon per preset change (and one on pagehide), sent fire-and-forget
 * via sendBeacon so it never blocks a transition.
 */
import { resolveOptionalApiUrl } from './optional-api.ts';

/** Below this dwell the event reports as a skip rather than a view. */
const SKIP_THRESHOLD_MS = 8000;
/** Cap what one session sends so a preset-cycling loop isn't a firehose. */
const MAX_TRANSMITS_PER_SESSION = 200;

let activePresetId: string | null = null;
let shownAt = 0;
let transmitted = 0;
let pagehideInstalled = false;

function send(presetId: string, dwellMs: number) {
  if (transmitted >= MAX_TRANSMITS_PER_SESSION) return;
  const endpoint = resolveOptionalApiUrl('/api/telemetry');
  if (!endpoint) return;
  const payload = JSON.stringify({
    event: dwellMs < SKIP_THRESHOLD_MS ? 'preset-skip' : 'preset-dwell',
    presetId,
    dwellMs: Math.round(dwellMs),
  });
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        endpoint,
        new Blob([payload], { type: 'application/json' }),
      );
      transmitted++;
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

/** Call when a preset becomes the visible one. Flushes the previous
 * preset's dwell and starts timing the new one. */
export function notePresetShown(presetId: string) {
  const now = Date.now();
  if (activePresetId && activePresetId !== presetId && shownAt > 0) {
    send(activePresetId, now - shownAt);
  }
  activePresetId = presetId;
  shownAt = now;
  if (!pagehideInstalled && typeof window !== 'undefined') {
    pagehideInstalled = true;
    window.addEventListener('pagehide', () => {
      if (activePresetId && shownAt > 0) {
        send(activePresetId, Date.now() - shownAt);
        activePresetId = null;
      }
    });
  }
}
