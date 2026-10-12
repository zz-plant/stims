/**
 * Pre-fade pipeline warm-up gate — the scheduling half of killing the
 * transition-start spike on preset switches.
 *
 * On a headed hardware WebGPU tab, every blend's first frames measured
 * 258–433ms single frames while the incoming preset's GPU pipelines compiled
 * (see docs/FRONTEND_PERFORMANCE_BOTTLENECKS.md, "Deliberate boundaries"
 * pending verification). The adapter's `warmupPreset` seam moves that
 * compilation before the fade; this module owns everything around it:
 *
 * - when a switch may warm at all (WebGPU, non-agent, non-preview, blend
 *   wanted) — everything else keeps today's synchronous switch, unchanged;
 * - one shared warm-up per switch, so the two arrivals of one switch (the
 *   session subscriber and the navigation controller) cannot race each
 *   other into applying cold pipelines;
 * - a hard deadline, so a wedged or slow compile delays the switch by a
 *   bounded amount and then falls back to starting the fade exactly as it
 *   does today;
 * - a currency check, so a switch superseded during its warm-up window (a
 *   rapid second switch) never applies out of order.
 *
 * The blend itself is untouched: the same transition controller, the same
 * workload gates, the same picture — only the moment the fade begins moves.
 */

import type {
  MilkdropCompiledPreset,
  MilkdropRendererAdapter,
} from '../types.ts';

export type MilkdropPresetPipelineWarmupGate = (
  compiled: MilkdropCompiledPreset,
) => Promise<boolean> | null;

/**
 * How long a preset switch may hold the fade back while the incoming
 * preset's WebGPU pipelines pre-warm.
 *
 * The measured cost this bounds is real but finite—single frames of
 * 258–433ms at blend start on a 120Hz hardware tab—which the warm-up turns
 * into a pipeline-cache hit when it completes. Measured hardware warm-up
 * durations (2026-10-12, M-series, real WebGPU, incoming-preset composite
 * and field materials): 236ms on a light comp-shader preset, 855ms on a
 * mid-weight one, 1122ms and 1611ms on the heaviest switched to; the first
 * 300ms
 * deadline timed out on the heavy tail and fell back to exactly the spikes
 * it exists to remove. 1500ms misses only the rare 1.6s-class compile, and
 * a deadline miss degrades gracefully: 1500ms of the work is already paid,
 * so the measured fallback hitch was 50–68ms, not the 258–1008ms of a
 * cold build. The wait is invisible in the way that matters — the old
 * preset keeps playing until the fade starts — and the bound stays well
 * under the transition controller's presentable-hold cap, past which a
 * wedged compile falls back to today's behavior, cold pipelines and all.
 */
export const PRESET_PIPELINE_WARMUP_DEADLINE_MS = 1500;

/**
 * Builds the gate. `wantsBlendTransition` should answer the question
 * "would this switch actually crossfade?" — the live preference (transition
 * mode plus duration, and any armed manual crossfade) AND the blend gate's
 * decision for the current frame (see `wouldMilkdropSwitchBlendNow`).
 * A switch that asked for a cut asked for immediacy, and one the blend gate
 * is about to refuse gains nothing from warming: in both cases the up-to-1.5s
 * hold would be pure input latency.
 */
export function createMilkdropPresetPipelineWarmupGate({
  getAdapter,
  getBackend,
  isAgentMode,
  isPreviewMode,
  wantsBlendTransition,
  deadlineMs = PRESET_PIPELINE_WARMUP_DEADLINE_MS,
}: {
  getAdapter: () => MilkdropRendererAdapter | null;
  getBackend: () => 'webgl' | 'webgpu';
  isAgentMode: () => boolean;
  isPreviewMode: () => boolean;
  wantsBlendTransition: () => boolean;
  /** Overridable so tests can expire the deadline deterministically. */
  deadlineMs?: number;
}): MilkdropPresetPipelineWarmupGate {
  /** The warm-up armed for the pending or last switch. Single slot: a newer
   * switch's warm-up replaces it, both arrivals of one switch share it, and
   * it deliberately outlives resolution — the navigation controller reaches
   * the gate after the session subscriber did (across its own async steps),
   * and a later arrival joining an already-settled warm-up must resolve
   * immediately rather than arm a second, redundant warm-up for the same
   * preset. */
  let pending: { presetId: string; done: Promise<boolean> } | null = null;

  return (compiled) => {
    const adapter = getAdapter();
    const warm = adapter?.warmupPreset;
    if (
      !adapter ||
      !warm ||
      getBackend() !== 'webgpu' ||
      isAgentMode() ||
      isPreviewMode() ||
      !wantsBlendTransition()
    ) {
      return null;
    }
    if (pending?.presetId === compiled.source.id) {
      return pending.done;
    }
    const done = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (warmed: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(deadlineTimer);
        resolve(warmed);
      };
      const deadlineTimer = setTimeout(() => finish(false), deadlineMs);
      // The warm-up never rejects into the switch: a failed compile falls
      // back to today's synchronous first-frame compilation, which is the
      // old behavior rather than a new failure.
      Promise.resolve(warm.call(adapter, compiled)).then(
        () => finish(true),
        () => finish(false),
      );
    });
    pending = { presetId: compiled.source.id, done };
    return done;
  };
}

/**
 * Runs one preset switch through the gate: apply synchronously when no
 * warm-up applies, or once the warm-up resolves — and only if the switch is
 * still the current one. A switch superseded during its warm-up window (a
 * rapid second switch published a newer session state) never applies: its
 * continuation would yank the stage back to a preset the user already left.
 */
export function scheduleMilkdropPresetSwitchThroughWarmup({
  compiled,
  gate,
  isSwitchStillCurrent,
  apply,
}: {
  compiled: MilkdropCompiledPreset;
  gate: MilkdropPresetPipelineWarmupGate;
  /** False once a newer selection superseded this switch (or the runtime
   * went away); re-checked when the warm-up resolves, not at schedule time. */
  isSwitchStillCurrent: () => boolean;
  /** Everything the switch does once it proceeds: blend decision, apply,
   * catalog side effects. */
  apply: () => void;
}): void {
  const warmed = gate(compiled);
  if (warmed === null) {
    if (isSwitchStillCurrent()) {
      apply();
    }
    return;
  }
  void warmed.then(() => {
    if (isSwitchStillCurrent()) {
      apply();
    }
  });
}
