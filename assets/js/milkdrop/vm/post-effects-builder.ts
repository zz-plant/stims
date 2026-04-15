import { evaluateMilkdropShaderControlProgram } from '../compiler';
import type {
  MilkdropCompiledPreset,
  MilkdropPostprocessingProfile,
  MilkdropPostVisual,
  MilkdropRuntimeSignals,
} from '../types';
import {
  clamp,
  type MutableState,
  normalizeVideoEchoOrientation,
} from './shared';

const POST_PASS_EPSILON = 0.0001;
const DEFAULT_PROJECTM_GAMMA_ADJ = 2;

function hasNonNeutralShaderControls(
  controls: MilkdropPostVisual['shaderControls'],
) {
  return (
    Math.abs(controls.warpScale) > POST_PASS_EPSILON ||
    Math.abs(controls.offsetX) > POST_PASS_EPSILON ||
    Math.abs(controls.offsetY) > POST_PASS_EPSILON ||
    Math.abs(controls.rotation) > POST_PASS_EPSILON ||
    Math.abs(controls.zoom - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.saturation - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.contrast - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.colorScale.r - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.colorScale.g - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.colorScale.b - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.hueShift) > POST_PASS_EPSILON ||
    Math.abs(controls.mixAlpha) > POST_PASS_EPSILON ||
    Math.abs(controls.brightenBoost) > POST_PASS_EPSILON ||
    Math.abs(controls.invertBoost) > POST_PASS_EPSILON ||
    Math.abs(controls.solarizeBoost) > POST_PASS_EPSILON ||
    Math.abs(controls.tint.r - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.tint.g - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.tint.b - 1) > POST_PASS_EPSILON ||
    controls.textureLayer.source !== 'none' ||
    controls.textureLayer.mode !== 'none' ||
    controls.textureLayer.sampleDimension !== '2d' ||
    controls.textureLayer.inverted ||
    Math.abs(controls.textureLayer.amount) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.scaleX - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.scaleY - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.offsetX) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.offsetY) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.volumeSliceZ ?? 0) > POST_PASS_EPSILON ||
    controls.warpTexture.source !== 'none' ||
    controls.warpTexture.sampleDimension !== '2d' ||
    Math.abs(controls.warpTexture.amount) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.scaleX - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.scaleY - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.offsetX) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.offsetY) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.volumeSliceZ ?? 0) > POST_PASS_EPSILON
  );
}

export function buildShaderControls({
  preset,
  signals,
  createEnv,
}: {
  preset: MilkdropCompiledPreset;
  signals: MilkdropRuntimeSignals;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
  ) => MutableState;
}) {
  return evaluateMilkdropShaderControlProgram({
    warp: preset.ir.shaderText.warp,
    comp: preset.ir.shaderText.comp,
    env: createEnv(signals),
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
    0.45,
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
          0.96,
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
}: {
  preset: MilkdropCompiledPreset;
  state: MutableState;
  signals: MilkdropRuntimeSignals;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
  ) => MutableState;
}): MilkdropPostVisual {
  const shaderControls = buildShaderControls({ preset, signals, createEnv });
  const brighten = (state.brighten ?? 0) > 0.5;
  const darken = (state.darken ?? 0) > 0.5;
  const darkenCenter = (state.darken_center ?? 0) > 0.5;
  const solarize = (state.solarize ?? 0) > 0.5;
  const invert = (state.invert ?? 0) > 0.5;
  const gammaAdj = clamp(state.gammaadj ?? 1, 0.25, 4);
  const videoEchoEnabled = (state.video_echo_enabled ?? 0) > 0.5;
  const redBlueStereo =
    (state.red_blue_stereo ?? state.redbluestereo ?? 0) > 0.5;
  const shaderEnabled =
    (state.shader ?? 1) > 0.5 ||
    videoEchoEnabled ||
    brighten ||
    darken ||
    darkenCenter ||
    solarize ||
    invert ||
    redBlueStereo ||
    Math.abs(gammaAdj - DEFAULT_PROJECTM_GAMMA_ADJ) > POST_PASS_EPSILON ||
    preset.ir.shaderText.warp !== null ||
    preset.ir.shaderText.comp !== null ||
    preset.ir.post.shaderPrograms.warp !== null ||
    preset.ir.post.shaderPrograms.comp !== null ||
    hasNonNeutralShaderControls(shaderControls);
  const post: MilkdropPostVisual = {
    shaderEnabled,
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
  };
  post.postprocessingProfile = deriveMilkdropPostprocessingProfile({
    post,
    signals,
  });
  return post;
}
