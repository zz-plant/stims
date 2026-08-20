import { getFeedbackBackendProfile } from '../backend-behavior';
import { isMilkdropShaderProgramBackendExecutable } from '../compiler/shader-execution-classification.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropPostVisual,
  MilkdropRenderPayload,
} from '../types';

// Mirrors the WebGL manager's blurEnabled gate: the warp/comp feedback loop
// only reads blur1Tex/blur2Tex/blur3Tex when a preset's shader bodies sample
// them, so everything else can skip the softness taps and blur passes.
const BLUR_TEXTURE_SAMPLE_PATTERN = /texture2D\s*\(\s*blur[123]Tex\b/i;

export function buildFeedbackCompositeState({
  frameState,
  backend,
  directFeedbackShaders,
  webgpuFeedbackPlanShaderExecution,
  webgpuFeedbackPlanFallback = false,
  getShaderTextureSourceId,
  getShaderTextureBlendModeId,
  getShaderSampleDimensionId,
}: {
  frameState: MilkdropRenderPayload['frameState'];
  backend: 'webgl' | 'webgpu';
  directFeedbackShaders: boolean;
  webgpuFeedbackPlanShaderExecution: 'direct' | 'controls' | 'none' | undefined;
  webgpuFeedbackPlanFallback?: boolean;
  getShaderTextureSourceId: (source: string) => number;
  getShaderTextureBlendModeId: (mode: string) => number;
  getShaderSampleDimensionId: (dimension: '2d' | '3d') => number;
}): MilkdropFeedbackCompositeState {
  const controls = frameState.post.shaderControls;
  const feedbackOptimizationEnabled =
    backend !== 'webgpu' || directFeedbackShaders;
  // When the descriptor plan reports shaderExecution === 'direct', the preset's
  // warp/comp shader is already verified as WebGPU-executable. The
  // webgpuFeedbackPlanFallback flag reflects broader compatibility concerns
  // (video echo, feedback texture, shader textures, post effects) and must not
  // override the explicit 'direct' execution mode — doing so discards the
  // shader body and forces uniform-only evaluation, producing a major visual
  // discrepancy with the WebGL backend for shader-heavy presets.
  const plannedShaderExecution =
    backend === 'webgpu'
      ? feedbackOptimizationEnabled &&
        (!webgpuFeedbackPlanFallback ||
          webgpuFeedbackPlanShaderExecution === 'direct')
        ? (webgpuFeedbackPlanShaderExecution ?? 'controls')
        : 'controls'
      : null;
  const allowDirectShaderPrograms =
    backend !== 'webgpu' || plannedShaderExecution === 'direct';
  const shaderPrograms = {
    warp:
      feedbackOptimizationEnabled &&
      allowDirectShaderPrograms &&
      isMilkdropShaderProgramBackendExecutable(
        frameState.post.shaderPrograms.warp,
        backend,
      )
        ? frameState.post.shaderPrograms.warp
        : null,
    comp:
      feedbackOptimizationEnabled &&
      allowDirectShaderPrograms &&
      isMilkdropShaderProgramBackendExecutable(
        frameState.post.shaderPrograms.comp,
        backend,
      )
        ? frameState.post.shaderPrograms.comp
        : null,
  };
  const usesDirectShaderPrograms =
    plannedShaderExecution === 'direct'
      ? true
      : plannedShaderExecution === 'controls'
        ? false
        : shaderPrograms.warp !== null || shaderPrograms.comp !== null;
  const perPixelStatements = frameState.post.perPixelStatements ?? null;

  const feedbackSoftness = presetReferencesBlurTextures(
    frameState.post.shaderPrograms,
    perPixelStatements ? { statements: perPixelStatements } : null,
  )
    ? getFeedbackBackendProfile(backend).feedbackSoftness
    : 0;

  return {
    shaderExecution: usesDirectShaderPrograms ? 'direct' : 'controls',
    shaderPrograms,
    perPixelPrograms: perPixelStatements
      ? {
          statements: perPixelStatements,
        }
      : null,
    perPixelVariables: frameState.variables,
    mixAlpha: controls.mixAlpha,
    videoEchoAlpha: frameState.post.videoEchoEnabled
      ? frameState.post.videoEchoAlpha
      : 0,
    zoom: frameState.post.videoEchoEnabled ? frameState.post.videoEchoZoom : 1,
    // The echo orientation flip belongs to the legacy echo effect. Presets
    // that carry a warp shader are feedback-driven by that shader, whose own
    // sampling defines orientation; the direct path never applies the flip.
    // Applying it in the legacy fallback rotated the whole previous frame 180°,
    // making shader-heavy themes render upside down on backends/paths where the
    // warp shader cannot execute (e.g. WebGPU translated fallback).
    videoEchoOrientation:
      frameState.post.videoEchoEnabled &&
      frameState.post.shaderPrograms.warp === null
        ? frameState.post.videoEchoOrientation
        : 0,
    brighten: frameState.post.brighten ? 1 : 0,
    darken: frameState.post.darken ? 1 : 0,
    darkenCenter: frameState.post.darkenCenter ? 1 : 0,
    solarize: frameState.post.solarize ? 1 : 0,
    invert: frameState.post.invert ? 1 : 0,
    redBlueStereo: frameState.post.redBlueStereo ? 1 : 0,
    gammaAdj: frameState.post.gammaAdj,
    textureWrap: frameState.post.textureWrap ? 1 : 0,
    feedbackTexture: frameState.post.feedbackTexture ? 1 : 0,
    warpScale: controls.warpScale,
    offsetX: controls.offsetX,
    offsetY: controls.offsetY,
    rotation: controls.rotation,
    zoomMul: controls.zoom,
    saturation: controls.saturation,
    contrast: controls.contrast,
    colorScale: {
      r: controls.colorScale.r,
      g: controls.colorScale.g,
      b: controls.colorScale.b,
    },
    hueShift: controls.hueShift,
    brightenBoost: controls.brightenBoost,
    invertBoost: controls.invertBoost,
    solarizeBoost: controls.solarizeBoost,
    tint: {
      r: controls.tint.r,
      g: controls.tint.g,
      b: controls.tint.b,
    },
    overlayTextureSource: getShaderTextureSourceId(
      controls.textureLayer.source,
    ),
    overlayTextureMode: getShaderTextureBlendModeId(controls.textureLayer.mode),
    overlayTextureSampleDimension: getShaderSampleDimensionId(
      controls.textureLayer.sampleDimension,
    ),
    overlayTextureInvert: controls.textureLayer.inverted ? 1 : 0,
    overlayTextureAmount: controls.textureLayer.amount,
    overlayTextureScale: {
      x: controls.textureLayer.scaleX,
      y: controls.textureLayer.scaleY,
    },
    overlayTextureOffset: {
      x: controls.textureLayer.offsetX,
      y: controls.textureLayer.offsetY,
    },
    overlayTextureVolumeSliceZ: controls.textureLayer.volumeSliceZ ?? 0,
    warpTextureSource: getShaderTextureSourceId(controls.warpTexture.source),
    warpTextureSampleDimension: getShaderSampleDimensionId(
      controls.warpTexture.sampleDimension,
    ),
    warpTextureAmount: controls.warpTexture.amount,
    warpTextureScale: {
      x: controls.warpTexture.scaleX,
      y: controls.warpTexture.scaleY,
    },
    warpTextureOffset: {
      x: controls.warpTexture.offsetX,
      y: controls.warpTexture.offsetY,
    },
    warpTextureVolumeSliceZ: controls.warpTexture.volumeSliceZ ?? 0,
    signalBass: frameState.signals.bass,
    signalBassAtt:
      frameState.signals.bassAtt ??
      frameState.signals.bass_att ??
      frameState.signals.bass,
    signalMid: frameState.signals.mid,
    signalMidAtt:
      frameState.signals.midAtt ??
      frameState.signals.mid_att ??
      frameState.signals.mid,
    signalTreb: frameState.signals.treb ?? frameState.signals.treble,
    signalTrebAtt:
      frameState.signals.trebleAtt ??
      frameState.signals.treb_att ??
      frameState.signals.treble_att ??
      frameState.signals.treb ??
      frameState.signals.treble,
    signalPercussive: frameState.signals.percussive,
    signalHarmonic: frameState.signals.harmonic,
    signalPercussiveLow: frameState.signals.percussiveLow,
    signalPercussiveMid: frameState.signals.percussiveMid,
    signalPercussiveHigh: frameState.signals.percussiveHigh,
    signalPercussiveRatio: frameState.signals.percussiveRatio,
    signalBeat: frameState.signals.beat,
    signalBeatPulse: frameState.signals.beatPulse,
    signalEnergy: frameState.signals.weightedEnergy,
    signalTime: frameState.signals.time,
    signalFrame: frameState.signals.frame,
    signalFps: frameState.signals.fps,
    aspect: frameState.signals.aspect ?? 1,
    decay: frameState.post.decay,
    feedbackSoftness,
  };
}

// The answer is preset-invariant but the question is asked every frame;
// cache per stable program/statement object so the regex sweep over full
// shader sources runs once per preset instead of per frame.
const blurReferenceCache = new WeakMap<object, boolean>();

function sourceReferencesBlurTextures(holder: object, source: string | null) {
  let result = blurReferenceCache.get(holder);
  if (result === undefined) {
    result = source !== null && BLUR_TEXTURE_SAMPLE_PATTERN.test(source);
    blurReferenceCache.set(holder, result);
  }
  return result;
}

function presetReferencesBlurTextures(
  shaderPrograms: MilkdropPostVisual['shaderPrograms'],
  perPixelStatements: MilkdropFeedbackCompositeState['perPixelPrograms'] | null,
) {
  const warp = shaderPrograms.warp;
  const comp = shaderPrograms.comp;
  if (warp && sourceReferencesBlurTextures(warp, warp.source ?? null)) {
    return true;
  }
  if (comp && sourceReferencesBlurTextures(comp, comp.source ?? null)) {
    return true;
  }
  const statements = perPixelStatements?.statements;
  if (statements) {
    for (const statement of statements) {
      if (sourceReferencesBlurTextures(statement, statement.source ?? null)) {
        return true;
      }
    }
  }
  return false;
}
