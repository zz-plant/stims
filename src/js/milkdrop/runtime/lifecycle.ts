import type { MilkdropFrameState, MilkdropPostVisual } from '../types.ts';

export function shouldAutoAdvancePreset({
  autoplay,
  catalogSize,
  now,
  lastPresetSwitchAt,
  blendDuration,
}: {
  autoplay: boolean;
  catalogSize: number;
  now: number;
  lastPresetSwitchAt: number;
  blendDuration: number;
}) {
  return (
    autoplay &&
    catalogSize > 1 &&
    now - lastPresetSwitchAt > Math.max(30000, blendDuration * 1000 + 6000)
  );
}

/**
 * Lead time before an autoplay advance in which the frame loop asks the
 * navigation controller to plan (pick + prefetch + precompile) the next
 * random preset, so the switch itself is a warm-cache apply.
 */
export const AUTO_ADVANCE_PREPARE_LEAD_MS = 8000;

export function shouldPrepareNextPreset(args: {
  autoplay: boolean;
  catalogSize: number;
  now: number;
  lastPresetSwitchAt: number;
  blendDuration: number;
}) {
  return shouldAutoAdvancePreset({
    ...args,
    now: args.now + AUTO_ADVANCE_PREPARE_LEAD_MS,
  });
}

/**
 * How long an armed advance waits for a downbeat before settling for any
 * beat. Roughly eight beats at 120 BPM — long enough to see a bar line, short
 * enough that the wait is never the thing you notice.
 */
export const AUTO_ADVANCE_BEAT_WINDOW_MS = 4000;

/**
 * Hard cap on the whole wait. Past this the switch fires with no beat at all,
 * so ambient material, silence, and a failed onset detector all degrade to
 * the old wall-clock behaviour instead of pinning the same preset forever.
 */
export const AUTO_ADVANCE_BEAT_TIMEOUT_MS = 8000;

/** Tempo agreement below which bar position is not trustworthy enough to
 * wait for. Without it a misfiring detector invents downbeats and the
 * "quantized" switch lands somewhere arbitrary with extra latency. */
export const AUTO_ADVANCE_TEMPO_CONFIDENCE = 0.6;

/**
 * Turns the dwell predicate into a musical one.
 *
 * `shouldAutoAdvancePreset` answers "has this preset been up long enough",
 * which is a timer, and a timer lands cuts mid-bar — the single biggest
 * reason unattended playback reads as shuffled rather than performed. This
 * gate keeps that predicate as the *arming* condition and then holds the
 * switch until the music offers a place to put it.
 *
 * Firing is free of side effects: the caller still owns the advance, so an
 * in-flight latch, prefetch state, and the transition policy are unchanged.
 * The 8s prepare lead means the incoming preset is already compiled and warm
 * before this gate ever arms, which is what makes waiting for a downbeat
 * affordable — there is nothing left to load when the moment arrives.
 */
export function createAutoAdvanceGate({
  beatWindowMs = AUTO_ADVANCE_BEAT_WINDOW_MS,
  timeoutMs = AUTO_ADVANCE_BEAT_TIMEOUT_MS,
}: {
  beatWindowMs?: number;
  timeoutMs?: number;
} = {}) {
  let armedAt: number | null = null;

  return {
    /**
     * Call every frame. Returns true on the single frame the advance should
     * fire. `due` is the dwell predicate; `beat` is true only on the frame a
     * beat is detected (the caller supplies the rising edge); `downbeat` and
     * `tempoConfident` come from the beat clock.
     */
    update({
      due,
      now,
      beat,
      downbeat,
      tempoConfident,
    }: {
      due: boolean;
      now: number;
      beat: boolean;
      downbeat: boolean;
      tempoConfident: boolean;
    }): boolean {
      if (!due) {
        armedAt = null;
        return false;
      }

      if (armedAt === null) {
        armedAt = now;
      }
      const waited = now - armedAt;

      if (waited >= timeoutMs) {
        armedAt = null;
        return true;
      }

      if (!beat) {
        return false;
      }

      // Inside the window, hold out for a bar line — but only while the
      // tempo estimate is worth holding out for. With no confident tempo
      // there is no bar to wait for, so the next beat is the best moment
      // available and waiting longer would only add latency.
      const wanted = !tempoConfident || downbeat || waited >= beatWindowMs;
      if (wanted) {
        armedAt = null;
        return true;
      }
      return false;
    },

    /** True while a switch is due and waiting for its moment. */
    isArmed: () => armedAt !== null,

    /** Drops any pending arm — used when the caller switches for another
     * reason (manual next, failure recovery) and the wait is now moot. */
    reset() {
      armedAt = null;
    },
  };
}

// Per-frame blend alpha lives in runtime/transition-controller.ts now: the
// wall-clock recompute that used to live here jumped after hidden-tab pauses
// and kept running through gated frames. The per-frame gates (transition
// mode, shader quality, workload) moved to the frame loop's tick call.

type RenderFrameStatePolicyArgs = {
  frameState: MilkdropFrameState;
  shaderQuality: 'low' | 'balanced' | 'high';
  lowQualityPostOverride: Pick<
    MilkdropPostVisual,
    'shaderEnabled' | 'videoEchoEnabled'
  >;
};

export function createRenderFrameStateBuilder() {
  let output: MilkdropFrameState | null = null;
  let outputPost: MilkdropPostVisual | null = null;
  let outputPostprocessingProfile: NonNullable<
    MilkdropPostVisual['postprocessingProfile']
  > | null = null;
  let outputGpuGeometry: MilkdropFrameState['gpuGeometry'] | null = null;
  let outputParticleField: NonNullable<
    MilkdropFrameState['gpuGeometry']['particleField']
  > | null = null;

  return ({
    frameState,
    shaderQuality,
    lowQualityPostOverride,
  }: RenderFrameStatePolicyArgs) => {
    if (
      shaderQuality !== 'low' ||
      (!frameState.post.shaderEnabled && !frameState.post.videoEchoEnabled)
    ) {
      return frameState;
    }

    // Direct warp/comp programs are the preset's painter, not a decorative
    // post pass: stripping them leaves those presets as a black screen with a
    // bare wave line — "lighter graphics" must never mean "no graphics". Keep
    // the shader stage for them (the low step's feedback-resolution multiplier
    // still shrinks its pixel cost) and shed only the true extras.
    const shaderStageIsThePainter =
      (frameState.post.shaderPrograms?.warp ?? null) !== null ||
      (frameState.post.shaderPrograms?.comp ?? null) !== null;

    output ??= { ...frameState };
    outputPost ??= { ...frameState.post };
    outputGpuGeometry ??= { ...frameState.gpuGeometry };

    Object.assign(output, frameState);
    // Optional frame payloads can disappear from one frame to the next. Set
    // them explicitly so reusable storage never resurrects an old interaction.
    output.warpField = frameState.warpField;
    output.interaction = frameState.interaction;

    Object.assign(outputPost, frameState.post, lowQualityPostOverride, {
      shaderEnabled: shaderStageIsThePainter,
      videoEchoEnabled: false,
    });
    const postprocessingProfile = frameState.post.postprocessingProfile;
    if (postprocessingProfile) {
      outputPostprocessingProfile ??= { ...postprocessingProfile };
      Object.assign(outputPostprocessingProfile, postprocessingProfile, {
        enabled: false,
      });
      outputPost.postprocessingProfile = outputPostprocessingProfile;
    } else {
      outputPost.postprocessingProfile = postprocessingProfile;
    }

    Object.assign(outputGpuGeometry, frameState.gpuGeometry);
    const particleField = frameState.gpuGeometry.particleField;
    if (particleField) {
      outputParticleField ??= { ...particleField };
      Object.assign(outputParticleField, particleField, { enabled: false });
      outputGpuGeometry.particleField = outputParticleField;
    } else {
      outputGpuGeometry.particleField = particleField;
    }

    output.post = outputPost;
    output.gpuGeometry = outputGpuGeometry;
    return output;
  };
}

export function buildRenderFrameState(args: RenderFrameStatePolicyArgs) {
  return createRenderFrameStateBuilder()(args);
}
