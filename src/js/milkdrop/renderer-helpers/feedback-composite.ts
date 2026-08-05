import { isMilkdropShaderProgramBackendExecutable } from '../compiler/shader-execution-classification.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropRenderPayload,
} from '../types';

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function interpolateFeedbackCompositeState(
  current: MilkdropFeedbackCompositeState,
  previous: MilkdropFeedbackCompositeState,
  mix: number,
): MilkdropFeedbackCompositeState {
  return {
    ...current,
    warpScale: lerp(previous.warpScale, current.warpScale, mix),
    offsetX: lerp(previous.offsetX, current.offsetX, mix),
    offsetY: lerp(previous.offsetY, current.offsetY, mix),
    rotation: lerp(previous.rotation, current.rotation, mix),
    zoomMul: lerp(previous.zoomMul, current.zoomMul, mix),
    saturation: lerp(previous.saturation, current.saturation, mix),
    contrast: lerp(previous.contrast, current.contrast, mix),
    hueShift: lerp(previous.hueShift, current.hueShift, mix),
    mixAlpha: lerp(previous.mixAlpha, current.mixAlpha, mix),
    brightenBoost: lerp(previous.brightenBoost, current.brightenBoost, mix),
    invertBoost: lerp(previous.invertBoost, current.invertBoost, mix),
    solarizeBoost: lerp(previous.solarizeBoost, current.solarizeBoost, mix),
    colorScale: {
      r: lerp(previous.colorScale.r, current.colorScale.r, mix),
      g: lerp(previous.colorScale.g, current.colorScale.g, mix),
      b: lerp(previous.colorScale.b, current.colorScale.b, mix),
    },
    tint: {
      r: lerp(previous.tint.r, current.tint.r, mix),
      g: lerp(previous.tint.g, current.tint.g, mix),
      b: lerp(previous.tint.b, current.tint.b, mix),
    },
    decay: lerp(previous.decay, current.decay, mix),
    videoEchoAlpha: lerp(previous.videoEchoAlpha, current.videoEchoAlpha, mix),
    zoom: lerp(previous.zoom, current.zoom, mix),
    gammaAdj: lerp(previous.gammaAdj, current.gammaAdj, mix),
    overlayTextureAmount: lerp(
      previous.overlayTextureAmount,
      current.overlayTextureAmount,
      mix,
    ),
    overlayTextureScale: {
      x: lerp(
        previous.overlayTextureScale.x,
        current.overlayTextureScale.x,
        mix,
      ),
      y: lerp(
        previous.overlayTextureScale.y,
        current.overlayTextureScale.y,
        mix,
      ),
    },
    overlayTextureOffset: {
      x: lerp(
        previous.overlayTextureOffset.x,
        current.overlayTextureOffset.x,
        mix,
      ),
      y: lerp(
        previous.overlayTextureOffset.y,
        current.overlayTextureOffset.y,
        mix,
      ),
    },
    warpTextureAmount: lerp(
      previous.warpTextureAmount,
      current.warpTextureAmount,
      mix,
    ),
    warpTextureScale: {
      x: lerp(previous.warpTextureScale.x, current.warpTextureScale.x, mix),
      y: lerp(previous.warpTextureScale.y, current.warpTextureScale.y, mix),
    },
    warpTextureOffset: {
      x: lerp(previous.warpTextureOffset.x, current.warpTextureOffset.x, mix),
      y: lerp(previous.warpTextureOffset.y, current.warpTextureOffset.y, mix),
    },
    vignette: lerp(previous.vignette ?? 0, current.vignette ?? 0, mix),
    chromaticAberration: lerp(
      previous.chromaticAberration ?? 0,
      current.chromaticAberration ?? 0,
      mix,
    ),
  };
}

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
          statements: perPixelStatements,
        }
      : null,
    perPixelVariables: frameState.variables,
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
    signalBassAtt: frameState.signals.bassAtt,
    signalMid: frameState.signals.mid,
    signalMidAtt: frameState.signals.midAtt,
    signalTreb: frameState.signals.treb,
    signalTrebAtt: frameState.signals.trebleAtt,
    signalBeat: frameState.signals.beat,
    signalBeatPulse: frameState.signals.beatPulse,
    signalEnergy: frameState.signals.weightedEnergy,
    signalTime: frameState.signals.time,
    signalFrame: frameState.signals.frame,
    signalFps: frameState.signals.fps,
    aspect: frameState.signals.aspect ?? 1,
    decay: frameState.post.decay,
  };
}
