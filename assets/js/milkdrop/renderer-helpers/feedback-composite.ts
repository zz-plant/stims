import type {
  MilkdropFeedbackCompositeState,
  MilkdropRenderPayload,
} from '../types';

export function buildFeedbackCompositeState({
  frameState,
  backend,
  directFeedbackShaders,
  webgpuFeedbackPlanShaderExecution,
  getShaderTextureSourceId,
  getShaderTextureBlendModeId,
  getShaderSampleDimensionId,
}: {
  frameState: MilkdropRenderPayload['frameState'];
  backend: 'webgl' | 'webgpu';
  directFeedbackShaders: boolean;
  webgpuFeedbackPlanShaderExecution: 'direct' | 'controls' | 'none' | undefined;
  getShaderTextureSourceId: (source: string) => number;
  getShaderTextureBlendModeId: (mode: string) => number;
  getShaderSampleDimensionId: (dimension: '2d' | '3d') => number;
}): MilkdropFeedbackCompositeState {
  const controls = frameState.post.shaderControls;
  const feedbackOptimizationEnabled =
    backend !== 'webgpu' || directFeedbackShaders;
  const shaderPrograms = {
    warp:
      feedbackOptimizationEnabled &&
      frameState.post.shaderPrograms.warp?.execution.supportedBackends.includes(
        backend,
      )
        ? frameState.post.shaderPrograms.warp
        : null,
    comp:
      feedbackOptimizationEnabled &&
      frameState.post.shaderPrograms.comp?.execution.supportedBackends.includes(
        backend,
      )
        ? frameState.post.shaderPrograms.comp
        : null,
  };
  const plannedShaderExecution =
    backend === 'webgpu'
      ? feedbackOptimizationEnabled
        ? webgpuFeedbackPlanShaderExecution
        : 'controls'
      : null;
  const usesDirectShaderPrograms =
    plannedShaderExecution === 'direct'
      ? true
      : plannedShaderExecution === 'controls'
        ? false
        : shaderPrograms.warp !== null || shaderPrograms.comp !== null;
  return {
    shaderExecution: usesDirectShaderPrograms ? 'direct' : 'controls',
    shaderPrograms,
    mixAlpha: frameState.post.videoEchoEnabled
      ? frameState.post.videoEchoAlpha + controls.mixAlpha
      : controls.mixAlpha,
    zoom: frameState.post.videoEchoEnabled
      ? frameState.post.videoEchoZoom + controls.warpScale * 0.04
      : 1,
    videoEchoOrientation: frameState.post.videoEchoEnabled
      ? frameState.post.videoEchoOrientation
      : 0,
    brighten: frameState.post.brighten ? 1 : 0,
    darken: frameState.post.darken ? 1 : 0,
    darkenCenter: frameState.post.darkenCenter ? 1 : 0,
    solarize: frameState.post.solarize ? 1 : 0,
    invert: frameState.post.invert ? 1 : 0,
    redBlueStereo:
      (frameState.variables.red_blue_stereo ??
        frameState.variables.redbluestereo ??
        0) > 0.5
        ? 1
        : 0,
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
    signalBeat: frameState.signals.beatPulse,
    signalEnergy: frameState.signals.weightedEnergy,
    signalTime: frameState.signals.time,
  };
}
