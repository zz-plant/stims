/**
 * Feedback Composite Intermediate Representation (IR)
 *
 * Describes the MilkDrop composite post-processing shader pipeline in a
 * declarative, backend-agnostic format. Both the GLSL path (for WebGL)
 * and the TSL node-graph path (for WebGPU) can generate their shader code
 * from this single source of truth.
 *
 * This addresses the ~1400-line TSL duplication in
 * `feedback-manager-webgpu-tsl.ts` vs the inline GLSL string in
 * `feedback-manager-shared.ts` by providing a shared description of the
 * composite pipeline structure.
 *
 * Future work: implement code generators in both paths that consume
 * this IR to produce GLSL/TSL dynamically.
 */

import type {
  MilkdropFeedbackCompositeState,
  MilkdropShaderProgramPayload,
} from './types';

// ─── Composite Pipeline IR Types ───────────────────────────────────

export type FeedbackCompositeUniformSlot =
  | { kind: 'sampler2d'; name: string }
  | { kind: 'float'; name: string }
  | { kind: 'vec2'; name: string }
  | { kind: 'vec3'; name: string };

export type FeedbackCompositeIR = {
  /** Ordered uniform declarations required by the pipeline. */
  uniformDeclarations: FeedbackCompositeUniformSlot[];
  /** Default uniform values keyed by uniform name. */
  defaultUniformValues: Record<string, unknown>;
  /** Whether direct warp/comp shader programs are active. */
  hasDirectWarpProgram: boolean;
  hasDirectCompProgram: boolean;
};

// ─── Uniform Value Factory ─────────────────────────────────────────

/**
 * Build default uniform values for the composite pipeline.
 * This provides the canonical starting values that both the
 * GLSL and TSL paths initialize from.
 */
export function buildCompositeUniformDefaults(): Record<string, unknown> {
  return {
    mixAlpha: 0.18,
    videoEchoAlpha: 0,
    zoom: 1.02,
    videoEchoOrientation: 0,
    brighten: 0,
    darken: 0,
    darkenCenter: 0,
    solarize: 0,
    invert: 0,
    redBlueStereo: 0,
    gammaAdj: 1,
    textureWrap: 0,
    feedbackTexture: 0,
    warpScale: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    zoomMul: 1,
    saturation: 1,
    contrast: 1,
    colorScale: { r: 1, g: 1, b: 1 },
    hueShift: 0,
    brightenBoost: 0,
    invertBoost: 0,
    solarizeBoost: 0,
    tint: { r: 1, g: 1, b: 1 },
    feedbackSoftness: 0,
    currentFrameBoost: 0,
    overlayTextureSource: 0,
    overlayTextureMode: 0,
    overlayTextureSampleDimension: 0,
    overlayTextureInvert: 0,
    overlayTextureAmount: 0,
    overlayTextureScale: { x: 1, y: 1 },
    overlayTextureOffset: { x: 0, y: 0 },
    overlayTextureVolumeSliceZ: 0,
    warpTextureSource: 0,
    warpTextureSampleDimension: 0,
    warpTextureAmount: 0,
    warpTextureScale: { x: 1, y: 1 },
    warpTextureOffset: { x: 0, y: 0 },
    warpTextureVolumeSliceZ: 0,
    signalBass: 0,
    signalMid: 0,
    signalTreb: 0,
    signalBeat: 0,
    signalBeatPulse: 0,
    signalEnergy: 0,
    signalTime: 0,
    texelSize: { x: 1, y: 1 },
  };
}

// ─── MILKDROP COMPOSITE IR ─────────────────────────────────────────

/**
 * The canonical MilkDrop composite pipeline expressed as an IR.
 *
 * This is the SINGLE SOURCE OF TRUTH for the feedback compositing
 * uniforms and their default values. When adding or removing a
 * composite uniform, update ONLY this definition.
 *
 * Both the GLSL generation path (`feedback-manager-shared.ts`) and
 * the TSL node-graph path (`feedback-manager-webgpu-tsl.ts`) should
 * consume from this IR rather than maintaining independent lists.
 */
export const MILKDROP_COMPOSITE_IR: FeedbackCompositeIR = {
  uniformDeclarations: [
    { kind: 'sampler2d', name: 'currentTex' },
    { kind: 'sampler2d', name: 'previousTex' },
    { kind: 'sampler2d', name: 'noiseTex' },
    { kind: 'sampler2d', name: 'simplexTex' },
    { kind: 'sampler2d', name: 'voronoiTex' },
    { kind: 'sampler2d', name: 'auraTex' },
    { kind: 'sampler2d', name: 'causticsTex' },
    { kind: 'sampler2d', name: 'patternTex' },
    { kind: 'sampler2d', name: 'fractalTex' },
    { kind: 'sampler2d', name: 'videoTex' },
    { kind: 'float', name: 'mixAlpha' },
    { kind: 'float', name: 'videoEchoAlpha' },
    { kind: 'float', name: 'zoom' },
    { kind: 'float', name: 'videoEchoOrientation' },
    { kind: 'float', name: 'brighten' },
    { kind: 'float', name: 'darken' },
    { kind: 'float', name: 'darkenCenter' },
    { kind: 'float', name: 'solarize' },
    { kind: 'float', name: 'invert' },
    { kind: 'float', name: 'redBlueStereo' },
    { kind: 'float', name: 'gammaAdj' },
    { kind: 'float', name: 'textureWrap' },
    { kind: 'float', name: 'feedbackTexture' },
    { kind: 'float', name: 'warpScale' },
    { kind: 'float', name: 'offsetX' },
    { kind: 'float', name: 'offsetY' },
    { kind: 'float', name: 'rotation' },
    { kind: 'float', name: 'zoomMul' },
    { kind: 'float', name: 'saturation' },
    { kind: 'float', name: 'contrast' },
    { kind: 'vec3', name: 'colorScale' },
    { kind: 'float', name: 'hueShift' },
    { kind: 'float', name: 'brightenBoost' },
    { kind: 'float', name: 'invertBoost' },
    { kind: 'float', name: 'solarizeBoost' },
    { kind: 'vec3', name: 'tint' },
    { kind: 'float', name: 'feedbackSoftness' },
    { kind: 'float', name: 'currentFrameBoost' },
    { kind: 'float', name: 'overlayTextureSource' },
    { kind: 'float', name: 'overlayTextureMode' },
    { kind: 'float', name: 'overlayTextureSampleDimension' },
    { kind: 'float', name: 'overlayTextureInvert' },
    { kind: 'float', name: 'overlayTextureAmount' },
    { kind: 'vec2', name: 'overlayTextureScale' },
    { kind: 'vec2', name: 'overlayTextureOffset' },
    { kind: 'float', name: 'overlayTextureVolumeSliceZ' },
    { kind: 'float', name: 'warpTextureSource' },
    { kind: 'float', name: 'warpTextureSampleDimension' },
    { kind: 'float', name: 'warpTextureAmount' },
    { kind: 'vec2', name: 'warpTextureScale' },
    { kind: 'vec2', name: 'warpTextureOffset' },
    { kind: 'float', name: 'warpTextureVolumeSliceZ' },
    { kind: 'float', name: 'signalBass' },
    { kind: 'float', name: 'signalMid' },
    { kind: 'float', name: 'signalTreb' },
    { kind: 'float', name: 'signalBeat' },
    { kind: 'float', name: 'signalBeatPulse' },
    { kind: 'float', name: 'signalEnergy' },
    { kind: 'float', name: 'signalTime' },
    { kind: 'vec2', name: 'texelSize' },
  ],
  defaultUniformValues: buildCompositeUniformDefaults(),
  hasDirectWarpProgram: false,
  hasDirectCompProgram: false,
};

// ─── State Application Helpers ─────────────────────────────────────

/**
 * Apply composite state to the canonical default uniform values.
 * Returns a new defaults object with state values applied.
 *
 * Both GLSL and TSL paths use this to compute uniform values before
 * applying them to their respective material/shaders.
 */
export function applyCompositeStateToDefaults(
  state: MilkdropFeedbackCompositeState,
): Record<string, unknown> {
  const defaults = buildCompositeUniformDefaults();
  defaults.mixAlpha = state.mixAlpha;
  defaults.videoEchoAlpha = state.videoEchoAlpha;
  defaults.zoom = state.zoom;
  defaults.videoEchoOrientation = state.videoEchoOrientation;
  defaults.brighten = state.brighten;
  defaults.darken = state.darken;
  defaults.darkenCenter = state.darkenCenter;
  defaults.solarize = state.solarize;
  defaults.invert = state.invert;
  defaults.redBlueStereo = state.redBlueStereo ?? 0;
  defaults.gammaAdj = state.gammaAdj;
  defaults.textureWrap = state.textureWrap;
  defaults.feedbackTexture = state.feedbackTexture;
  defaults.warpScale = state.warpScale;
  defaults.offsetX = state.offsetX;
  defaults.offsetY = state.offsetY;
  defaults.rotation = state.rotation;
  defaults.zoomMul = state.zoomMul;
  defaults.saturation = state.saturation;
  defaults.contrast = state.contrast;
  defaults.colorScale = state.colorScale;
  defaults.hueShift = state.hueShift;
  defaults.brightenBoost = state.brightenBoost;
  defaults.invertBoost = state.invertBoost;
  defaults.solarizeBoost = state.solarizeBoost;
  defaults.tint = state.tint;
  defaults.overlayTextureSource = state.overlayTextureSource;
  defaults.overlayTextureMode = state.overlayTextureMode;
  defaults.overlayTextureSampleDimension = state.overlayTextureSampleDimension;
  defaults.overlayTextureInvert = state.overlayTextureInvert;
  defaults.overlayTextureAmount = state.overlayTextureAmount;
  defaults.overlayTextureScale = state.overlayTextureScale;
  defaults.overlayTextureOffset = state.overlayTextureOffset;
  defaults.overlayTextureVolumeSliceZ = state.overlayTextureVolumeSliceZ;
  defaults.warpTextureSource = state.warpTextureSource;
  defaults.warpTextureSampleDimension = state.warpTextureSampleDimension;
  defaults.warpTextureAmount = state.warpTextureAmount;
  defaults.warpTextureScale = state.warpTextureScale;
  defaults.warpTextureOffset = state.warpTextureOffset;
  defaults.warpTextureVolumeSliceZ = state.warpTextureVolumeSliceZ;
  defaults.signalBass = state.signalBass;
  defaults.signalMid = state.signalMid;
  defaults.signalTreb = state.signalTreb;
  defaults.signalBeat = state.signalBeat;
  defaults.signalBeatPulse = state.signalBeatPulse;
  defaults.signalEnergy = state.signalEnergy;
  defaults.signalTime = state.signalTime;
  return defaults;
}

/**
 * Check whether the given composite state includes a direct warp program.
 */
export function hasDirectWarpProgram(shaderPrograms: {
  warp: MilkdropShaderProgramPayload | null;
  comp: MilkdropShaderProgramPayload | null;
}): boolean {
  return shaderPrograms.warp !== null;
}

/**
 * Check whether the given composite state includes a direct comp program.
 */
export function hasDirectCompProgram(shaderPrograms: {
  warp: MilkdropShaderProgramPayload | null;
  comp: MilkdropShaderProgramPayload | null;
}): boolean {
  return shaderPrograms.comp !== null;
}
