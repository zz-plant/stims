/**
 * Post-Effects & Video Echo Builder — evaluates dynamic post-processing profiles, motion blur damping,
 * film grain, scanlines, and video echo orientation matrices for the MilkDrop simulation VM.
 */

import {
  evaluateMilkdropShaderControlExpressions,
  evaluateMilkdropShaderControlProgram,
} from 'milkdrop-toolchain/src/compiler.ts';
import { walkMilkdropExpression } from 'milkdrop-toolchain/src/expression.ts';
import { resolveMilkdropIdentifier } from 'milkdrop-toolchain/src/field-normalization.ts';
import { resolveShaderExecutionMode } from 'milkdrop-toolchain/src/shader-execution-mode.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropExpressionNode,
  MilkdropPostprocessingProfile,
  MilkdropPostVisual,
  MilkdropRuntimeSignals,
  MilkdropShaderControlExpressions,
} from '../types';
import {
  clamp,
  type MutableState,
  normalizeVideoEchoOrientation,
} from './shared';

type ShaderControls = MilkdropPostVisual['shaderControls'];

/**
 * Result of the shader-control program when a preset carries no warp/comp
 * shader text. `extractShaderControls` returns fresh defaults without reading
 * `env` in that case, so the merged output is a constant — but one that the
 * runtime is allowed to mutate (see `runtime/interaction-response.ts`, which
 * writes offsetX/offsetY/rotation/zoom/warpScale back into it).
 *
 * Seeded from the real code path rather than hand-written so it cannot drift
 * from `mergeShaderControlAnalysis`, then cloned per frame so each frame still
 * gets its own mutable object.
 */
let neutralShaderControls: ShaderControls | null = null;

function cloneShaderControls(source: ShaderControls): ShaderControls {
  return {
    ...source,
    colorScale: { ...source.colorScale },
    tint: { ...source.tint },
    textureLayer: { ...source.textureLayer },
    warpTexture: { ...source.warpTexture },
  };
}

function buildNeutralShaderControls(): ShaderControls {
  neutralShaderControls ??= evaluateMilkdropShaderControlProgram({
    warp: null,
    comp: null,
    env: {},
  });
  return cloneShaderControls(neutralShaderControls);
}

const ALLOWED_GLOBAL_IDENTIFIERS = new Set(['pi', 'e']);

function hasUnknownIdentifier(
  expression: MilkdropExpressionNode | null | undefined,
  env: Record<string, number>,
): boolean {
  if (!expression) {
    return false;
  }
  let unknown = false;
  walkMilkdropExpression(expression, (node) => {
    if (node.type === 'identifier') {
      const normalized = node.name.toLowerCase();
      if (
        !ALLOWED_GLOBAL_IDENTIFIERS.has(normalized) &&
        resolveMilkdropIdentifier(env, node.name) === undefined
      ) {
        unknown = true;
      }
    }
  });
  return unknown;
}

function* iterShaderControlExpressions(
  expressions: MilkdropShaderControlExpressions,
): Generator<MilkdropExpressionNode | null> {
  yield expressions.warpScale;
  yield expressions.offsetX;
  yield expressions.offsetY;
  yield expressions.rotation;
  yield expressions.zoom;
  yield expressions.saturation;
  yield expressions.contrast;
  yield expressions.colorScale.r;
  yield expressions.colorScale.g;
  yield expressions.colorScale.b;
  yield expressions.hueShift;
  yield expressions.mixAlpha;
  yield expressions.brightenBoost;
  yield expressions.invertBoost;
  yield expressions.solarizeBoost;
  yield expressions.tint.r;
  yield expressions.tint.g;
  yield expressions.tint.b;
  yield expressions.textureLayer.amount;
  yield expressions.textureLayer.scaleX;
  yield expressions.textureLayer.scaleY;
  yield expressions.textureLayer.offsetX;
  yield expressions.textureLayer.offsetY;
  yield expressions.textureLayer.volumeSliceZ;
  yield expressions.warpTexture.amount;
  yield expressions.warpTexture.scaleX;
  yield expressions.warpTexture.scaleY;
  yield expressions.warpTexture.offsetX;
  yield expressions.warpTexture.offsetY;
  yield expressions.warpTexture.volumeSliceZ;
}

function controlExpressionsNeedProgramEvaluation(
  expressions: MilkdropShaderControlExpressions,
  env: Record<string, number>,
): boolean {
  for (const expression of iterShaderControlExpressions(expressions)) {
    if (hasUnknownIdentifier(expression, env)) {
      return true;
    }
  }
  return false;
}

export function buildShaderControls({
  preset,
  signals,
  createEnv,
  backend,
}: {
  preset: MilkdropCompiledPreset;
  signals: MilkdropRuntimeSignals;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
  ) => MutableState;
  backend: 'webgl' | 'webgpu';
}) {
  const shaderText = preset.ir.shaderText;
  let { warp, comp, controls, controlExpressions } = shaderText;
  // Runs every frame. Presets without pixel-shader sections (every bundled
  // MilkDrop 1.x preset) would otherwise rebuild ~15 throwaway objects per
  // frame to arrive at a fixed answer, and pay for an env snapshot the null
  // path never reads.
  if (warp === null && comp === null) {
    return buildNeutralShaderControls();
  }
  // The controls are a uniform-only stand-in for shader text this backend
  // cannot run. A stage whose program runs as written and carries every
  // statement already draws what its controls describe, so they would land a
  // second time: a warp body's `uv / 0.9` came back as a zoom that replaced
  // the preset's own and fed the shader's input coordinate, rendering
  // cotc-flexi-stahlregen-jewelry-tiles solid white. A program that still
  // `requiresControlFallback` leaves part of its text to the controls, so
  // that stage keeps them.
  if (resolveShaderExecutionMode(preset, backend) === 'direct') {
    const covers = (program: typeof shaderText.warpProgram) =>
      program !== null && !program.execution.requiresControlFallback;
    const warpCovered = covers(shaderText.warpProgram);
    const compCovered = covers(shaderText.compProgram);
    if ((warpCovered || warp === null) && (compCovered || comp === null)) {
      return buildNeutralShaderControls();
    }
    const remaining = warpCovered
      ? shaderText.stageControls?.comp
      : compCovered
        ? shaderText.stageControls?.warp
        : undefined;
    if (remaining) {
      warp = warpCovered ? null : warp;
      comp = compCovered ? null : comp;
      controls = remaining.controls;
      controlExpressions = remaining.expressions;
    }
  }

  const env = createEnv(signals);

  // Cached scalar expressions can't represent shader temp variables (e.g.
  // `const pulse = beat_pulse * 0.4; mix = pulse`). Fall back to the full
  // per-frame program evaluator when any expression references an identifier
  // that isn't known in the runtime environment.
  if (controlExpressionsNeedProgramEvaluation(controlExpressions, env)) {
    return evaluateMilkdropShaderControlProgram({
      warp,
      comp,
      env,
    });
  }

  // Use the cached control expressions instead of re-parsing the shader
  // text every frame. The AST is built at compile time in ir.ts.
  return evaluateMilkdropShaderControlExpressions({
    controls,
    expressions: controlExpressions,
    env,
  });
}

export function deriveMilkdropPostprocessingProfile({
  post,
  signals,
}: {
  post: MilkdropPostVisual;
  signals: MilkdropRuntimeSignals;
}): MilkdropPostprocessingProfile {
  const audioDrive = clamp(
    Math.max(
      signals.weightedEnergy ?? 0,
      signals.rms ?? 0,
      signals.beatPulse ?? 0,
      signals.bassAtt ?? 0,
      signals.midAtt ?? 0,
      signals.trebleAtt ?? 0,
    ),
    0,
    1,
  );
  const visualDrive = clamp(
    Math.max(
      post.shaderEnabled ? 0.08 : 0,
      post.videoEchoEnabled ? (post.videoEchoAlpha ?? 0) : 0,
      post.brighten ? 0.18 : 0,
      post.darken ? 0.14 : 0,
      post.darkenCenter ? 0.12 : 0,
      post.solarize ? 0.16 : 0,
      post.invert ? 0.14 : 0,
      Math.abs((post.gammaAdj ?? 1) - 1) * 0.55,
      Math.abs(post.shaderControls.hueShift ?? 0) * 0.3,
      Math.abs(post.shaderControls.mixAlpha ?? 0) * 0.5,
      (post.shaderControls.brightenBoost ?? 0) * 0.45,
      (post.shaderControls.invertBoost ?? 0) * 0.4,
      (post.shaderControls.solarizeBoost ?? 0) * 0.4,
      Math.abs((post.shaderControls.saturation ?? 1) - 1) * 0.2,
      Math.abs((post.shaderControls.contrast ?? 1) - 1) * 0.2,
      Math.abs(post.shaderControls.warpScale ?? 0) * 0.12,
      Math.abs(post.shaderControls.offsetX ?? 0) * 0.5 +
        Math.abs(post.shaderControls.offsetY ?? 0) * 0.5,
    ),
    0,
    1,
  );
  const bloomStrength = clamp(
    audioDrive > 0 || visualDrive > 0
      ? 0.18 + audioDrive * 1.15 + visualDrive * 0.35
      : 0,
    0,
    2,
  );
  const bloomRadius = clamp(
    0.22 + audioDrive * 0.2 + visualDrive * 0.12,
    0.15,
    0.95,
  );
  const bloomThreshold = clamp(
    0.9 - audioDrive * 0.18 - visualDrive * 0.1,
    0.6,
    0.98,
  );
  const filmNoise =
    visualDrive > 0.12 || audioDrive > 0.2
      ? clamp(0.01 + audioDrive * 0.12 + visualDrive * 0.08, 0, 0.35)
      : 0;
  const filmScanlines =
    post.videoEchoEnabled || visualDrive > 0.16 || audioDrive > 0.32
      ? clamp(
          0.02 + audioDrive * 0.08 + (post.videoEchoEnabled ? 0.03 : 0),
          0,
          0.25,
        )
      : 0;
  const filmScanlineCount = Math.round(
    1024 + audioDrive * 512 + (post.videoEchoEnabled ? 128 : 0),
  );
  const afterimageDamp =
    post.videoEchoEnabled || audioDrive > 0.16 || visualDrive > 0.14
      ? clamp(
          0.74 +
            audioDrive * 0.15 +
            visualDrive * 0.06 +
            (post.videoEchoEnabled ? post.videoEchoAlpha * 0.08 : 0),
          0.72,
          0.9,
        )
      : 0;
  const vignetteStrength =
    visualDrive > 0.1 || audioDrive > 0.2
      ? clamp(0.05 + visualDrive * 0.32 + audioDrive * 0.16, 0, 0.75)
      : 0;
  const chromaOffset =
    visualDrive > 0.15
      ? clamp(
          0.0004 +
            Math.abs(post.shaderControls.hueShift ?? 0) * 0.0012 +
            audioDrive * 0.0008 +
            Math.abs(post.shaderControls.mixAlpha ?? 0) * 0.0006,
          0,
          0.008,
        )
      : 0;
  const saturation = clamp(
    (post.shaderControls.saturation ?? 1) +
      audioDrive * 0.18 +
      (post.brighten ? 0.06 : 0) +
      (post.solarize ? 0.04 : 0),
    0.72,
    1.55,
  );
  const contrast = clamp(
    (post.shaderControls.contrast ?? 1) +
      visualDrive * 0.16 +
      audioDrive * 0.08 +
      (post.darken ? 0.05 : 0),
    0.8,
    1.45,
  );
  const pulseWarp =
    audioDrive > 0.16 || visualDrive > 0.14
      ? clamp(
          0.001 +
            audioDrive * 0.012 +
            Math.abs(post.warp ?? 0) * 0.004 +
            Math.abs(post.shaderControls.warpScale ?? 0) * 0.006,
          0,
          0.03,
        )
      : 0;

  return {
    enabled: audioDrive > 0.01 || visualDrive > 0.01,
    bloomStrength,
    bloomRadius,
    bloomThreshold,
    afterimageDamp,
    filmNoise,
    filmScanlines,
    filmScanlineCount,
    vignetteStrength,
    chromaOffset,
    saturation,
    contrast,
    pulseWarp,
  };
}

export function buildPost({
  preset,
  state,
  signals,
  createEnv,
  backend,
}: {
  preset: MilkdropCompiledPreset;
  state: MutableState;
  signals: MilkdropRuntimeSignals;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
  ) => MutableState;
  backend: 'webgl' | 'webgpu';
}): MilkdropPostVisual {
  const shaderControls = buildShaderControls({
    preset,
    signals,
    createEnv,
    backend,
  });
  const brighten = (state.brighten ?? 0) > 0.5;
  const darken = (state.darken ?? 0) > 0.5;
  const darkenCenter = (state.darken_center ?? 0) > 0.5;
  const solarize = (state.solarize ?? 0) > 0.5;
  const invert = (state.invert ?? 0) > 0.5;
  const gammaAdj = clamp(state.gammaadj ?? 1, 0.25, 4);
  const videoEchoEnabled =
    (state.video_echo_enabled ?? 0) > 0.5 || (state.video_echo_alpha ?? 0) > 0;
  const redBlueStereo =
    (state.red_blue_stereo ?? state.redbluestereo ?? 0) > 0.5;
  const post: MilkdropPostVisual = {
    // The adapter runs the feedback loop (warp, decay, composite) only while
    // this is set, and MilkDrop runs that loop for every preset: the decayed,
    // warped previous frame is what new geometry lands on. This used to be
    // set only when the preset carried some post work (a shader, echo,
    // brighten, a gamma other than the default 2), so the 89 bundled presets
    // that omit all of those (geiss-hurricane and geiss-cruzin among them)
    // were drawn straight to the screen. They lost their per-pixel warp,
    // decay and gamma, and their textured shapes sampled whatever frame the
    // previous preset had left in the read target. The low shader-quality
    // step still sheds the loop on purpose (runtime/lifecycle.ts).
    shaderEnabled: true,
    textureWrap: (state.texture_wrap ?? 0) > 0.5,
    feedbackTexture: (state.feedback_texture ?? 0) > 0.5,
    outerBorderStyle: (state.ob_border ?? 0) > 0.5,
    innerBorderStyle: (state.ib_border ?? 0) > 0.5,
    redBlueStereo,
    shaderControls,
    shaderPrograms: preset.ir.post.shaderPrograms,
    brighten,
    darken,
    darkenCenter,
    solarize,
    invert,
    gammaAdj,
    videoEchoEnabled,
    videoEchoAlpha: clamp(state.video_echo_alpha ?? 0.18, 0, 1),
    videoEchoZoom: clamp(state.video_echo_zoom ?? 1, 0.85, 1.3),
    videoEchoOrientation: normalizeVideoEchoOrientation(
      state.video_echo_orientation ?? 0,
    ),
    warp: clamp(state.warp ?? 0.08, 0, 1),
    decay: clamp(state.decay ?? 0.98, 0.001, 1),
    perPixelStatements: preset.ir.perPixelStatements,
  };
  post.postprocessingProfile = deriveMilkdropPostprocessingProfile({
    post,
    signals,
  });
  return post;
}
