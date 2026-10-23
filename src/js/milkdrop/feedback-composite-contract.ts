/**
 * Canonical composite-uniform table for the two feedback managers.
 *
 * The WebGL ShaderMaterial bag (feedback-manager-shared.ts) and the WebGPU
 * TSL uniform bag (feedback-manager-webgpu-composite.ts) used to declare the
 * same ~50 scalar/vector defaults twice, and nothing failed when they
 * drifted: a uniform added to one bag but not the other simply read its
 * neutral default on the missing backend, which is exactly how a backend-only
 * shader feature silently diverges. This module is the single source for
 * those defaults and for which backends must bind each uniform, so a
 * differential test can prove the two bags agree (see
 * tests/unit/milkdrop-feedback-uniform-contract.test.ts).
 *
 * Textures are bindings, not scalar defaults, so they live in
 * COMPOSITE_UNIFORM_BINDINGS for coverage but carry no value here; the shared
 * deterministic scalar/vector defaults are in COMPOSITE_SHARED_UNIFORM_DEFAULTS.
 * Values that are size- or profile-derived (texelSize, texsize, rand_preset,
 * feedbackSoftness, currentFrameBoost) are declared shared but stay with each
 * manager, which computes them from its own targets and profile.
 */
import { Color, Vector2, Vector4 } from 'three';

export type CompositeUniformBackend = 'shared' | 'webgl' | 'webgpu';

/** Plain, three-free default: a scalar or an array for vec2/vec3/vec4. */
export type CompositeScalarDefault =
  | number
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

/** Every composite uniform name and the backends that must bind it. */
export const COMPOSITE_UNIFORM_BINDINGS: Record<
  string,
  CompositeUniformBackend
> = {
  // Textures both backends bind.
  currentTex: 'shared',
  previousTex: 'shared',
  internalTex: 'shared',
  warpTex: 'shared',
  noiseTex: 'shared',
  noiseLqTex: 'shared',
  noisevolTex: 'shared',
  perlinTex: 'shared',
  simplexTex: 'shared',
  voronoiTex: 'shared',
  auraTex: 'shared',
  causticsTex: 'shared',
  patternTex: 'shared',
  fractalTex: 'shared',
  videoTex: 'shared',
  audioTex: 'shared',
  blur1Tex: 'shared',
  blur2Tex: 'shared',
  blur3Tex: 'shared',
  // Textures only the WebGPU bag binds.
  glyphTex: 'webgpu',
  organicTex: 'webgpu',
  noisevolTex3D: 'webgpu',
  noiseTex3D: 'webgpu',
  perlinTex3D: 'webgpu',
  simplexTex3D: 'webgpu',
  voronoiTex3D: 'webgpu',
  auraTex3D: 'webgpu',
  causticsTex3D: 'webgpu',
  patternTex3D: 'webgpu',
  fractalTex3D: 'webgpu',
  displayHistoryTex: 'webgpu',
  // Shared scalar/vector composite controls.
  mixAlpha: 'webgpu',
  videoEchoAlpha: 'shared',
  videoEchoZoom: 'shared',
  zoom: 'webgpu',
  videoEchoOrientation: 'shared',
  brighten: 'shared',
  darken: 'shared',
  darkenCenter: 'shared',
  solarize: 'shared',
  invert: 'shared',
  redBlueStereo: 'shared',
  gammaAdj: 'shared',
  textureWrap: 'shared',
  feedbackTexture: 'webgpu',
  warpScale: 'shared',
  offsetX: 'shared',
  offsetY: 'shared',
  rotation: 'shared',
  zoomMul: 'shared',
  warpCenterScale: 'webgpu',
  warpZoomExponent: 'webgpu',
  saturation: 'shared',
  contrast: 'shared',
  colorScale: 'shared',
  hueShift: 'shared',
  brightenBoost: 'shared',
  invertBoost: 'shared',
  solarizeBoost: 'shared',
  vignette: 'shared',
  chromaticAberration: 'shared',
  tint: 'shared',
  feedbackSoftness: 'shared',
  currentFrameBoost: 'shared',
  overlayTextureSource: 'shared',
  overlayTextureMode: 'shared',
  overlayTextureSampleDimension: 'shared',
  overlayTextureInvert: 'shared',
  overlayTextureAmount: 'shared',
  overlayTextureScale: 'shared',
  overlayTextureOffset: 'shared',
  overlayTextureVolumeSliceZ: 'shared',
  warpTextureSource: 'shared',
  warpTextureSampleDimension: 'shared',
  warpTextureAmount: 'shared',
  warpTextureScale: 'shared',
  warpTextureOffset: 'shared',
  warpTextureVolumeSliceZ: 'shared',
  signalBass: 'shared',
  signalBassAtt: 'shared',
  signalMid: 'shared',
  signalMidAtt: 'shared',
  signalTreb: 'shared',
  signalTrebAtt: 'shared',
  signalPercussive: 'shared',
  signalHarmonic: 'shared',
  signalPercussiveLow: 'shared',
  signalPercussiveMid: 'shared',
  signalPercussiveHigh: 'shared',
  signalPercussiveRatio: 'shared',
  signalBeat: 'shared',
  signalBeatPulse: 'shared',
  signalEnergy: 'shared',
  signalTime: 'shared',
  signalFrame: 'shared',
  signalProgress: 'shared',
  signalFps: 'shared',
  aspect: 'shared',
  decay: 'shared',
  hasDirectWarp: 'webgl',
  texelSize: 'shared',
  texsize: 'shared',
  rand_preset: 'shared',
  scale1: 'shared',
  bias1: 'shared',
  scale2: 'shared',
  bias2: 'shared',
  scale3: 'shared',
  bias3: 'shared',
  texsizeNoiseLq: 'webgpu',
  texsizeNoiseHq: 'webgpu',
  texsizeNoisevolHq: 'webgpu',
  // WebGL q/t register banks; the WebGPU path packs them as perPixelQ/T.
  _qa: 'webgl',
  _qb: 'webgl',
  _qc: 'webgl',
  _qd: 'webgl',
  _qe: 'webgl',
  _qf: 'webgl',
  _qg: 'webgl',
  _qh: 'webgl',
  // Post/display-only controls on the WebGPU bag.
  postBloomStrength: 'webgpu',
  postBloomThreshold: 'webgpu',
  postBloomRadius: 'webgpu',
  postFilmGrainAmount: 'webgpu',
  postChromaticAberration: 'webgpu',
  postAfterimageDamp: 'webgpu',
  // WebGPU executor state: per-frame variable nodes and the q/t banks.
  perFrameVariables: 'webgpu',
  perPixelQ: 'webgpu',
  perPixelT: 'webgpu',
} as const;

/**
 * Deterministic defaults for the shared scalar/vector uniforms. Both managers
 * read these so the bags cannot drift; the differential test asserts the
 * values match what each bag actually binds.
 */
export const COMPOSITE_SHARED_UNIFORM_DEFAULTS: Record<
  string,
  CompositeScalarDefault
> = {
  videoEchoAlpha: 0,
  videoEchoZoom: 1,
  videoEchoOrientation: 0,
  brighten: 0,
  darken: 0,
  darkenCenter: 0,
  solarize: 0,
  invert: 0,
  redBlueStereo: 0,
  gammaAdj: 1,
  textureWrap: 0,
  warpScale: 0,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  zoomMul: 1,
  saturation: 1,
  contrast: 1,
  colorScale: [1, 1, 1],
  hueShift: 0,
  brightenBoost: 0,
  invertBoost: 0,
  solarizeBoost: 0,
  vignette: 0,
  chromaticAberration: 0,
  tint: [1, 1, 1],
  overlayTextureSource: 0,
  overlayTextureMode: 0,
  overlayTextureSampleDimension: 0,
  overlayTextureInvert: 0,
  overlayTextureAmount: 0,
  overlayTextureScale: [1, 1],
  overlayTextureOffset: [0, 0],
  overlayTextureVolumeSliceZ: 0,
  warpTextureSource: 0,
  warpTextureSampleDimension: 0,
  warpTextureAmount: 0,
  warpTextureScale: [1, 1],
  warpTextureOffset: [0, 0],
  warpTextureVolumeSliceZ: 0,
  signalBass: 0,
  signalBassAtt: 0,
  signalMid: 0,
  signalMidAtt: 0,
  signalTreb: 0,
  signalTrebAtt: 0,
  // Neutral defaults mirror the CPU VM (vm/shared.ts): the relative energies
  // sit at 1 and the ratio at 0.5 before any audio arrives.
  signalPercussive: 1,
  signalHarmonic: 1,
  signalPercussiveLow: 1,
  signalPercussiveMid: 1,
  signalPercussiveHigh: 1,
  signalPercussiveRatio: 0.5,
  signalBeat: 0,
  signalBeatPulse: 0,
  signalEnergy: 0,
  signalTime: 0,
  signalFrame: 0,
  signalProgress: 0,
  signalFps: 60,
  aspect: [1, 1, 1, 1],
  decay: 0.98,
  scale1: 1,
  bias1: 0,
  scale2: 1,
  bias2: 0,
  scale3: 1,
  bias3: 0,
} as const;

export const COMPOSITE_SHARED_UNIFORM_NAMES = Object.keys(
  COMPOSITE_UNIFORM_BINDINGS,
).filter((name) => COMPOSITE_UNIFORM_BINDINGS[name] === 'shared');

/** Shared deterministic names that have a value in the defaults table. */
export const COMPOSITE_DETERMINISTIC_SHARED_NAMES = Object.keys(
  COMPOSITE_SHARED_UNIFORM_DEFAULTS,
);

/** Convert a plain tuple default to the three.js type both bags use. */
export function compositeSharedDefaultToThree(
  defaultValue: CompositeScalarDefault,
): number | Color | Vector2 | Vector4 {
  if (typeof defaultValue === 'number') return defaultValue;
  const [x, y, z, w] = defaultValue;
  if (w !== undefined) return new Vector4(x, y, z, w);
  if (z !== undefined) return new Color(x, y, z);
  return new Vector2(x, y);
}

/** WebGL ShaderMaterial bag slice: { name: { value } }, from the contract. */
export function compositeSharedUniformDefaultsBag(): Record<
  string,
  { value: unknown }
> {
  const bag: Record<string, { value: unknown }> = {};
  for (const [name, defaultValue] of Object.entries(
    COMPOSITE_SHARED_UNIFORM_DEFAULTS,
  )) {
    bag[name] = { value: compositeSharedDefaultToThree(defaultValue) };
  }
  return bag;
}
