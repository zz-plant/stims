/**
 * Preset engagement telemetry: how long each preset stayed on screen, and
 * whether it was skipped quickly. Feeds catalog curation — dwell/skip rates
 * are the only signal that captures "looks good with music" without a
 * human reviewer in the loop.
 *
 * One beacon per preset change (and one on pagehide), sent fire-and-forget
 * via sendBeacon so it never blocks a transition.
 */
import type { TelemetryEvent } from '../edge-contracts.ts';
import {
  readTelemetryContext,
  resolveTelemetryEndpoint,
} from './telemetry-context.ts';

/** Below this dwell the event reports as a skip rather than a view. */
const SKIP_THRESHOLD_MS = 8000;
/** Cap what one session sends so a preset-cycling loop isn't a firehose. */
const MAX_TRANSMITS_PER_SESSION = 200;

let activePresetId: string | null = null;
let shownAt = 0;
let transmitted = 0;
let pagehideInstalled = false;

/**
 * The funnel's first-edit step, three ways. `first-edit-applied` keeps its
 * original meaning — the "Add a slow spin" button in the first-edit guide —
 * so the first clean month of post-#1377 data stays comparable. The two
 * finer-grained events count what that button never could: the first code
 * edit the visitor typed into the editor (`first-code-edit-applied`) and
 * the first Tune control they committed (`first-tune-edit-applied`). Both
 * fire once per page load (the guards live in src/js/frontend/first-edit.ts,
 * where the first-edit semantics already lived).
 */
export type GrowthTelemetryEvent =
  | 'share-shared'
  | 'share-copied'
  | 'share-cancelled'
  | 'share-unavailable'
  | 'embed-code-copied'
  | 'landing'
  | 'embed-landing'
  | 'discovery-landing'
  | 'audio-started'
  | 'demo-started'
  | 'editor-opened'
  | 'first-edit-applied'
  | 'first-code-edit-applied'
  | 'first-tune-edit-applied'
  | 'github-clicked'
  | 'video-saved';

let growthTransmitted = 0;
const MAX_GROWTH_TRANSMITS_PER_SESSION = 50;

/** Records the small set of acquisition/conversion events needed to evaluate
 * shared links, embed arrivals, discovery routes, and audible starts. */
export function noteGrowthEvent(
  event: GrowthTelemetryEvent,
  presetId?: string,
) {
  if (growthTransmitted >= MAX_GROWTH_TRANSMITS_PER_SESSION) return;
  const endpoint = resolveTelemetryEndpoint();
  if (!endpoint) return;
  const payload: { event: string; presetId?: string } = {
    event: `growth-${event}`,
    ...readTelemetryContext(),
  };
  if (presetId) payload.presetId = presetId.slice(0, 64);
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        endpoint,
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
      );
      growthTransmitted++;
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

/** Test-only reset; harmless in production and avoids cross-test counters. */
export function resetGrowthTelemetryForTests() {
  growthTransmitted = 0;
}

/** Rendered frames, and the wall-clock time they spanned, since the active
 * preset was shown. Below this much rendered time the rate is noise. */
const MIN_FPS_SPAN_MS = 1000;
let framesSinceShown = 0;
let frameSpanMsSinceShown = 0;
let activeRenderer: 'webgpu' | 'webgl2' | undefined;

/**
 * What one frame cost and what it ran at, so a dwell beacon can say why its
 * frame rate was low and not only that it was. Each field is optional because
 * each can go unmeasured on a given frame: GPU timestamps resolve late or not
 * at all, and a power-saver cap withholds cadence.
 */
export type PresetFrameDetail = {
  simulationMs?: number;
  renderMs?: number;
  gpuMs?: number;
  cadenceMs?: number;
  qualityStep?: TelemetryEvent['qualityStep'];
  renderScale?: number;
};

type RunningAverage = { sum: number; count: number };
const frameAverages = {
  simulationMs: { sum: 0, count: 0 } as RunningAverage,
  renderMs: { sum: 0, count: 0 } as RunningAverage,
  gpuMs: { sum: 0, count: 0 } as RunningAverage,
  cadenceMs: { sum: 0, count: 0 } as RunningAverage,
};
const FRAME_AVERAGE_FIELDS = [
  'simulationMs',
  'renderMs',
  'gpuMs',
  'cadenceMs',
] as const;
let lastQualityStep: TelemetryEvent['qualityStep'];
let lastRenderScale: number | undefined;

function resetFrameDetail() {
  for (const field of FRAME_AVERAGE_FIELDS) {
    frameAverages[field].sum = 0;
    frameAverages[field].count = 0;
  }
  lastQualityStep = undefined;
  lastRenderScale = undefined;
}

function frameDetailFields(): Partial<TelemetryEvent> {
  const fields: Partial<TelemetryEvent> = {};
  // Below this much rendered time the rate is noise, and so are the costs.
  if (frameSpanMsSinceShown < MIN_FPS_SPAN_MS) return fields;
  for (const field of FRAME_AVERAGE_FIELDS) {
    const { sum, count } = frameAverages[field];
    if (count > 0) fields[field] = Math.round((sum * 100) / count) / 100;
  }
  if (lastQualityStep !== undefined) fields.qualityStep = lastQualityStep;
  if (lastRenderScale !== undefined) {
    fields.renderScale = Math.round(lastRenderScale * 1000) / 1000;
  }
  return fields;
}

type FlashGuardProbe = () => {
  enabled: boolean;
  offThread: boolean;
};
let flashGuardProbe: FlashGuardProbe | null = null;

/**
 * Lets the flash governor report its state on dwell beacons. A probe rather
 * than a pushed value: the visitor can toggle Reduce flashing at any time, and
 * the sampler falls back to the main thread on its own.
 */
export function setPresetFlashGuardProbe(probe: FlashGuardProbe | null) {
  flashGuardProbe = probe;
}

function flashGuardFields(): Partial<TelemetryEvent> {
  if (!flashGuardProbe) return {};
  const { enabled, offThread } = flashGuardProbe();
  if (!enabled) return { flashGuard: 'off' };
  return { flashGuard: 'on', flashSampler: offThread ? 'worker' : 'main' };
}

/**
 * Call once per rendered frame with the time since the previous one, so each
 * dwell beacon carries the frame rate the visitor actually saw on that
 * preset. Every preset-dwell row recorded fps=0 before this existed, so how
 * Stims performs on real hardware was unknowable from production data.
 *
 * Summing frame gaps rather than dividing by the dwell keeps paused and
 * hidden time out of the rate: the frame drivers stop then, and the first
 * frame after resuming reports a clamped gap.
 */
export function notePresetFrame(deltaMs: number, detail?: PresetFrameDetail) {
  framesSinceShown += 1;
  frameSpanMsSinceShown += deltaMs;
  if (!detail) return;
  for (const field of FRAME_AVERAGE_FIELDS) {
    const value = detail[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      frameAverages[field].sum += value;
      frameAverages[field].count += 1;
    }
  }
  if (detail.qualityStep !== undefined) lastQualityStep = detail.qualityStep;
  if (detail.renderScale !== undefined) lastRenderScale = detail.renderScale;
}

function send(presetId: string, dwellMs: number) {
  if (transmitted >= MAX_TRANSMITS_PER_SESSION) return;
  const endpoint = resolveTelemetryEndpoint();
  if (!endpoint) return;
  const fps =
    frameSpanMsSinceShown >= MIN_FPS_SPAN_MS
      ? Math.round((framesSinceShown * 10000) / frameSpanMsSinceShown) / 10
      : undefined;
  const payload = JSON.stringify({
    event: dwellMs < SKIP_THRESHOLD_MS ? 'preset-skip' : 'preset-dwell',
    presetId,
    dwellMs: Math.round(dwellMs),
    renderer: activeRenderer,
    fps,
    ...frameDetailFields(),
    ...flashGuardFields(),
    ...readTelemetryContext(),
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

// webgl2 is the spelling the rest of the dataset uses for the WebGL path.
function telemetryRenderer(backend?: 'webgl' | 'webgpu') {
  if (backend === undefined) return undefined;
  return backend === 'webgpu' ? 'webgpu' : 'webgl2';
}

/**
 * Call when the renderer mounts or falls back. The first-run preset starts its
 * clock when startup settles, which can be before the renderer has mounted and
 * while the runtime still reports its default of WebGL.
 */
export function notePresetBackend(backend: 'webgl' | 'webgpu') {
  activeRenderer = telemetryRenderer(backend);
}

/** Call when a preset becomes the visible one. Flushes the previous
 * preset's dwell and starts timing the new one. */
export function notePresetShown(
  presetId: string,
  backend?: 'webgl' | 'webgpu',
) {
  const now = Date.now();
  if (activePresetId && activePresetId !== presetId && shownAt > 0) {
    send(activePresetId, now - shownAt);
  }
  activePresetId = presetId;
  shownAt = now;
  framesSinceShown = 0;
  frameSpanMsSinceShown = 0;
  resetFrameDetail();
  activeRenderer = telemetryRenderer(backend);
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
  const endpoint = resolveTelemetryEndpoint();
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
              ...readTelemetryContext(),
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
  const endpoint = resolveTelemetryEndpoint();
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
              ...readTelemetryContext(),
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
