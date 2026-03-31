import { evaluateMilkdropShaderControlProgram } from '../compiler';
import type {
  MilkdropCompiledPreset,
  MilkdropPostVisual,
  MilkdropRuntimeSignals,
} from '../types';
import {
  clamp,
  type MutableState,
  normalizeVideoEchoOrientation,
} from './shared';

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
  return {
    shaderEnabled: (state.shader ?? 1) > 0.5,
    textureWrap: (state.texture_wrap ?? 0) > 0.5,
    feedbackTexture: (state.feedback_texture ?? 0) > 0.5,
    outerBorderStyle: (state.ob_border ?? 0) > 0.5,
    innerBorderStyle: (state.ib_border ?? 0) > 0.5,
    redBlueStereo: (state.red_blue_stereo ?? state.redbluestereo ?? 0) > 0.5,
    shaderControls: buildShaderControls({ preset, signals, createEnv }),
    shaderPrograms: preset.ir.post.shaderPrograms,
    brighten: (state.brighten ?? 0) > 0.5,
    darken: (state.darken ?? 0) > 0.5,
    darkenCenter: (state.darken_center ?? 0) > 0.5,
    solarize: (state.solarize ?? 0) > 0.5,
    invert: (state.invert ?? 0) > 0.5,
    gammaAdj: clamp(state.gammaadj ?? 1, 0.25, 4),
    videoEchoEnabled: (state.video_echo_enabled ?? 0) > 0.5,
    videoEchoAlpha: clamp(state.video_echo_alpha ?? 0.18, 0, 1),
    videoEchoZoom: clamp(state.video_echo_zoom ?? 1, 0.85, 1.3),
    videoEchoOrientation: normalizeVideoEchoOrientation(
      state.video_echo_orientation ?? 0,
    ),
    warp: clamp(state.warp ?? 0.08, 0, 1),
  };
}
