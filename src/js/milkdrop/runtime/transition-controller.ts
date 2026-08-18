import type { MilkdropBlendState } from '../types.ts';

/**
 * Single owner for a preset-switch transition.
 *
 * Before this existed the blend was computed from wall clock every frame
 * (`alpha = 1 - (now - start) / duration`), which made transitions jump
 * after a hidden-tab pause, made a mid-blend gate failure (workload spike,
 * quality drop) flicker the cover off and back on while the clock kept
 * running, and let the dissolve finish before the async warp/comp shader
 * swap landed — revealing pass-through styling that then popped to the real
 * look with no cover.
 *
 * The controller advances on *sim time*: each tick derives a clamped delta
 * from the frame timestamps, so pauses freeze the transition mid-dissolve
 * instead of skipping it, and a gated frame suspends progress rather than
 * racing past it. The reveal additionally holds at a floor while the
 * renderer reports the incoming preset is not yet presentable (shader
 * hot-swap still warming), bounded by a hard cap so a wedged swap can never
 * hold the cover forever.
 *
 * Every phase change is recorded in a small ring buffer — the transition
 * event log that debugging kept wanting.
 */

export type MilkdropTransitionPhase = 'idle' | 'blending';

export type MilkdropTransitionEvent = {
  at: number;
  event: string;
  detail?: string;
};

const MAX_TICK_DELTA_SECONDS = 0.1;
const EVENT_LOG_CAPACITY = 32;

/** Alpha floor the reveal holds at while the preset is not presentable:
 * high enough that the incoming style pop stays covered, low enough that
 * the incoming preset is already the dominant image. */
const PRESENTABLE_HOLD_ALPHA = 0.35;

/** Hard cap on how long the presentable hold may extend a blend. */
const PRESENTABLE_HOLD_MAX_SECONDS = 2;

export type MilkdropTransitionController = ReturnType<
  typeof createMilkdropTransitionController
>;

export function createMilkdropTransitionController() {
  let phase: MilkdropTransitionPhase = 'idle';
  let blendState: MilkdropBlendState | null = null;
  let durationSeconds = 0;
  let elapsedSeconds = 0;
  let holdSeconds = 0;
  let lastTickAt: number | null = null;
  const events: MilkdropTransitionEvent[] = [];

  const record = (event: string, detail?: string) => {
    events.push({
      at: typeof performance !== 'undefined' ? performance.now() : 0,
      event,
      detail,
    });
    if (events.length > EVENT_LOG_CAPACITY) {
      events.splice(0, events.length - EVENT_LOG_CAPACITY);
    }
  };

  const settle = (reason: string) => {
    if (phase !== 'idle') {
      record('settled', reason);
    }
    phase = 'idle';
    blendState = null;
    durationSeconds = 0;
    elapsedSeconds = 0;
    holdSeconds = 0;
    lastTickAt = null;
  };

  return {
    /**
     * Starts a blend for a switch that is being applied right now. The
     * caller keeps the blend-vs-cut policy (workload, mode, duration); a
     * cut is `begin(null, ...)`, which settles immediately — one entry
     * point for both so the event log sees every switch.
     */
    begin(nextBlendState: MilkdropBlendState | null, seconds: number) {
      if (nextBlendState && seconds > 0) {
        phase = 'blending';
        blendState = nextBlendState;
        durationSeconds = seconds;
        elapsedSeconds = 0;
        holdSeconds = 0;
        lastTickAt = null;
        record('blend-started', `${seconds.toFixed(2)}s`);
      } else {
        record('cut');
        settle('cut');
      }
    },

    /**
     * Per-frame advance. `now` is the frame timestamp; sim delta is derived
     * and clamped, so a pause contributes at most one clamped step.
     * `canBlendThisFrame` carries the caller's per-frame gates (transition
     * mode, shader quality, workload budget): a gated frame renders without
     * the cover but does NOT advance the clock, so the blend resumes where
     * it left off instead of jumping. `presentable` reports whether the
     * renderer considers the incoming preset fully styled.
     */
    tick({
      now,
      canBlendThisFrame,
      presentable,
    }: {
      now: number;
      canBlendThisFrame: boolean;
      presentable: boolean;
    }): MilkdropBlendState | null {
      if (phase !== 'blending' || !blendState) {
        return null;
      }

      const delta =
        lastTickAt === null
          ? 0
          : Math.min(
              Math.max((now - lastTickAt) / 1000, 0),
              MAX_TICK_DELTA_SECONDS,
            );
      lastTickAt = now;

      if (!canBlendThisFrame) {
        // Suspended: no cover this frame, no progress consumed.
        return null;
      }

      elapsedSeconds += delta;
      let alpha = 1 - elapsedSeconds / durationSeconds;

      if (alpha <= PRESENTABLE_HOLD_ALPHA && !presentable) {
        if (holdSeconds === 0) {
          record('reveal-held', 'shader swap pending');
        }
        holdSeconds += delta;
        if (holdSeconds <= PRESENTABLE_HOLD_MAX_SECONDS) {
          // Freeze at the floor; give elapsed back so release resumes here.
          elapsedSeconds -= delta;
          alpha = Math.max(alpha, PRESENTABLE_HOLD_ALPHA);
          blendState.alpha = alpha;
          return blendState;
        }
        // Hold cap exceeded: reveal anyway rather than wedging the cover.
      } else if (holdSeconds > 0 && presentable) {
        record('reveal-released', `${holdSeconds.toFixed(2)}s held`);
        holdSeconds = 0;
      }

      if (alpha <= 0) {
        settle('completed');
        return null;
      }

      blendState.alpha = alpha;
      return blendState;
    },

    /** Abandons any in-flight blend (dispose, backend fallback). */
    cancel(reason: string) {
      if (phase !== 'idle') {
        record('cancelled', reason);
      }
      settle(reason);
    },

    getPhase: () => phase,
    getEvents: (): readonly MilkdropTransitionEvent[] => events,
  };
}
