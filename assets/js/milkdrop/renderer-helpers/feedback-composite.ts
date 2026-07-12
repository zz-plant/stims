import { isMilkdropShaderProgramBackendExecutable } from '../compiler/shader-execution-classification.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropRenderPayload,
} from '../types';

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
  const plannedShaderExecution =
    backend === 'webgpu'
      ? feedbackOptimizationEnabled && !webgpuFeedbackPlanFallback
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

  return {
    shaderExecution: usesDirectShaderPrograms ? 'direct' : 'controls',
    shaderPrograms,
    perPixelPrograms: perPixelStatements
      ? {
          statements: perPixelStatements.map((s) => ({
            target: s.target,
            expression: s.source,
          })),
        }
      : null,
    mixAlpha: controls.mixAlpha,
    videoEchoAlpha: frameState.post.videoEchoEnabled
      ? frameState.post.videoEchoAlpha
      : 0,
    zoom: frameState.post.videoEchoEnabled ? frameState.post.videoEchoZoom : 1,
    videoEchoOrientation: frameState.post.videoEchoEnabled
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
    signalMid: frameState.signals.mid,
    signalTreb: frameState.signals.treb,
    signalBeat: frameState.signals.beat,
    signalBeatPulse: frameState.signals.beatPulse,
    signalEnergy: frameState.signals.weightedEnergy,
    signalTime: frameState.signals.time,
    decay: frameState.post.decay,
  };
}
