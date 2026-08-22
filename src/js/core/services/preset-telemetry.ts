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

/**
 * Counts how often a preset's shader text is executed as authored versus
 * approximated, per backend.
 *
 * "How often are we approximating in the wild?" was unanswerable: the
 * compiler has decided this per preset per backend for months, and nothing
 * transmitted it. The answer matters because the failure is invisible to the
 * viewer — an approximated preset still renders a plausible frame — so the
 * only way it gets noticed is by counting.
 *
 * Cardinality: the mode rides in the event name and the backend in the
 * `renderer` blob, giving at most six event/backend combinations across the
 * whole dataset. Nothing identifying is added — presetId is a bundled catalog
 * slug, already sent by the dwell events.
 *
 * `'none'` is not transmitted. A preset with no shader text has nothing to
 * approximate, so it is neither numerator nor denominator; the rate this
 * answers is approximated-loads over shader-bearing loads, and counting
 * shader-free presets in the denominator would dilute it into meaninglessness
 * (they are ~31% of the bundled corpus).
 */
export function noteShaderExecution(
  presetId: string,
  mode: 'none' | 'direct' | 'translated' | 'unsupported' | null,
  backend: 'webgl' | 'webgpu',
) {
  if (mode === null || mode === 'none') return;
  if (transmitted >= MAX_TRANSMITS_PER_SESSION) return;
  const endpoint = resolveOptionalApiUrl('/api/telemetry');
  if (!endpoint) return;
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        endpoint,
        new Blob(
          [
            JSON.stringify({
              // Event name carries the mode so it is queryable through the
              // dataset's only index, the same trick noteSubstitution uses.
              event: `shader-exec-${mode}`,
              // The contract's renderer enum is the transport for "which
              // backend decided this"; webgl2 is the spelling the rest of the
              // dataset uses for the WebGL path.
              renderer: backend === 'webgpu' ? 'webgpu' : 'webgl2',
              presetId,
            }),
          ],
          { type: 'application/json' },
        ),
      );
      transmitted++;
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

/**
 * Records that the app substituted something for what the visitor asked for:
 * the fallback preset replaced a deep link, the renderer fell back to WebGL,
 * or a requested preset failed to load outright. Substitutions are the
 * failures users never report — they don't know anything went wrong — so
 * without this signal their frequency in production is unknowable.
 */
export function noteSubstitution(
  kind: 'fallback-preset' | 'backend-fallback' | 'preset-load-failed',
  detail: string,
) {
  if (transmitted >= MAX_TRANSMITS_PER_SESSION) return;
  const endpoint = resolveOptionalApiUrl('/api/telemetry');
  if (!endpoint) return;
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        endpoint,
        new Blob(
          [
            // Field names match what /api/telemetry writes into Analytics
            // Engine blobs: event, error. The kind rides in the event name so
            // it is queryable via the event index.
            JSON.stringify({
              event: `substitution-${kind}`,
              error: detail.slice(0, 200),
            }),
          ],
          { type: 'application/json' },
        ),
      );
      transmitted++;
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}
