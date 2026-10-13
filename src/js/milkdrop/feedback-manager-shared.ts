/**
 * The frame-feedback pipeline's backend-independent half.
 *
 * MilkDrop's signature look comes from feeding each rendered frame back in as a
 * texture for the next one, warped and faded. This module owns the parts of
 * that pipeline both backends share: blur chain sizing, composite uniform
 * state, and assembly of the fragment shaders a preset's warp and composite
 * source compiles into.
 *
 * `feedback-manager-webgl.ts` and `feedback-manager-webgpu*.ts` build the
 * API-specific resources on top. Prefer adding here — the two backends must
 * produce identical pixels, and shared code is the cheapest way to keep that
 * true.
 *
 * Feedback is stateful across frames, so errors here compound rather than
 * flicker: a small mistake in blur sizing or fade is invisible on frame one and
 * obvious by frame two hundred. Check with `bun run lab:visual`, which runs
 * long enough for accumulation to show.
 */

import {
  extractReferencedCustomSamplers,
  type MilkdropCustomSamplerDeclaration,
} from 'milkdrop-toolchain/src/compiler/custom-samplers.ts';
import {
  extractNativeShaderBody,
  splitShaderGlobalsAndBody,
} from 'milkdrop-toolchain/src/compiler/shader-analysis.ts';
import {
  generateGlslFromShaderStatements,
  injectDirectShaderGlsl,
} from 'milkdrop-toolchain/src/compiler/shader-analysis-glsl.ts';
import { isMilkdropShaderProgramBackendExecutable } from 'milkdrop-toolchain/src/compiler/shader-execution-classification.ts';
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  DoubleSide,
  HalfFloatType,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  type RenderTarget,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector4,
  type WebGLRenderTarget,
} from 'three';
import { isAgentMode } from '../core/agent-api.ts';
import { getSharedMilkdropCapturedVideoTexture } from '../core/services/captured-video-texture.ts';
import { disposeMaterial } from '../utils/three/three-dispose';
import type {
  FeedbackBackendProfile,
  MilkdropBackendBehavior,
} from './backend-behavior';
import {
  MILKDROP_BLEND_DISSOLVE,
  MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD,
} from './feedback-composite-profile.ts';
import { MilkdropFeedbackManagerLifecycleBase } from './feedback-manager-lifecycle.ts';
import { createWebGLFeedbackRenderTarget } from './feedback-render-targets.ts';
import {
  MILKDROP_AUX_SAMPLING_HELPERS,
  MILKDROP_BASE_COMPOSITE_FRAGMENT_SHADER,
  MILKDROP_FEEDBACK_BLEND_FRAGMENT_SHADER,
  MILKDROP_FEEDBACK_WARP_HELPER,
  MILKDROP_NOISE_VOLUME_HELPERS,
  MILKDROP_SHADER_BUILTIN_DECLARATIONS,
  MILKDROP_WARP_FRAGMENT_SHADER,
  MILKDROP_WARP_MESH_FRAGMENT_SHADER,
  MILKDROP_WARP_MESH_VERTEX_SHADER,
  MILKDROP_WARP_UV_FRAGMENT_SHADER,
  MILKDROP_WARP_UV_VERTEX_SHADER,
  Q_UNIFORM_NAMES,
  Q_VAR_NAMES,
} from './feedback-shader-library.ts';
import {
  AUX_TEXTURE_SPECS,
  type AuxTextureName,
  getSharedMilkdropTexture,
  resolveAuxTextureName,
} from './feedback-texture-utils.ts';
import { applyHarmonicPercussiveUniforms } from './harmonic-percussive-shader-signals.ts';
import {
  createMilkdropNoiseTexture,
  createMilkdropNoiseVolumeAtlasTexture,
} from './milkdrop-native-noise.ts';
import { installMilkdropWebglShaderErrorTracking } from './shader-compile-diagnostics.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropShaderProgramPayload,
  MilkdropWarpFieldVisual,
} from './types';

// Generated GLSL per shader-program payload. Payload objects are stable for
// the lifetime of a compiled preset, so caching on identity turns the
// per-frame "did the program change?" comparison into pure string identity.
const generatedGlslCache = new WeakMap<object, string | null>();

function getCachedGlslForShaderProgram(
  program: {
    statements: Parameters<typeof generateGlslFromShaderStatements>[0];
  },
  stage: 'warp' | 'comp',
): string | null {
  if (!generatedGlslCache.has(program)) {
    generatedGlslCache.set(
      program,
      generateGlslFromShaderStatements(program.statements, stage) ?? null,
    );
  }
  return generatedGlslCache.get(program) ?? null;
}

const BLUR_PASS_RADII = [2, 4, 8] as const;

/**
 * Per-level blur pyramid resolution, as a fraction of feedback resolution.
 * MilkDrop 2 allocates its blur textures at 1/2, 1/4, 1/8 of the frame;
 * level 0 was previously full-res here, doubling fill cost on both gaussian
 * passes of the largest level for extra sharpness the reference never had.
 */
const BLUR_LEVEL_SCALES = [0.5, 0.25, 0.125] as const;

const CACHED_BLUR_RANGES = [
  { scale: 1, bias: 0 },
  { scale: 1, bias: 0 },
  { scale: 1, bias: 0 },
];

// Shared ShaderMaterial uniform defaults. The warp and composite materials
// both carry the blur scale/bias range and the signal runtime; keeping them
// as one spread keeps the two material tables from drifting.
const BLUR_RANGE_UNIFORM_DEFAULTS = {
  scale1: { value: 1 },
  bias1: { value: 0 },
  scale2: { value: 1 },
  bias2: { value: 0 },
  scale3: { value: 1 },
  bias3: { value: 0 },
} as const;

const SIGNAL_UNIFORM_DEFAULTS = {
  signalBass: { value: 0 },
  signalMid: { value: 0 },
  signalTreb: { value: 0 },
  signalBassAtt: { value: 0 },
  signalMidAtt: { value: 0 },
  signalTrebAtt: { value: 0 },
  // Neutral defaults mirror the CPU VM (vm/shared.ts): the relative
  // energies sit at 1 and the ratio at 0.5 before any audio arrives.
  signalPercussive: { value: 1 },
  signalHarmonic: { value: 1 },
  signalPercussiveLow: { value: 1 },
  signalPercussiveMid: { value: 1 },
  signalPercussiveHigh: { value: 1 },
  signalPercussiveRatio: { value: 0.5 },
  signalBeat: { value: 0 },
  signalBeatPulse: { value: 0 },
  signalEnergy: { value: 0 },
  signalTime: { value: 0 },
  signalFrame: { value: 0 },
  signalFps: { value: 60 },
} as const;

export function resolveMilkdropBlurShaderRanges(
  variables: Readonly<Record<string, number>> | undefined,
) {
  let min1 = variables?.blur1_min;
  min1 = Number.isFinite(min1) ? (min1 as number) : 0;
  let min2 = variables?.blur2_min;
  min2 = Number.isFinite(min2) ? (min2 as number) : 0;
  let min3 = variables?.blur3_min;
  min3 = Number.isFinite(min3) ? (min3 as number) : 0;

  let max1 = variables?.blur1_max;
  max1 = Number.isFinite(max1) ? (max1 as number) : 1;
  let max2 = variables?.blur2_max;
  max2 = Number.isFinite(max2) ? (max2 as number) : 1;
  let max3 = variables?.blur3_max;
  max3 = Number.isFinite(max3) ? (max3 as number) : 1;

  if (max1 - min1 < 0.1) {
    const midpoint = (min1 + max1) * 0.5;
    min1 = midpoint - 0.05;
    max1 = midpoint + 0.05;
  }

  min2 = Math.max(min2, min1);
  max2 = Math.min(max2, max1);
  if (max2 - min2 < 0.1) {
    const midpoint = (min2 + max2) * 0.5;
    min2 = midpoint - 0.05;
    max2 = midpoint + 0.05;
  }

  min3 = Math.max(min3, min2);
  max3 = Math.min(max3, max2);
  if (max3 - min3 < 0.1) {
    const midpoint = (min3 + max3) * 0.5;
    min3 = midpoint - 0.05;
    max3 = midpoint + 0.05;
  }

  CACHED_BLUR_RANGES[0].scale = max1 - min1;
  CACHED_BLUR_RANGES[0].bias = min1;
  CACHED_BLUR_RANGES[1].scale = max2 - min2;
  CACHED_BLUR_RANGES[1].bias = min2;
  CACHED_BLUR_RANGES[2].scale = max3 - min3;
  CACHED_BLUR_RANGES[2].bias = min3;

  return CACHED_BLUR_RANGES;
}

type CompositeStateUniformBag = Record<string, { value: unknown }>;

/**
 * Copies the composite-loop-facing slice of MilkdropFeedbackCompositeState
 * onto a uniform bag. Shared by the WebGL ShaderMaterial bag and the WebGPU
 * TSL uniform bag so the ~50 scalar/vector assignments cannot drift. Vector
 * uniforms are assigned through the same .set/.setRGB call both materials
 * expose. Texture targets (currentTex/previousTex) and backend-specific
 * extras stay with each manager.
 */
export function applyCompositeUniformState(
  uniforms: CompositeStateUniformBag,
  state: MilkdropFeedbackCompositeState,
  blurShaderRanges: readonly { scale: number; bias: number }[],
) {
  uniforms.scale1.value = blurShaderRanges[0].scale;
  uniforms.bias1.value = blurShaderRanges[0].bias;
  uniforms.scale2.value = blurShaderRanges[1].scale;
  uniforms.bias2.value = blurShaderRanges[1].bias;
  uniforms.scale3.value = blurShaderRanges[2].scale;
  uniforms.bias3.value = blurShaderRanges[2].bias;
  uniforms.videoEchoAlpha.value = state.videoEchoAlpha;
  // Echo is applied at display on both backends; the zoom and orientation
  // ride along with the alpha rather than being applied to the accumulator.
  if (uniforms.videoEchoZoom) {
    uniforms.videoEchoZoom.value = state.videoEchoZoom;
  }
  if (uniforms.videoEchoOrientation) {
    uniforms.videoEchoOrientation.value = state.videoEchoOrientation;
  }
  uniforms.brighten.value = state.brighten;
  uniforms.darken.value = state.darken;
  uniforms.darkenCenter.value = state.darkenCenter;
  uniforms.solarize.value = state.solarize;
  uniforms.invert.value = state.invert;
  uniforms.redBlueStereo.value = state.redBlueStereo ?? 0;
  uniforms.gammaAdj.value = state.gammaAdj;
  uniforms.textureWrap.value = state.textureWrap;
  uniforms.decay.value = state.decay;
  uniforms.warpScale.value = state.warpScale;
  uniforms.offsetX.value = state.offsetX;
  uniforms.offsetY.value = state.offsetY;
  uniforms.rotation.value = state.rotation;
  uniforms.zoomMul.value = state.zoomMul;
  uniforms.saturation.value = state.saturation;
  uniforms.contrast.value = state.contrast;
  (
    uniforms.colorScale.value as {
      setRGB(r: number, g: number, b: number): void;
    }
  ).setRGB(state.colorScale.r, state.colorScale.g, state.colorScale.b);
  uniforms.hueShift.value = state.hueShift;
  uniforms.brightenBoost.value = state.brightenBoost;
  uniforms.invertBoost.value = state.invertBoost;
  uniforms.solarizeBoost.value = state.solarizeBoost;
  uniforms.vignette.value = state.vignette ?? 0;
  uniforms.chromaticAberration.value = state.chromaticAberration ?? 0;
  (
    uniforms.tint.value as { setRGB(r: number, g: number, b: number): void }
  ).setRGB(state.tint.r, state.tint.g, state.tint.b);
  uniforms.overlayTextureSource.value = state.overlayTextureSource;
  uniforms.overlayTextureMode.value = state.overlayTextureMode;
  uniforms.overlayTextureSampleDimension.value =
    state.overlayTextureSampleDimension;
  uniforms.overlayTextureInvert.value = state.overlayTextureInvert;
  uniforms.overlayTextureAmount.value = state.overlayTextureAmount;
  (
    uniforms.overlayTextureScale.value as {
      set(x: number, y: number): void;
    }
  ).set(state.overlayTextureScale.x, state.overlayTextureScale.y);
  (
    uniforms.overlayTextureOffset.value as {
      set(x: number, y: number): void;
    }
  ).set(state.overlayTextureOffset.x, state.overlayTextureOffset.y);
  uniforms.overlayTextureVolumeSliceZ.value = state.overlayTextureVolumeSliceZ;
  uniforms.warpTextureSource.value = state.warpTextureSource;
  uniforms.warpTextureSampleDimension.value = state.warpTextureSampleDimension;
  uniforms.warpTextureAmount.value = state.warpTextureAmount;
  (
    uniforms.warpTextureScale.value as {
      set(x: number, y: number): void;
    }
  ).set(state.warpTextureScale.x, state.warpTextureScale.y);
  (
    uniforms.warpTextureOffset.value as {
      set(x: number, y: number): void;
    }
  ).set(state.warpTextureOffset.x, state.warpTextureOffset.y);
  uniforms.warpTextureVolumeSliceZ.value = state.warpTextureVolumeSliceZ;
  uniforms.signalBass.value = state.signalBass;
  uniforms.signalMid.value = state.signalMid;
  uniforms.signalTreb.value = state.signalTreb;
  uniforms.signalBassAtt.value = state.signalBassAtt ?? state.signalBass;
  uniforms.signalMidAtt.value = state.signalMidAtt ?? state.signalMid;
  uniforms.signalTrebAtt.value = state.signalTrebAtt ?? state.signalTreb;
  applyHarmonicPercussiveUniforms(uniforms, state);
  uniforms.signalBeat.value = state.signalBeat;
  uniforms.signalBeatPulse.value = state.signalBeatPulse;
  uniforms.signalEnergy.value = state.signalEnergy;
  uniforms.signalTime.value = state.signalTime;
  uniforms.signalFrame.value = state.signalFrame ?? 0;
  uniforms.signalFps.value = state.signalFps ?? 60;
}

const FULLSCREEN_QUAD_GEOMETRY = new PlaneGeometry(2, 2);

type FeedbackFrameRenderer = {
  render(scene: Scene, camera: Camera): void;
  setRenderTarget?: (target: RenderTarget | null) => void;
  /** Present on WebGLRenderer; optional so test doubles stay simple. */
  getClearAlpha?: () => number;
  setClearAlpha?: (alpha: number) => void;
  getClearColor?: (target: Color) => Color;
  setClearColor?: (color: Color | number, alpha?: number) => void;
};

type SharedAuxTextureMap = Record<AuxTextureName | 'video', Texture>;

// The built-in aux samplers (noise/perlin/simplex/voronoi/aura/caustics/
// pattern/fractal) used to be backed by a procedural RGB-independent noise
// texture (noise/perlin/simplex) or a flat gray placeholder (the rest) —
// none of them loaded the real asset PNGs at all. sampleAuxTexture's
// dimension>=0.5 branch (atlasSliceUv / slice blending) already assumes an
// 8x8 depth-atlas layout, and the PNGs in public/textures ARE laid out that
// way (the same files WebGPU's Data3DTexture path decodes tile-by-tile via
// buildAtlasVolumeData) — so tex3D() sampling only needs the loaded PNG
// itself as a plain 2D texture, no atlas-building step required. Routing
// through the real assets here is what makes noisevol-style presets read as
// the intended grayscale marble instead of full-RGB confetti (WebGPU
// already samples the same PNGs via its native Data3DTexture path).
/**
 * projectM generates its noise in code rather than shipping it as an asset:
 * `noise_lq` is a 256x256 grayscale white-noise texture and `noisevol` a
 * 32^3 volume of the same, both GL_REPEAT + GL_LINEAR (PerlinNoise.cpp,
 * TextureManager.cpp). Our `noise` slot loads seamless_perlin_noise.png,
 * which is smooth — which is why 260-compshader-noise_lq rendered marbled
 * blobs where the reference is fine static.
 *
 * Memoized at module scope: getSharedAuxTextures runs per feedback manager,
 * and a texture per instance would leak one per preset switch.
 */
let nativeNoiseTexture: Texture | null = null;
let nativeNoiseVolumeTexture: Texture | null = null;

function sharedNativeNoiseTexture(): Texture {
  if (!nativeNoiseTexture) {
    nativeNoiseTexture = createMilkdropNoiseTexture();
  }
  return nativeNoiseTexture;
}

function sharedNativeNoiseVolumeTexture(): Texture {
  if (!nativeNoiseVolumeTexture) {
    nativeNoiseVolumeTexture = createMilkdropNoiseVolumeAtlasTexture();
  }
  return nativeNoiseVolumeTexture;
}

function getSharedAuxTextures(): SharedAuxTextureMap {
  const auxTextures = {} as Record<AuxTextureName, Texture>;
  for (const name of Object.keys(AUX_TEXTURE_SPECS) as AuxTextureName[]) {
    const spec = AUX_TEXTURE_SPECS[name];
    auxTextures[name] = getSharedMilkdropTexture(
      spec.fileName,
      spec.colorTexture,
    );
  }
  return {
    ...auxTextures,
    video: getSharedMilkdropCapturedVideoTexture(),
  };
}

/** Reused so reading the clear colour each frame allocates nothing. */
const SCENE_CLEAR_COLOR_SCRATCH = /* @__PURE__ */ new Color();

/** The subset of a renderer the scene pass needs; test doubles stay simple. */
export type FeedbackSceneRenderer = {
  render(scene: Scene, camera: Camera): void;
  setRenderTarget: (target: RenderTarget | null) => void;
  getClearAlpha?: () => number;
  setClearAlpha?: (alpha: number) => void;
  getClearColor?: (target: Color) => Color;
  setClearColor?: (color: Color | number, alpha?: number) => void;
};

/**
 * Draw the fresh scene into the feedback loop's scene target so its alpha
 * means "geometry drew here".
 *
 * Both renderers are built with `alpha: false`, which sets three.js's
 * clearAlpha to 1, and `Scene.background` is painted opaquely across the
 * target before anything else draws. Between them the scene pass came back
 * fully opaque, so the blend that follows could not tell a covered pixel from
 * an empty one and replaced the whole feedback history every frame. The
 * background is a display concern, not part of the loop.
 *
 * Black, not merely transparent: the blend adds `current.rgb` straight, and
 * the app's clear colour is a themed tint, so a transparent-but-tinted clear
 * painted that tint into the feedback loop.
 */
export function renderSceneIntoFeedbackTarget(
  renderer: FeedbackSceneRenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget,
): void {
  const previousClearAlpha = renderer.getClearAlpha?.() ?? 1;
  const previousClearColor = renderer.getClearColor?.(
    SCENE_CLEAR_COLOR_SCRATCH,
  );
  const previousBackground = scene.background;
  scene.background = null;
  renderer.setClearColor?.(0x000000, 0);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  if (previousClearColor) {
    renderer.setClearColor?.(previousClearColor, previousClearAlpha);
  } else {
    renderer.setClearAlpha?.(previousClearAlpha);
  }
  scene.background = previousBackground;
}

/**
 * Builds the final WebGL fragment shaders for a preset's direct warp/comp
 * GLSL, exactly as they are handed to the ShaderMaterials at runtime. The
 * raw shader bodies assume MilkDrop globals (`uv`, `uv_orig`, `ret`, `rad`,
 * `ang`, q vars, `aspect`) are in scope; the templates provide them.
 */
/**
 * Texture-pack samplers referenced by the injected GLSL have no uniform in
 * the fragment templates; each needs a `uniform sampler2D` declaration or
 * the shader fails to compile. Bindings come from the customSamplers loop
 * in setDirectShaderPrograms, which resolves the same names.
 */
function buildCustomSamplerUniformDeclarations(
  fragments: Array<string | null>,
): string {
  const names = new Set<string>();
  for (const fragment of fragments) {
    for (const sampler of extractReferencedCustomSamplers(fragment)) {
      names.add(sampler.name);
    }
  }
  return [...names].map((name) => `uniform sampler2D ${name};\n`).join('');
}

const MILKDROP_GLSL_RESERVED_WORDS = new Set(
  `
    attribute const uniform varying buffer shared
    atomic_uint layout centroid flat smooth
    in out inout invariant discard return
    break continue do for while switch case default
    if else struct void bool int uint float double
    vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4
    mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4
    sampler1D sampler2D sampler3D samplerCube sampler1DShadow sampler2DShadow
    samplerCubeShadow sampler1DArray sampler2DArray sampler1DArrayShadow sampler2DArrayShadow
    sampler2DMS sampler2DMSArray samplerCubeArray samplerCubeArrayShadow
    isampler1D isampler2D isampler3D isamplerCube isampler1DArray isampler2DArray
    usampler1D usampler2D usampler3D usamplerCube usampler1DArray usampler2DArray
    precision highp mediump lowp
    gl_FragColor gl_FragCoord gl_FragDepth gl_FrontFacing gl_PointCoord
    gl_Position gl_PointSize gl_VertexID gl_InstanceID
    true false
    abs acos all any asin atan ceil clamp cos cross dFdx dFdy degrees determinant
    distance dot equal exp exp2 faceforward floor fract fwidth greaterThan
    greaterThanEqual inversesqrt isinf isnan length lessThan lessThanEqual log log2
    matrixCompMult max min mix mod not notEqual outerProduct pow radians reflect
    refract round sign sin sinh smoothstep sqrt step tan tanh transpose trunc
  `
    .split(/\s+/)
    .filter(Boolean),
);

const MILKDROP_SWIZZLE_IDENTIFIER = /^[xyzw]{1,4}$/u;
const MILKDROP_TYPE_DECLARATION =
  /\b(?:void|bool|int|uint|float|double|vec[234]|bvec[234]|ivec[234]|uvec[234]|mat[234])\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|;|\))/gu;

function stripShaderComments(text: string): string {
  return text.replace(/\/\/[^\n]*/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
}

/**
 * MilkDrop per-frame variables (`trelx`, `tele`, `vshift`, …) are shader
 * globals in the reference engine: per_frame code writes them every frame and
 * shader bodies read them. The WebGL templates declare q-registers, signals,
 * and the built-in shader controls but not these arbitrary names, so a shader
 * body that references one fails to compile (e.g. `trelx` in
 * martin-alien-grand-theft-water). Collect the identifiers the injected
 * bodies reference that the templates do not already provide, so they can be
 * declared as `uniform float` and driven from the per-frame VM state.
 */
function extractReferencedPerFrameVariables(
  fragments: Array<string | null>,
): string[] {
  const declared = new Set<string>(MILKDROP_GLSL_RESERVED_WORDS);
  const templates = [
    MILKDROP_WARP_FRAGMENT_SHADER,
    MILKDROP_BASE_COMPOSITE_FRAGMENT_SHADER,
    MILKDROP_FEEDBACK_BLEND_FRAGMENT_SHADER,
    MILKDROP_SHADER_BUILTIN_DECLARATIONS,
    MILKDROP_AUX_SAMPLING_HELPERS,
    MILKDROP_NOISE_VOLUME_HELPERS,
    MILKDROP_FEEDBACK_WARP_HELPER,
  ];
  for (const template of templates) {
    const clean = stripShaderComments(template);
    // Only global-scope declarations count as "already available" — a blind
    // scan of every identifier in the template text previously also picked
    // up helper functions' own local variables (e.g. noise()'s own
    // `float d = hash(...)`), which then silently blocked a fresh
    // declaration for an injected body's unrelated `d` scratch variable,
    // producing "undeclared identifier" instead (~111/975 corpus-scan
    // failures shared this one collision).
    for (const match of clean.matchAll(
      /\b(?:uniform|varying|attribute)\s+(?:highp|mediump|lowp\s+)?\w+\s+([a-zA-Z_][a-zA-Z0-9_]*)/gu,
    )) {
      declared.add(match[1]);
    }
    for (const match of clean.matchAll(
      /#define\s+([a-zA-Z_][a-zA-Z0-9_]*)/gu,
    )) {
      declared.add(match[1]);
    }
    // Function definitions at file scope, so a preset body that happens to
    // share a name with a helper (rare, but a real collision is a compile
    // error either way) doesn't get a duplicate declaration.
    for (const match of clean.matchAll(
      /\b(?:void|bool|int|uint|float|double|vec[234]|bvec[234]|ivec[234]|uvec[234]|mat[234])\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gu,
    )) {
      declared.add(match[1]);
    }
  }

  const found = new Set<string>();
  for (const fragment of fragments) {
    if (!fragment) {
      continue;
    }
    const clean = stripShaderComments(fragment);
    const locals = new Set<string>();
    for (const match of clean.matchAll(MILKDROP_TYPE_DECLARATION)) {
      locals.add(match[1]);
    }
    for (const match of clean.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/gu)) {
      const id = match[1];
      const nextChar = clean[match.index + id.length];
      if (
        MILKDROP_SWIZZLE_IDENTIFIER.test(id) ||
        id.startsWith('sampler_') ||
        id.startsWith('_') ||
        declared.has(id) ||
        locals.has(id) ||
        nextChar === '('
      ) {
        continue;
      }
      found.add(id);
    }
  }
  return [...found].sort();
}

/** Sizes of the multi-component builtins a scratch variable's first
 * assignment might swizzle off of (e.g. `d = texsize.zw * 8.0`) — used to
 * infer that variable's own type below. */
const MILKDROP_KNOWN_VECTOR_SIZES: Record<string, number> = {
  aspect: 4,
  _qa: 4,
  _qb: 4,
  _qc: 4,
  _qd: 4,
  _qe: 4,
  _qf: 4,
  _qg: 4,
  _qh: 4,
  rand_preset: 4,
  texsize: 4,
  colorScale: 3,
  tint: 3,
  texelSize: 2,
  overlayTextureScale: 2,
  overlayTextureOffset: 2,
  warpTextureScale: 2,
  warpTextureOffset: 2,
};

/** Declaration for one name extractReferencedPerFrameVariables found: either
 * a genuine per-frame register (VM-driven, read by the shader, declared as a
 * `uniform`) or a scratch variable the injected body itself initializes
 * before ever reading (declared as a plain global — GLSL has no local-var
 * hoisting requirement here, and each fragment invocation gets its own copy). */
type MilkdropPerFrameDeclaration = {
  name: string;
  isLocalScratch: boolean;
  type: 'float' | 'int' | 'vec2' | 'vec3' | 'vec4';
};

/**
 * A name extractReferencedPerFrameVariables finds is a genuine per-frame
 * *register* — MilkDrop's `trelx`/`tele`/`vshift`-style globals, written by
 * per_frame EEL code and only ever read here — only if the shader body reads
 * it before (or without) ever assigning to it. When the FIRST occurrence is
 * an assignment (`name = …` or `name.xyz = …`), the preset author is using
 * `name` as their own scratch variable (e.g. `col`, `light_pos`, `plastic`
 * in cotc-suksma-mtn-flx-flacc) — declaring that `uniform` makes every
 * assignment to it a compile error ("can't modify a uniform"), which was the
 * single largest class of GLSL corpus scan failures (~360/975).
 *
 * Type is inferred from how the variable is first used, in priority order:
 * a direct `name = vecN(...)` constructor; the widest single-component
 * swizzle ever assigned to it (`name.z = …` implies at least vec3); a
 * swizzle applied to a known multi-component builtin on its first
 * assignment's right-hand side (`texsize.zw` implies vec2). A scalar whose
 * every bare assignment is an integer literal or an `int(...)` cast is an
 * `int`: the bundled Butterchurn bodies come from hlsl2glsl, whose output
 * lost the `int xlat_mutablen;` declarations for loop counters, and GLSL ES
 * has no implicit int→float conversion — declared float, `n = 0;` and
 * `n < 6` fail to compile, which blanked amandio-c-fume, flexi-can-t-think-
 * of-mosaic-cages, lit-claw-explorers-grid-… and martin-elusive-impressions-
 * mix1 on WebGL (2026-09-15). Defaults to float, which is always safe for
 * genuinely scalar scratch registers and no worse than the previous
 * "uniform float" default otherwise.
 */
function classifyPerFrameVariable(
  name: string,
  fragments: Array<string | null>,
  hoistedSizes: ReadonlyMap<string, number> = new Map(),
): MilkdropPerFrameDeclaration {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  // Compound writes (`mus *= vec3(1.1, 1.0, 0.95)`) are sizing evidence
  // too; they only never count as the variable's *first* use being a read.
  const occurrence = new RegExp(
    `\\b${escaped}\\b(?:\\.([xyzwrgba]{1,4}))?\\s*([-+*/]?=(?!=))?`,
    'gu',
  );
  let firstIsAssignment: boolean | null = null;
  let widestComponentIndex = -1;
  let constructorSize: number | null = null;
  let bareAssignments = 0;
  let integerAssignments = 0;
  const componentIndex: Record<string, number> = {
    x: 0,
    y: 1,
    z: 2,
    w: 3,
    r: 0,
    g: 1,
    b: 2,
    a: 3,
  };

  for (const fragment of fragments) {
    if (!fragment) {
      continue;
    }
    const clean = stripShaderComments(fragment);
    for (const match of clean.matchAll(occurrence)) {
      const swizzle = match[1];
      const operator = match[2];
      const isAssignment = operator === '=';
      if (firstIsAssignment === null) {
        firstIsAssignment = isAssignment;
      }
      if (!operator) {
        continue;
      }
      if (!isAssignment) {
        // Compound write: size from a depth-0 vector constructor only.
        const restFrom = match.index + match[0].length;
        const end = clean.indexOf(';', restFrom);
        const rhs = clean.slice(restFrom, end === -1 ? undefined : end);
        for (const ctorMatch of rhs.matchAll(/\bvec([234])\s*\(/gu)) {
          if (widthPreservingDepthAt(rhs, ctorMatch.index ?? 0) !== 0) continue;
          widestComponentIndex = Math.max(
            widestComponentIndex,
            Number(ctorMatch[1]) - 1,
          );
        }
        continue;
      }
      if (swizzle) {
        for (const component of swizzle) {
          widestComponentIndex = Math.max(
            widestComponentIndex,
            componentIndex[component] ?? -1,
          );
        }
        continue;
      }
      // Bare `name = …` — check the right-hand side for a direct vecN(...)
      // constructor, else a swizzle off a known multi-component identifier.
      const restFrom = match.index + match[0].length;
      const statementEnd = clean.indexOf(';', restFrom);
      const rhs = clean.slice(
        restFrom,
        statementEnd === -1 ? undefined : statementEnd,
      );
      bareAssignments += 1;
      if (/^\s*(?:-?\d+|int\s*\(.*\))\s*$/u.test(rhs)) {
        integerAssignments += 1;
      }
      // A constructor sizes the variable only when it is the whole RHS:
      // `d = vec4(1.0 / texelSize, texelSize).zw` is a vec2.
      const constructorMatch = rhs.match(/^\s*vec([234])\s*\(/u);
      if (
        constructorMatch &&
        rhs
          .slice(closingParenIndex(rhs, constructorMatch[0].length - 1) + 1)
          .trim() === ''
      ) {
        constructorSize = Math.max(
          constructorSize ?? 0,
          Number(constructorMatch[1]),
        );
        continue;
      }
      // Only a swizzle at the RHS's top level sizes the variable: in
      // `l2 = lum(texture2D(…).xyz * scale1 + bias1)` the `.xyz` is an
      // argument, and the result is lum()'s float. Counting it declared l2
      // vec3 and failed the scalar assignment.
      for (const knownMatch of rhs.matchAll(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([xyzwrgba]{1,4})\b/gu,
      )) {
        const knownSize = MILKDROP_KNOWN_VECTOR_SIZES[knownMatch[1]];
        if (knownSize && parenDepthAt(rhs, knownMatch.index ?? 0) === 0) {
          widestComponentIndex = Math.max(
            widestComponentIndex,
            knownMatch[2].length - 1,
          );
        }
      }
      // A swizzle directly off an inline constructor call — e.g. the
      // translated-statement emitter's own texsize expansion,
      // `vec4(1.0 / texelSize, texelSize).zw` — carries the same size
      // signal as a named-identifier swizzle but the regex above requires a
      // bare identifier before the dot, so it won't match a `)` there.
      // A bare vector at call depth 0 carries its width into the result —
      // `d_uv = uv;`, `uv1 = uv - vec2(0.5, q5);` — as does a constructor
      // there that no swizzle narrows. Without this those were hoisted as
      // float and the assignment failed to compile.
      for (const bareMatch of rhs.matchAll(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*[.(])/gu,
      )) {
        const size =
          MILKDROP_BARE_VECTOR_SIZES[bareMatch[1]] ??
          MILKDROP_KNOWN_VECTOR_SIZES[bareMatch[1]] ??
          hoistedSizes.get(bareMatch[1]);
        if (size && widthPreservingDepthAt(rhs, bareMatch.index ?? 0) === 0) {
          widestComponentIndex = Math.max(widestComponentIndex, size - 1);
        }
      }
      for (const ctorMatch of rhs.matchAll(/\bvec([234])\s*\(/gu)) {
        const start = ctorMatch.index ?? 0;
        if (parenDepthAt(rhs, start) !== 0) continue;
        const close = closingParenIndex(rhs, start + ctorMatch[0].length - 1);
        if (/^\s*\./u.test(rhs.slice(close + 1))) continue;
        widestComponentIndex = Math.max(
          widestComponentIndex,
          Number(ctorMatch[1]) - 1,
        );
      }
      for (const inlineMatch of rhs.matchAll(/\)\.([xyzwrgba]{1,4})\b/gu)) {
        // Depth after the closing paren: 0 means the swizzled call is not
        // itself an argument to another call.
        if (parenDepthAt(rhs, (inlineMatch.index ?? 0) + 1) !== 0) continue;
        widestComponentIndex = Math.max(
          widestComponentIndex,
          inlineMatch[1].length - 1,
        );
      }
    }
  }

  if (!firstIsAssignment) {
    return { name, isLocalScratch: false, type: 'float' };
  }
  const inferredSize = constructorSize ?? widestComponentIndex + 1;
  if (
    inferredSize <= 1 &&
    bareAssignments > 0 &&
    integerAssignments === bareAssignments
  ) {
    return { name, isLocalScratch: true, type: 'int' };
  }
  const type =
    inferredSize >= 4
      ? 'vec4'
      : inferredSize === 3
        ? 'vec3'
        : inferredSize === 2
          ? 'vec2'
          : 'float';
  return { name, isLocalScratch: true, type };
}

/** Calls whose result has the width of their (first) argument. */
const WIDTH_PRESERVING_CALLS = new Set([
  'abs',
  'sign',
  'floor',
  'ceil',
  'fract',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'exp',
  'exp2',
  'log',
  'log2',
  'sqrt',
  'inversesqrt',
  'normalize',
  'clamp',
  'min',
  'max',
  'mix',
  'step',
  'smoothstep',
  'mod',
  'pow',
  'saturate',
  'milkdropLerp',
  'milkdropMax',
  'milkdropMin',
  'milkdropPow',
  'milkdropAdd',
  'milkdropSub',
  'milkdropMul',
  'milkdropDiv',
]);

/**
 * parenDepthAt, but a width-preserving call is transparent: `uvn` inside
 * `clamp(tan(z) * uvn, -5.0, 5.0)` still decides the result's width.
 */
function widthPreservingDepthAt(text: string, index: number): number {
  const stack: boolean[] = [];
  for (let i = 0; i < index; i += 1) {
    const char = text[i];
    if (char === '(') {
      const callee = /([A-Za-z_]\w*)\s*$/u.exec(text.slice(0, i))?.[1];
      stack.push(Boolean(callee) && !WIDTH_PRESERVING_CALLS.has(callee ?? ''));
    } else if (char === ')') {
      stack.pop();
    }
  }
  return stack.filter(Boolean).length;
}

/** Template-owned vectors a body reads bare: the stage coordinate and output. */
const MILKDROP_BARE_VECTOR_SIZES: Readonly<Record<string, number>> = {
  uv: 2,
  vUv: 2,
  uv_orig: 2,
  ret: 3,
};

/** Index of the `)` closing the `(` at `open`, or the text's end. */
function closingParenIndex(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/**
 * Unclosed *call* parens before `index` in `text` — a `(` directly after an
 * identifier. Grouping parens don't count: `(tex.xyz * s + b)` is still the
 * vector, `lum(tex.xyz)` is not.
 */
function parenDepthAt(text: string, index: number): number {
  const stack: boolean[] = [];
  for (let i = 0; i < index; i += 1) {
    const char = text[i];
    if (char === '(') {
      stack.push(/[A-Za-z0-9_]\s*$/u.test(text.slice(0, i)));
    } else if (char === ')') {
      stack.pop();
    }
  }
  return stack.filter(Boolean).length;
}

function buildPerFrameVariableDeclarations(
  names: string[],
  fragments: Array<string | null>,
): string {
  // A scratch variable copied from another (`denominator = product;`) takes
  // that one's width, so classify to a fixed point: each pass can size
  // names whose sources the previous pass sized. Bounded by the chain
  // length; four passes cover every chain in the corpus.
  const sizes = new Map<string, number>();
  let decls = names.map((name) => classifyPerFrameVariable(name, fragments));
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const decl of decls) {
      const size = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4 }[decl.type];
      if (decl.isLocalScratch && size > 1 && sizes.get(decl.name) !== size) {
        sizes.set(decl.name, size);
        changed = true;
      }
    }
    if (!changed) break;
    decls = names.map((name) =>
      classifyPerFrameVariable(name, fragments, sizes),
    );
  }
  return decls
    .map((decl) =>
      decl.isLocalScratch
        ? `${decl.type} ${decl.name};\n`
        : `uniform float ${decl.name};\n`,
    )
    .join('');
}

export function assembleMilkdropDirectFragmentShaders(
  warpGlsl: string | null,
  compGlsl: string | null,
): { warp: string; composite: string; perFrameVariables: string[] } {
  const cleanWarpBody = warpGlsl
    ? (extractNativeShaderBody(warpGlsl) ?? warpGlsl)
    : null;

  // Split function declarations (which must live at global scope) from
  // body statements (which run inside main()).
  let warpGlobals: string | null = null;
  let warpBody = cleanWarpBody;
  if (cleanWarpBody) {
    const split = splitShaderGlobalsAndBody(cleanWarpBody);
    warpGlobals = split.globals || null;
    warpBody = split.body || null;
  }

  const rawCompBody = compGlsl
    ? (extractNativeShaderBody(compGlsl) ?? compGlsl)
    : null;

  // In the comp stage sampler_main means the current *composited* frame, but
  // the sampler rewrite mapped it to currentTex, which the composite pass
  // binds to the geometry-only scene texture. Retarget those samples to the
  // sampleCompFrame reconstruction (warped feedback + geometry) so comp
  // bodies stop discarding the feedback trail. Only the call head changes;
  // the coordinate argument and closing paren carry over untouched.
  const cleanCompBody = rawCompBody
    ? rawCompBody.replace(
        /\btexture2D\s*\(\s*currentTex\s*,/gu,
        'sampleCompFrame(',
      )
    : null;

  const warpFragments = [warpGlobals, warpBody];
  const compFragments = [cleanCompBody];
  const perFrameVariables = extractReferencedPerFrameVariables([
    ...warpFragments,
    ...compFragments,
  ]);
  // Declarations are built per-stage (from only that stage's own fragments)
  // rather than sharing one declaration block across both assembled
  // shaders: a name classified as local scratch in warp could legitimately
  // be a genuine read-only per-frame register in comp (or vice versa), and
  // a shared declaration would silently turn that stage's uniform read into
  // an always-zero local instead of failing to compile — trading a loud
  // compile error for a silent visual bug.
  const warpPerFrameVariableDeclarations = buildPerFrameVariableDeclarations(
    perFrameVariables,
    warpFragments,
  );
  const compPerFrameVariableDeclarations = buildPerFrameVariableDeclarations(
    perFrameVariables,
    compFragments,
  );

  const warp =
    warpPerFrameVariableDeclarations +
    buildCustomSamplerUniformDeclarations([warpGlobals, warpBody]) +
    injectDirectShaderGlsl(
      MILKDROP_WARP_FRAGMENT_SHADER,
      warpBody,
      null,
      warpGlobals,
    );

  // Build composite shader: warp section kept empty since warp runs separate
  const composite =
    compPerFrameVariableDeclarations +
    buildCustomSamplerUniformDeclarations([cleanCompBody]) +
    injectDirectShaderGlsl(
      MILKDROP_BASE_COMPOSITE_FRAGMENT_SHADER,
      null,
      cleanCompBody,
    );

  return { warp, composite, perFrameVariables };
}

class SharedMilkdropFeedbackManager
  extends MilkdropFeedbackManagerLifecycleBase<WebGLRenderTarget>
  implements MilkdropFeedbackManager
{
  readonly compositeScene = new Scene();
  readonly presentScene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  readonly compositeMaterial: ShaderMaterial;
  readonly presentMaterial: ShaderMaterial;
  readonly sceneTarget: WebGLRenderTarget;
  readonly warpTarget: WebGLRenderTarget;
  readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  readonly displayTarget: WebGLRenderTarget;
  readonly feedbackBlendMaterial: ShaderMaterial;
  readonly feedbackBlendScene: Scene;
  readonly blurTargets: [
    WebGLRenderTarget,
    WebGLRenderTarget,
    WebGLRenderTarget,
  ];
  readonly blurHTargets: [
    WebGLRenderTarget,
    WebGLRenderTarget,
    WebGLRenderTarget,
  ];
  readonly blurHMaterial: ShaderMaterial;
  readonly blurVMaterial: ShaderMaterial;
  readonly blurQuad: Mesh;
  readonly blurScene: Scene;
  // Snapshots ping-pong: one taken mid-blend draws the present pass, which
  // samples the current snapshot, so it has to land in the other slot.
  private savedFrameTargets: [
    WebGLRenderTarget | null,
    WebGLRenderTarget | null,
  ] = [null, null];
  private savedFrameIndex = 0;
  /** Resamples one target into another; see copyTargetImage. */
  private copyPass: { scene: Scene; material: ShaderMaterial } | null = null;
  private readonly halfFloatFeedback: boolean;
  private lastRenderer: {
    render(scene: Scene, camera: Camera): void;
    setRenderTarget?: (target: WebGLRenderTarget | null) => void;
    getRenderTarget?: () => WebGLRenderTarget | null;
    clear?: () => void;
    getClearAlpha?: () => number;
    setClearAlpha?: (alpha: number) => void;
    getClearColor?: (target: Color) => Color;
    setClearColor?: (color: Color | number, alpha?: number) => void;
  } | null = null;
  readonly profile: FeedbackBackendProfile;
  readonly auxTextures: SharedAuxTextureMap;
  private blurEnabled = false;
  private lastWarpGlsl: string | null = null;
  private lastCompGlsl: string | null = null;
  /** Bumped per shader swap so a stale async warm-up can't apply. */
  private directShaderSwapRevision = 0;
  /** True while the async warp/comp warm-up has landed the pass-through
   * pair but not yet the preset's own shaders — the window the transition
   * controller keeps covered. */
  private directShaderSwapPending = false;

  isDirectShaderSwapPending(): boolean {
    return this.directShaderSwapPending;
  }
  /** Warm-up materials kept alive until the live materials share their
   * programs; see setDirectShaderPrograms. */
  private retiredWarmupMaterials: ShaderMaterial[] = [];
  private perFrameShaderVariables: string[] = [];
  private customSamplers: MilkdropCustomSamplerDeclaration[] = [];
  readonly warpMaterial: ShaderMaterial;
  readonly warpScene: Scene;
  readonly warpMeshMaterial: ShaderMaterial;
  readonly warpMeshGeometry: BufferGeometry;
  readonly warpMeshScene: Scene;
  /** The gather lattice rasterised to per-pixel sample coordinates, for warp
   * shaders. See MILKDROP_WARP_UV_FRAGMENT_SHADER. */
  readonly warpUvTarget: WebGLRenderTarget;
  readonly warpUvGeometry: BufferGeometry;
  readonly warpUvScene: Scene;
  private warpFieldDensity = 0;
  private warpFieldReady = false;

  constructor(
    width: number,
    height: number,
    behavior: MilkdropBackendBehavior,
  ) {
    super(width, height, behavior.feedbackProfile);
    this.camera.position.z = 1;
    this.profile = behavior.feedbackProfile;
    this.auxTextures = getSharedAuxTextures();
    this.halfFloatFeedback = behavior.useHalfFloatFeedback;
    this.sceneTarget = createWebGLFeedbackRenderTarget(width, height, {
      resolutionScale: this.sceneResolutionScale,
      useHalfFloatFeedback: behavior.useHalfFloatFeedback,
      samples: this.profile.samples,
    });
    this.warpTarget = createWebGLFeedbackRenderTarget(width, height, {
      resolutionScale: this.currentFeedbackResolutionScale,
      useHalfFloatFeedback: behavior.useHalfFloatFeedback,
      samples: 1,
    });
    // Half-float regardless of the feedback format: these are coordinates,
    // and 8 bits would quantise them to 1/255 of the frame.
    this.warpUvTarget = createWebGLFeedbackRenderTarget(width, height, {
      resolutionScale: this.currentFeedbackResolutionScale,
      useHalfFloatFeedback: true,
      samples: 1,
    });
    this.targets = [
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale: this.currentFeedbackResolutionScale,
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: this.profile.samples,
      }),
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale: this.currentFeedbackResolutionScale,
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: this.profile.samples,
      }),
    ];
    this.displayTarget = createWebGLFeedbackRenderTarget(width, height, {
      resolutionScale: this.currentFeedbackResolutionScale,
      useHalfFloatFeedback: behavior.useHalfFloatFeedback,
      samples: this.profile.samples,
    });
    this.blurTargets = [
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale:
          this.currentFeedbackResolutionScale * BLUR_LEVEL_SCALES[0],
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: 1,
      }),
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale:
          this.currentFeedbackResolutionScale * BLUR_LEVEL_SCALES[1],
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: 1,
      }),
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale:
          this.currentFeedbackResolutionScale * BLUR_LEVEL_SCALES[2],
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: 1,
      }),
    ];
    this.blurHTargets = [
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale:
          this.currentFeedbackResolutionScale * BLUR_LEVEL_SCALES[0],
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: 1,
      }),
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale:
          this.currentFeedbackResolutionScale * BLUR_LEVEL_SCALES[1],
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: 1,
      }),
      createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale:
          this.currentFeedbackResolutionScale * BLUR_LEVEL_SCALES[2],
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: 1,
      }),
    ];
    const blurVertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    this.blurHMaterial = new ShaderMaterial({
      uniforms: {
        sourceTex: { value: null },
        texelSize: { value: new Vector2(1, 1) },
        radius: { value: 2 },
      },
      vertexShader: blurVertexShader,
      fragmentShader: `
        uniform sampler2D sourceTex;
        uniform vec2 texelSize;
        uniform float radius;
        varying vec2 vUv;
        void main() {
          // Symmetric taps with an early break: the old -8..8 walk ran all
          // 17 iterations (with a continue) even for the radius-2 pass.
          vec4 result = texture2D(sourceTex, vUv);
          float totalWeight = 1.0;
          for (float x = 1.0; x <= 8.0; x += 1.0) {
            if (x > radius) break;
            vec2 offset = vec2(x * texelSize.x, 0.0);
            result += texture2D(sourceTex, vUv + offset);
            result += texture2D(sourceTex, vUv - offset);
            totalWeight += 2.0;
          }
          gl_FragColor = result / totalWeight;
        }
      `,
    });
    this.blurVMaterial = new ShaderMaterial({
      uniforms: {
        sourceTex: { value: null },
        texelSize: { value: new Vector2(1, 1) },
        radius: { value: 2 },
      },
      vertexShader: blurVertexShader,
      fragmentShader: `
        uniform sampler2D sourceTex;
        uniform vec2 texelSize;
        uniform float radius;
        varying vec2 vUv;
        void main() {
          // Symmetric taps with an early break; see the horizontal pass.
          vec4 result = texture2D(sourceTex, vUv);
          float totalWeight = 1.0;
          for (float y = 1.0; y <= 8.0; y += 1.0) {
            if (y > radius) break;
            vec2 offset = vec2(0.0, y * texelSize.y);
            result += texture2D(sourceTex, vUv + offset);
            result += texture2D(sourceTex, vUv - offset);
            totalWeight += 2.0;
          }
          gl_FragColor = result / totalWeight;
        }
      `,
    });
    this.blurScene = new Scene();
    this.blurQuad = new Mesh(FULLSCREEN_QUAD_GEOMETRY, this.blurHMaterial);
    this.blurScene.add(this.blurQuad);
    this.warpMaterial = new ShaderMaterial({
      uniforms: {
        currentTex: { value: this.targets[0].texture },
        previousTex: { value: this.targets[0].texture },
        warpTex: { value: this.targets[0].texture },
        warpUvTex: { value: null },
        hasWarpUvField: { value: 0 },
        blur1Tex: { value: this.blurTargets[0].texture },
        blur2Tex: { value: this.blurTargets[1].texture },
        blur3Tex: { value: this.blurTargets[2].texture },
        texelSize: { value: new Vector2(1, 1) },
        // MilkDrop's texsize builtin, declared for every custom shader body by
        // MILKDROP_SHADER_BUILTIN_DECLARATIONS — so the warp shader can read
        // it, and two paths here write it every frame (swap() and
        // applyCompositeState). It was never actually created on this
        // material, so the first of those writes threw
        // "Cannot read properties of undefined (reading 'value')" inside the
        // adapter's try/catch: every frame logged "render failed (potentially
        // during fallback/transition)" and returned false, so nothing drew at
        // all. Placeholder dimensions; both writers overwrite it with the
        // feedback target's real size before it is sampled.
        texsize: { value: new Vector4(1, 1, 1, 1) },
        noiseTex: { value: this.auxTextures.noise },
        simplexTex: { value: this.auxTextures.simplex },
        voronoiTex: { value: this.auxTextures.voronoi },
        auraTex: { value: this.auxTextures.aura },
        causticsTex: { value: this.auxTextures.caustics },
        patternTex: { value: this.auxTextures.pattern },
        fractalTex: { value: this.auxTextures.fractal },
        videoTex: { value: this.auxTextures.video },
        perlinTex: { value: this.auxTextures.perlin },
        noiseLqTex: { value: sharedNativeNoiseTexture() },
        noisevolTex: { value: sharedNativeNoiseVolumeTexture() },
        audioTex: { value: null },
        ...BLUR_RANGE_UNIFORM_DEFAULTS,
        warpScale: { value: 1 },
        zoom: { value: 1.02 },
        zoomMul: { value: 1 },
        rotation: { value: 0 },
        offsetX: { value: 0 },
        offsetY: { value: 0 },
        textureWrap: { value: 0 },
        warpTextureSource: { value: 0 },
        warpTextureSampleDimension: { value: 0 },
        warpTextureAmount: { value: 0 },
        warpTextureScale: { value: new Vector2(1, 1) },
        warpTextureOffset: { value: new Vector2(0, 0) },
        warpTextureVolumeSliceZ: { value: 0 },
        hasDirectWarp: { value: 0 },
        ...SIGNAL_UNIFORM_DEFAULTS,
        aspect: { value: new Vector4(1, 1, 1, 1) },
        _qa: { value: new Vector4() },
        _qb: { value: new Vector4() },
        _qc: { value: new Vector4() },
        _qd: { value: new Vector4() },
        _qe: { value: new Vector4() },
        _qf: { value: new Vector4() },
        _qg: { value: new Vector4() },
        _qh: { value: new Vector4() },
        rand_preset: {
          value: new Vector4(
            Math.random(),
            Math.random(),
            Math.random(),
            Math.random(),
          ),
        },
        videoEchoOrientation: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: MILKDROP_WARP_FRAGMENT_SHADER,
    });
    this.warpScene = new Scene();
    this.warpScene.add(new Mesh(FULLSCREEN_QUAD_GEOMETRY, this.warpMaterial));
    // Mesh warp: the previous frame drawn onto the transformed grid. Kept as
    // its own scene so the uniform path above stays intact for shader-driven
    // presets and for frames that ship no field.
    this.warpMeshMaterial = new ShaderMaterial({
      uniforms: {
        previousTex: { value: this.targets[0].texture },
        textureWrap: { value: 0 },
      },
      vertexShader: MILKDROP_WARP_MESH_VERTEX_SHADER,
      fragmentShader: MILKDROP_WARP_MESH_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      // A warp can fold the grid, flipping a triangle's winding; the whole
      // pass drew nothing at all until this, because the default FrontSide
      // culled the lattice's own orientation.
      side: DoubleSide,
    });
    this.warpMeshGeometry = new BufferGeometry();
    const warpMesh = new Mesh(this.warpMeshGeometry, this.warpMeshMaterial);
    // The grid's vertices move every frame and the shader ignores the camera,
    // so a bounding sphere computed from stale positions can only be wrong —
    // and culling this mesh leaves the warp target empty, which silently
    // throws the feedback history away.
    warpMesh.frustumCulled = false;
    this.warpMeshScene = new Scene();
    this.warpMeshScene.add(warpMesh);
    this.warpMeshScene.matrixAutoUpdate = false;
    this.warpUvGeometry = new BufferGeometry();
    const warpUvMesh = new Mesh(
      this.warpUvGeometry,
      new ShaderMaterial({
        vertexShader: MILKDROP_WARP_UV_VERTEX_SHADER,
        fragmentShader: MILKDROP_WARP_UV_FRAGMENT_SHADER,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    warpUvMesh.frustumCulled = false;
    this.warpUvScene = new Scene();
    this.warpUvScene.add(warpUvMesh);
    this.warpUvScene.matrixAutoUpdate = false;
    this.feedbackBlendMaterial = new ShaderMaterial({
      uniforms: {
        currentTex: { value: this.sceneTarget.texture },
        warpTex: { value: this.warpTarget.texture },
        noiseTex: { value: this.auxTextures.noise },
        simplexTex: { value: this.auxTextures.simplex },
        voronoiTex: { value: this.auxTextures.voronoi },
        auraTex: { value: this.auxTextures.aura },
        causticsTex: { value: this.auxTextures.caustics },
        patternTex: { value: this.auxTextures.pattern },
        fractalTex: { value: this.auxTextures.fractal },
        videoTex: { value: this.auxTextures.video },
        perlinTex: { value: this.auxTextures.perlin },
        noiseLqTex: { value: sharedNativeNoiseTexture() },
        noisevolTex: { value: sharedNativeNoiseVolumeTexture() },
        videoEchoAlpha: { value: 0 },
        textureWrap: { value: 0 },
        warpScale: { value: 0 },
        offsetX: { value: 0 },
        offsetY: { value: 0 },
        rotation: { value: 0 },
        zoomMul: { value: 1 },
        feedbackSoftness: { value: this.profile.feedbackSoftness },
        decay: { value: 0.98 },
        hasDirectWarp: { value: 0 },
        texelSize: {
          value: new Vector2(
            1 / Math.max(1, this.targets[0].width),
            1 / Math.max(1, this.targets[0].height),
          ),
        },
        texsize: {
          value: new Vector4(
            this.targets[0].width,
            this.targets[0].height,
            1 / Math.max(1, this.targets[0].width),
            1 / Math.max(1, this.targets[0].height),
          ),
        },
        warpTextureSource: { value: 0 },
        warpTextureSampleDimension: { value: 0 },
        warpTextureAmount: { value: 0 },
        warpTextureScale: { value: new Vector2(1, 1) },
        warpTextureOffset: { value: new Vector2(0, 0) },
        warpTextureVolumeSliceZ: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: MILKDROP_FEEDBACK_BLEND_FRAGMENT_SHADER,
    });
    this.feedbackBlendScene = new Scene();
    this.feedbackBlendScene.add(
      new Mesh(FULLSCREEN_QUAD_GEOMETRY, this.feedbackBlendMaterial),
    );
    this.compositeMaterial = this.createCompositeMaterial(
      MILKDROP_BASE_COMPOSITE_FRAGMENT_SHADER,
    );
    this.presentMaterial = new ShaderMaterial({
      uniforms: {
        currentTex: { value: this.displayTarget.texture },
        savedTex: { value: null },
        transitionAlpha: { value: 0 },
        patternAspect: { value: 16 / 9 },
        // 1 zooms a still snapshot as it dissolves; 0 for another deck's
        // live frame, which moves on its own (setTransitionSource).
        savedDrift: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D currentTex;
        uniform sampler2D savedTex;
        uniform float transitionAlpha;
        uniform float patternAspect;
        uniform float savedDrift;
        varying vec2 vUv;

        // MilkDrop-style dissolve: a static noise pattern sets when each pixel
        // flips from the saved frame to the live preset, so the transition
        // sweeps through the image in organic patches instead of one flat
        // full-screen fade. Knobs live in MILKDROP_BLEND_DISSOLVE
        // (feedback-composite-profile.ts), shared with the WebGPU TSL node.
        // Sin-free hash (Dave Hoskins): fract(sin(x) * 43758.5453) breaks
        // down on mediump mobile GPUs (Mali/Adreno) and costs more there.
        float hash21(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        void main() {
          vec4 current = texture2D(currentTex, vUv);
          if (transitionAlpha < 0.001) {
            gl_FragColor = current;
            return;
          }
          float a = clamp(transitionAlpha, 0.0, 1.0);
          // Ease the global progression so the wipe starts and ends gently
          // instead of snapping into motion off the linear alpha ramp.
          a = a * a * (3.0 - 2.0 * a);
          // A saved snapshot is still; zoom it slowly as it dissolves out
          // (alpha runs 1 -> 0) so the outgoing image keeps moving instead
          // of freezing for the whole blend. Off for a live deck's frame
          // (savedDrift 0), which moves on its own.
          float drift = 1.0 +
            ${MILKDROP_BLEND_DISSOLVE.savedZoomDrift.toFixed(4)} * (1.0 - a) *
              savedDrift;
          vec2 savedUv = (vUv - 0.5) / drift + 0.5;
          vec4 saved = texture2D(savedTex, savedUv);
          // Aspect-corrected sample point keeps dissolve patches round on
          // any viewport instead of stretched across the wide axis.
          vec2 p = vec2(vUv.x * patternAspect, vUv.y);
          float pattern =
            ${MILKDROP_BLEND_DISSOLVE.coarseWeight.toFixed(4)} *
              valueNoise(p * ${MILKDROP_BLEND_DISSOLVE.coarseScale.toFixed(4)}) +
            ${(1 - MILKDROP_BLEND_DISSOLVE.coarseWeight).toFixed(4)} *
              valueNoise(p * ${MILKDROP_BLEND_DISSOLVE.fineScale.toFixed(4)} +
                ${MILKDROP_BLEND_DISSOLVE.fineOffset.toFixed(4)});
          const float band = ${MILKDROP_BLEND_DISSOLVE.band.toFixed(4)};
          // Remap so a=1 keeps every pixel on the saved frame and a=0 releases
          // every pixel, regardless of where its pattern threshold landed.
          float aa = a * (1.0 + 2.0 * band) - band;
          float local = smoothstep(pattern - band, pattern + band, aa);
          vec3 currentSq = current.rgb * current.rgb;
          vec3 savedSq = saved.rgb * saved.rgb;
          vec3 blendedRgb = sqrt(mix(currentSq, savedSq, local));
          float blendedAlpha = mix(current.a, saved.a, local);
          gl_FragColor = vec4(blendedRgb, blendedAlpha);
        }
      `,
    });
    const quad = new Mesh(FULLSCREEN_QUAD_GEOMETRY, this.compositeMaterial);
    const presentQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.presentMaterial,
    );
    this.compositeScene.add(quad);
    this.presentScene.add(presentQuad);

    this.camera.matrixAutoUpdate = false;
    this.camera.updateMatrixWorld(true);
    this.warpScene.matrixAutoUpdate = false;
    this.feedbackBlendScene.matrixAutoUpdate = false;
    this.compositeScene.matrixAutoUpdate = false;
    this.presentScene.matrixAutoUpdate = false;
    this.blurScene.matrixAutoUpdate = false;
  }

  /**
   * Hand this frame's warp grid to the mesh pass, or null to fall back to the
   * uniform path. Buffers are owned by the VM and reused, so they are uploaded
   * here rather than retained.
   */
  setWarpField(field: MilkdropWarpFieldVisual | null): void {
    if (!field || field.density < 2) {
      this.warpFieldReady = false;
      return;
    }
    const geometry = this.warpMeshGeometry;
    const vertexCount = field.positions.length / 2;
    const positionAttr = geometry.getAttribute('position');
    if (!positionAttr || positionAttr.count !== vertexCount) {
      geometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(vertexCount * 3), 3),
      );
      geometry.setAttribute(
        'warpUvAttr',
        new BufferAttribute(new Float32Array(vertexCount * 2), 2),
      );
    }
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const uvs = geometry.getAttribute('warpUvAttr') as BufferAttribute;
    const positionArray = positions.array as Float32Array;
    const uvArray = uvs.array as Float32Array;
    for (let index = 0; index < vertexCount; index += 1) {
      positionArray[index * 3] = field.positions[index * 2] ?? 0;
      positionArray[index * 3 + 1] = field.positions[index * 2 + 1] ?? 0;
      positionArray[index * 3 + 2] = 0;
      uvArray[index * 2] = field.uvs[index * 2] ?? 0;
      uvArray[index * 2 + 1] = field.uvs[index * 2 + 1] ?? 0;
    }
    positions.needsUpdate = true;
    uvs.needsUpdate = true;
    const uvGeometry = this.warpUvGeometry;
    const latticeAttr = uvGeometry.getAttribute('position');
    if (!latticeAttr || latticeAttr.count !== vertexCount) {
      uvGeometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(vertexCount * 3), 3),
      );
      uvGeometry.setAttribute(
        'sampleUvAttr',
        new BufferAttribute(new Float32Array(vertexCount * 2), 2),
      );
    }
    const latticePositions = (
      uvGeometry.getAttribute('position') as BufferAttribute
    ).array as Float32Array;
    const sampleUvAttr = uvGeometry.getAttribute(
      'sampleUvAttr',
    ) as BufferAttribute;
    const sampleUvArray = sampleUvAttr.array as Float32Array;
    for (let index = 0; index < vertexCount; index += 1) {
      latticePositions[index * 3] = (field.uvs[index * 2] ?? 0) * 2 - 1;
      latticePositions[index * 3 + 1] = (field.uvs[index * 2 + 1] ?? 0) * 2 - 1;
      latticePositions[index * 3 + 2] = 0;
      sampleUvArray[index * 2] = field.sampleUvs[index * 2] ?? 0;
      sampleUvArray[index * 2 + 1] = field.sampleUvs[index * 2 + 1] ?? 0;
    }
    (uvGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    sampleUvAttr.needsUpdate = true;
    if (this.warpFieldDensity !== field.density) {
      geometry.setIndex(new BufferAttribute(field.indices, 1));
      uvGeometry.setIndex(new BufferAttribute(field.indices, 1));
      this.warpFieldDensity = field.density;
    }
    this.warpFieldReady = true;
  }

  /**
   * Drop every accumulated frame. Only a capture harness should call this:
   * the feedback buffers are the picture for most presets, so clearing them
   * mid-session is a visible black flash.
   */
  clearHistory(): void {
    const renderer = this.lastRenderer;
    if (!renderer?.setRenderTarget) {
      return;
    }
    const previousClearAlpha = renderer.getClearAlpha?.() ?? 1;
    const previousClearColor = renderer.getClearColor?.(
      SCENE_CLEAR_COLOR_SCRATCH,
    );
    renderer.setClearColor?.(0x000000, 0);
    for (const target of [
      this.targets[0],
      this.targets[1],
      this.warpTarget,
      this.sceneTarget,
    ]) {
      if (!target) continue;
      renderer.setRenderTarget(target);
      renderer.clear?.();
    }
    renderer.setRenderTarget(null);
    if (previousClearColor) {
      renderer.setClearColor?.(previousClearColor, previousClearAlpha);
    } else {
      renderer.setClearAlpha?.(previousClearAlpha);
    }
  }

  setAudioTexture(texture: Texture | null): void {
    if (this.compositeMaterial.uniforms.audioTex) {
      this.compositeMaterial.uniforms.audioTex.value = texture;
    }
    if (this.warpMaterial.uniforms.audioTex) {
      this.warpMaterial.uniforms.audioTex.value = texture;
    }
  }

  private createCompositeMaterial(fragmentShader: string): ShaderMaterial {
    const material = new ShaderMaterial({
      uniforms: {
        internalTex: { value: this.targets[0].texture },
        currentTex: { value: this.sceneTarget.texture },
        previousTex: { value: this.targets[0].texture },
        noiseTex: { value: this.auxTextures.noise },
        simplexTex: { value: this.auxTextures.simplex },
        voronoiTex: { value: this.auxTextures.voronoi },
        auraTex: { value: this.auxTextures.aura },
        causticsTex: { value: this.auxTextures.caustics },
        patternTex: { value: this.auxTextures.pattern },
        fractalTex: { value: this.auxTextures.fractal },
        videoTex: { value: this.auxTextures.video },
        perlinTex: { value: this.auxTextures.perlin },
        noiseLqTex: { value: sharedNativeNoiseTexture() },
        noisevolTex: { value: sharedNativeNoiseVolumeTexture() },
        audioTex: { value: null },
        warpTex: { value: this.warpTarget.texture },
        blur1Tex: { value: this.blurTargets[0].texture },
        blur2Tex: { value: this.blurTargets[1].texture },
        blur3Tex: { value: this.blurTargets[2].texture },
        ...BLUR_RANGE_UNIFORM_DEFAULTS,
        videoEchoAlpha: { value: 0 },
        videoEchoZoom: { value: 1 },
        videoEchoOrientation: { value: 0 },
        brighten: { value: 0 },
        darken: { value: 0 },
        darkenCenter: { value: 0 },
        solarize: { value: 0 },
        invert: { value: 0 },
        redBlueStereo: { value: 0 },
        gammaAdj: { value: 1 },
        textureWrap: { value: 0 },
        warpScale: { value: 0 },
        offsetX: { value: 0 },
        offsetY: { value: 0 },
        rotation: { value: 0 },
        zoomMul: { value: 1 },
        saturation: { value: 1 },
        contrast: { value: 1 },
        colorScale: { value: new Color(1, 1, 1) },
        hueShift: { value: 0 },
        brightenBoost: { value: 0 },
        invertBoost: { value: 0 },
        solarizeBoost: { value: 0 },
        vignette: { value: 0 },
        chromaticAberration: { value: 0 },
        tint: { value: new Color(1, 1, 1) },
        feedbackSoftness: { value: this.profile.feedbackSoftness },
        currentFrameBoost: { value: this.profile.currentFrameBoost },
        overlayTextureSource: { value: 0 },
        overlayTextureMode: { value: 0 },
        overlayTextureSampleDimension: { value: 0 },
        overlayTextureInvert: { value: 0 },
        overlayTextureAmount: { value: 0 },
        overlayTextureScale: { value: new Vector2(1, 1) },
        overlayTextureOffset: { value: new Vector2(0, 0) },
        overlayTextureVolumeSliceZ: { value: 0 },
        warpTextureSource: { value: 0 },
        warpTextureSampleDimension: { value: 0 },
        warpTextureAmount: { value: 0 },
        warpTextureScale: { value: new Vector2(1, 1) },
        warpTextureOffset: { value: new Vector2(0, 0) },
        warpTextureVolumeSliceZ: { value: 0 },
        ...SIGNAL_UNIFORM_DEFAULTS,
        aspect: { value: new Vector4(1, 1, 1, 1) },
        _qa: { value: new Vector4() },
        _qb: { value: new Vector4() },
        _qc: { value: new Vector4() },
        _qd: { value: new Vector4() },
        _qe: { value: new Vector4() },
        _qf: { value: new Vector4() },
        _qg: { value: new Vector4() },
        _qh: { value: new Vector4() },
        rand_preset: {
          value: new Vector4(
            Math.random(),
            Math.random(),
            Math.random(),
            Math.random(),
          ),
        },
        decay: { value: 0.98 },
        hasDirectWarp: { value: 0 },
        texelSize: {
          value: new Vector2(
            1 / Math.max(1, this.sceneTarget.width),
            1 / Math.max(1, this.sceneTarget.height),
          ),
        },
        texsize: {
          value: new Vector4(
            this.sceneTarget.width,
            this.sceneTarget.height,
            1 / Math.max(1, this.sceneTarget.width),
            1 / Math.max(1, this.sceneTarget.height),
          ),
        },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader,
    });
    for (const sampler of this.customSamplers) {
      if (sampler.textureFile) {
        material.uniforms[sampler.name] = {
          value: getSharedMilkdropTexture(sampler.textureFile, true, sampler),
        };
      }
    }
    return material;
  }

  swap() {
    this.index = (this.index + 1) % 2;
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;
    this.warpMaterial.uniforms.previousTex.value = this.readTarget.texture;
    this.warpMaterial.uniforms.warpTex.value = this.readTarget.texture;
    this.warpMaterial.uniforms.currentTex.value = this.readTarget.texture;
    this.warpMaterial.uniforms.texelSize.value.set(
      1 / this.readTarget.width,
      1 / this.readTarget.height,
    );
    this.warpMaterial.uniforms.texsize.value.set(
      this.readTarget.width,
      this.readTarget.height,
      1 / this.readTarget.width,
      1 / this.readTarget.height,
    );
  }

  /**
   * Snapshots the picture on screen for a crossfade to dissolve out of.
   *
   * Outside a blend the composite draws straight to the canvas and the
   * display target is never written, so copying the display target (what
   * this used to do) snapshotted an empty or stale buffer and every WebGL
   * crossfade dissolved out of black. Re-running the composite reproduces the
   * frame just shown, because its input — the last internal frame — is still
   * bound. Mid-blend the screen is the present pass's dissolve, so that is
   * what gets drawn, into the slot the present pass is not sampling.
   */
  saveCurrentFrame(): void {
    const renderer = this.lastRenderer;
    if (!renderer?.setRenderTarget) return;
    const { width, height } = this.readTarget;
    let target = this.savedFrameTargets[this.savedFrameIndex];
    if (!target) {
      target = createWebGLFeedbackRenderTarget(width, height, {
        resolutionScale: 1,
        useHalfFloatFeedback: this.halfFloatFeedback,
        samples: 0,
      });
      this.savedFrameTargets[this.savedFrameIndex] = target;
    } else if (target.width !== width || target.height !== height) {
      target.setSize(width, height);
    }
    const blending =
      (this.presentMaterial.uniforms.transitionAlpha.value as number) > 0.001;
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    if (blending) {
      // The present pass reads the display target, which a frame drawn
      // without a cover (a gated mid-blend frame) composited past. Redraw it
      // from the same bound internal frame first.
      renderer.setRenderTarget(this.displayTarget);
      renderer.render(this.compositeScene, this.camera);
    }
    renderer.setRenderTarget(target);
    renderer.render(
      blending ? this.presentScene : this.compositeScene,
      this.camera,
    );
    renderer.setRenderTarget(previousTarget);
    this.recordSnapshot(target.texture);
    this.savedFrameIndex = 1 - this.savedFrameIndex;
  }

  protected rememberRenderer(renderer: unknown) {
    this.lastRenderer =
      renderer as SharedMilkdropFeedbackManager['lastRenderer'];
    // A warp/comp program that fails to link currently only console.errors
    // (core/webgl-renderer.ts) while the stage keeps showing the previous
    // frame. The tracking hook turns that into a structured diagnostic with
    // the program's stage template attributed; idempotent per renderer, so
    // decks and manager swaps install it exactly once.
    installMilkdropWebglShaderErrorTracking(
      renderer as object | null | undefined,
    );
  }

  getDisplayTexture(): Texture {
    return this.displayTarget.texture;
  }

  /** Also carries the blur levels: the next composite samples the blur the
   * previous frame left, so a deck seeded without them starts blur-sampling
   * comp shaders on black. */
  override seedHistoryFrom(
    renderer: unknown,
    source: { getHistoryTexture?(): Texture | null },
  ): boolean {
    if (!super.seedHistoryFrom(renderer, source)) return false;
    if (source instanceof SharedMilkdropFeedbackManager) {
      source.blurTargets.forEach((level, index) => {
        this.copyTargetImage(level.texture, this.blurTargets[index]);
      });
    }
    return true;
  }

  protected copyTargetImage(
    source: Texture,
    destination: WebGLRenderTarget,
  ): boolean {
    const renderer = this.lastRenderer;
    if (!renderer?.setRenderTarget) return false;
    if (!this.copyPass) {
      const material = new ShaderMaterial({
        uniforms: { sourceTex: { value: null } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D sourceTex;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(sourceTex, vUv);
          }
        `,
        // A copy, not a draw: alpha must not blend against what was there.
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
      });
      const scene = new Scene();
      scene.add(new Mesh(FULLSCREEN_QUAD_GEOMETRY, material));
      this.copyPass = { scene, material };
    }
    this.copyPass.material.uniforms.sourceTex.value = source;
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    renderer.setRenderTarget(destination);
    renderer.render(this.copyPass.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    this.copyPass.material.uniforms.sourceTex.value = null;
    return true;
  }

  protected createScratchTarget(like: WebGLRenderTarget): WebGLRenderTarget {
    return createWebGLFeedbackRenderTarget(like.width, like.height, {
      resolutionScale: 1,
      useHalfFloatFeedback: like.texture.type === HalfFloatType,
      samples: 0,
    });
  }

  setDirectShaderPrograms(
    warp: MilkdropShaderProgramPayload | null,
    comp: MilkdropShaderProgramPayload | null,
  ) {
    const executableWarp = isMilkdropShaderProgramBackendExecutable(warp)
      ? warp
      : null;
    const executableComp = isMilkdropShaderProgramBackendExecutable(comp)
      ? comp
      : null;
    // This runs every frame; without the cache, translated presets (no
    // rawGlsl) would regenerate multi-KB GLSL strings for both stages each
    // frame just to hit the "nothing changed" early-out below.
    const warpGlsl = executableWarp
      ? (executableWarp.rawGlsl ??
        getCachedGlslForShaderProgram(executableWarp, 'warp'))
      : null;
    const compGlsl = executableComp
      ? (executableComp.rawGlsl ??
        getCachedGlslForShaderProgram(executableComp, 'comp'))
      : null;

    // Skip rebuild if nothing changed
    if (this.lastWarpGlsl === warpGlsl && this.lastCompGlsl === compGlsl) {
      return;
    }

    this.lastWarpGlsl = warpGlsl;
    this.lastCompGlsl = compGlsl;
    const revision = ++this.directShaderSwapRevision;
    // A new swap supersedes any pending one; the async path re-arms below.
    this.directShaderSwapPending = false;

    const renderer = this.lastRenderer as
      | (NonNullable<SharedMilkdropFeedbackManager['lastRenderer']> & {
          compileAsync?: (scene: Scene, camera: Camera) => Promise<unknown>;
        })
      | null;
    const hasCustomShaders = warpGlsl !== null || compGlsl !== null;
    const compileAsync = renderer?.compileAsync?.bind(renderer);
    // Agent mode captures frames immediately after a preset applies
    // (preview generation, deterministic parity captures); the async warm-up
    // window would put pass-through styling in those captures — the 08-18
    // preview batch recorded 176 near-black/flat thumbnails this way.
    // Same rule as the WebGPU manager's pipeline swap: sync in agent mode.
    if (!hasCustomShaders || !compileAsync || isAgentMode()) {
      this.applyAssembledDirectShaders(warpGlsl, compGlsl);
      return;
    }

    // Progressive apply. Assigning the custom fragment shaders directly
    // would make the next render build their GL programs synchronously —
    // the single biggest stall of a preset switch (hundreds of ms on weak
    // GPUs, seconds under software rasterizers). Instead the preset lands
    // on the pass-through pair now (its program is shared by every preset
    // and already cached), the custom pair warms through
    // KHR_parallel_shader_compile on throwaway materials, and the live
    // materials pick the finished programs out of the renderer's program
    // cache when the swap completes. Equations, waves, and shapes are
    // unaffected — they render from frame one; only the warp/comp styling
    // arrives a beat later.
    this.applyAssembledDirectShaders(null, null);
    this.directShaderSwapPending = true;

    const { warp: warmWarpShader, composite: warmCompositeShader } =
      assembleMilkdropDirectFragmentShaders(warpGlsl, compGlsl);
    const warmupMaterials = [
      new ShaderMaterial({
        vertexShader: this.warpMaterial.vertexShader,
        fragmentShader: warmWarpShader,
      }),
      new ShaderMaterial({
        vertexShader: this.compositeMaterial.vertexShader,
        fragmentShader: warmCompositeShader,
      }),
    ];
    const warmupScene = new Scene();
    for (const material of warmupMaterials) {
      warmupScene.add(new Mesh(FULLSCREEN_QUAD_GEOMETRY, material));
    }
    const finishSwap = () => {
      if (revision !== this.directShaderSwapRevision) {
        for (const material of warmupMaterials) {
          material.dispose();
        }
        return;
      }
      this.directShaderSwapPending = false;
      this.applyAssembledDirectShaders(warpGlsl, compGlsl);
      // The warm materials must outlive the swap: they hold the program
      // refcount until the live materials acquire it at their next render.
      // Disposing them now would drop the count to zero and force the sync
      // recompile this path exists to avoid. They retire at the next swap
      // (or manager dispose) instead.
      this.disposeRetiredWarmupMaterials();
      this.retiredWarmupMaterials.push(...warmupMaterials);
    };
    // The kick is deferred a macrotask: this method runs from
    // applyCompositeState, i.e. mid-frame between the renderer's internal
    // passes, and compileAsync's first step is a synchronous
    // renderer.compile() of the warm scene — running that inside the live
    // frame corrupts the in-flight render state and blacked out the stage
    // (verified against the deep-link boot flow). After the current frame
    // unwinds, compiling the throwaway scene is safe.
    //
    // A compile error surfaces identically to today's sync path: finishSwap
    // assigns the shaders anyway and THREE logs the failure at first use.
    setTimeout(() => {
      if (revision !== this.directShaderSwapRevision) {
        for (const material of warmupMaterials) {
          material.dispose();
        }
        return;
      }
      void compileAsync(warmupScene, this.camera).then(finishSwap, finishSwap);
    }, 0);
  }

  private disposeRetiredWarmupMaterials() {
    for (const material of this.retiredWarmupMaterials) {
      material.dispose();
    }
    this.retiredWarmupMaterials.length = 0;
  }

  private applyAssembledDirectShaders(
    warpGlsl: string | null,
    compGlsl: string | null,
  ) {
    // Every `sampler_*` still referenced after the built-in rewrites is a
    // texture-pack sampler (MilkDrop auto-binds them without declarations);
    // each resolves to a bundled texture or a deterministic fallback so the
    // assembled shaders always compile.
    this.customSamplers = [
      ...(warpGlsl ? extractReferencedCustomSamplers(warpGlsl) : []),
      ...(compGlsl ? extractReferencedCustomSamplers(compGlsl) : []),
    ].filter((s, _i, arr) => arr.findIndex((c) => c.name === s.name) === _i);

    // Add warp-specific custom samplers to the warp material
    for (const sampler of this.customSamplers) {
      if (sampler.textureFile && !this.warpMaterial.uniforms[sampler.name]) {
        this.warpMaterial.uniforms[sampler.name] = {
          value: getSharedMilkdropTexture(sampler.textureFile, true, sampler),
        };
      }
    }

    const hasDirectWarp = warpGlsl !== null ? 1.0 : 0.0;

    // Rebuild both shaders with preset GLSL injected (pass-through when null)
    const {
      warp: injectedWarp,
      composite: injectedShader,
      perFrameVariables,
    } = assembleMilkdropDirectFragmentShaders(warpGlsl, compGlsl);
    this.perFrameShaderVariables = perFrameVariables;
    for (const name of perFrameVariables) {
      if (!this.warpMaterial.uniforms[name]) {
        this.warpMaterial.uniforms[name] = { value: 0 };
      }
      if (!this.compositeMaterial.uniforms[name]) {
        this.compositeMaterial.uniforms[name] = { value: 0 };
      }
    }
    this.warpMaterial.fragmentShader = injectedWarp;
    this.warpMaterial.needsUpdate = true;
    this.warpMaterial.uniforms.hasDirectWarp.value = hasDirectWarp;
    this.feedbackBlendMaterial.uniforms.hasDirectWarp.value = hasDirectWarp;

    // Reuse the composite material across presets: only the injected
    // fragment shader changes, and its uniform set is fixed. Recreating the
    // ShaderMaterial per switch (dispose + fresh ~50-uniform object + new
    // quad + uniform-value copy) rebuilt GPU programs and churned uniforms on
    // every preset load, stalling the first frame of each switch.
    const composite = this.compositeMaterial;
    composite.fragmentShader = injectedShader;
    composite.needsUpdate = true;
    composite.uniforms.hasDirectWarp.value = hasDirectWarp;

    // New preset shaders → fresh rand_preset draw (MilkDrop rolls these
    // per-preset random constants once per preset load).
    (this.warpMaterial.uniforms.rand_preset.value as Vector4).set(
      Math.random(),
      Math.random(),
      Math.random(),
      Math.random(),
    );
    (composite.uniforms.rand_preset.value as Vector4).copy(
      this.warpMaterial.uniforms.rand_preset.value as Vector4,
    );

    this.blurEnabled =
      /texture2D\s*\(\s*blur[123]Tex/.test(composite.fragmentShader) ||
      /texture2D\s*\(\s*blur[123]Tex/.test(this.warpMaterial.fragmentShader);
  }

  applyCompositeState(state: MilkdropFeedbackCompositeState) {
    // Apply direct shader programs if they changed
    this.setDirectShaderPrograms(
      state.shaderPrograms.warp,
      state.shaderPrograms.comp,
    );

    const uniforms = this.compositeMaterial.uniforms;
    const blurShaderRanges = resolveMilkdropBlurShaderRanges(
      state.perPixelVariables,
    );
    uniforms.scale1.value = blurShaderRanges[0].scale;
    uniforms.bias1.value = blurShaderRanges[0].bias;
    uniforms.scale2.value = blurShaderRanges[1].scale;
    uniforms.bias2.value = blurShaderRanges[1].bias;
    uniforms.scale3.value = blurShaderRanges[2].scale;
    uniforms.bias3.value = blurShaderRanges[2].bias;
    const overlayTextureName = resolveAuxTextureName(
      state.overlayTextureSource,
    );
    const warpTextureName = resolveAuxTextureName(state.warpTextureSource);
    if (
      overlayTextureName &&
      !['noise', 'perlin', 'simplex'].includes(overlayTextureName)
    ) {
      uniforms[`${overlayTextureName}Tex`].value = getSharedMilkdropTexture(
        AUX_TEXTURE_SPECS[overlayTextureName].fileName,
        AUX_TEXTURE_SPECS[overlayTextureName].colorTexture,
      );
    }
    if (
      warpTextureName &&
      !['noise', 'perlin', 'simplex'].includes(warpTextureName)
    ) {
      const warpTexture = getSharedMilkdropTexture(
        AUX_TEXTURE_SPECS[warpTextureName].fileName,
        AUX_TEXTURE_SPECS[warpTextureName].colorTexture,
      );
      uniforms[`${warpTextureName}Tex`].value = warpTexture;
      this.feedbackBlendMaterial.uniforms[`${warpTextureName}Tex`].value =
        warpTexture;
    }
    // The feedback-blend pass owns the frame construction, so it receives
    // the loop-facing subset of the state (transform, decay, echo, warp
    // texture displacement); the composite keeps its copies for comp bodies
    // that reference the same names.
    const feedbackUniforms = this.feedbackBlendMaterial.uniforms;
    feedbackUniforms.videoEchoAlpha.value = state.videoEchoAlpha;
    feedbackUniforms.textureWrap.value = state.textureWrap;
    feedbackUniforms.decay.value = state.decay;
    feedbackUniforms.warpScale.value = state.warpScale;
    feedbackUniforms.offsetX.value = state.offsetX;
    feedbackUniforms.offsetY.value = state.offsetY;
    feedbackUniforms.rotation.value = state.rotation;
    feedbackUniforms.zoomMul.value = state.zoomMul;
    feedbackUniforms.warpTextureSource.value = state.warpTextureSource;
    feedbackUniforms.warpTextureSampleDimension.value =
      state.warpTextureSampleDimension;
    feedbackUniforms.warpTextureAmount.value = state.warpTextureAmount;
    feedbackUniforms.warpTextureScale.value.set(
      state.warpTextureScale.x,
      state.warpTextureScale.y,
    );
    feedbackUniforms.warpTextureOffset.value.set(
      state.warpTextureOffset.x,
      state.warpTextureOffset.y,
    );
    feedbackUniforms.warpTextureVolumeSliceZ.value =
      state.warpTextureVolumeSliceZ;
    uniforms.currentTex.value = this.sceneTarget.texture;
    uniforms.previousTex.value = this.readTarget.texture;
    applyCompositeUniformState(uniforms, state, blurShaderRanges);
    this.syncMilkdropShaderBuiltinUniforms(
      uniforms,
      this.getCompQTargets(uniforms),
      state,
    );

    // Sync warp shader uniforms (subset of composite state)
    const wu = this.warpMaterial.uniforms;
    wu.scale1.value = blurShaderRanges[0].scale;
    wu.bias1.value = blurShaderRanges[0].bias;
    wu.scale2.value = blurShaderRanges[1].scale;
    wu.bias2.value = blurShaderRanges[1].bias;
    wu.scale3.value = blurShaderRanges[2].scale;
    wu.bias3.value = blurShaderRanges[2].bias;
    wu.previousTex.value = this.readTarget.texture;
    wu.warpTex.value = this.readTarget.texture;
    wu.currentTex.value = this.readTarget.texture;
    wu.texelSize.value.set(
      1 / this.readTarget.width,
      1 / this.readTarget.height,
    );
    wu.texsize.value.set(
      this.readTarget.width,
      this.readTarget.height,
      1 / this.readTarget.width,
      1 / this.readTarget.height,
    );
    if (warpTextureName) {
      wu[`${warpTextureName}Tex`].value = getSharedMilkdropTexture(
        AUX_TEXTURE_SPECS[warpTextureName].fileName,
        AUX_TEXTURE_SPECS[warpTextureName].colorTexture,
      );
    }
    wu.warpScale.value = state.warpScale;
    wu.zoom.value = state.zoom;
    wu.zoomMul.value = state.zoomMul;
    wu.rotation.value = state.rotation;
    wu.offsetX.value = state.offsetX;
    wu.offsetY.value = state.offsetY;
    wu.textureWrap.value = state.textureWrap;
    wu.warpTextureSource.value = state.warpTextureSource;
    wu.warpTextureSampleDimension.value = state.warpTextureSampleDimension;
    wu.warpTextureAmount.value = state.warpTextureAmount;
    wu.warpTextureScale.value.set(
      state.warpTextureScale.x,
      state.warpTextureScale.y,
    );
    wu.warpTextureOffset.value.set(
      state.warpTextureOffset.x,
      state.warpTextureOffset.y,
    );
    wu.warpTextureVolumeSliceZ.value = state.warpTextureVolumeSliceZ;
    wu.signalBass.value = state.signalBass;
    wu.signalMid.value = state.signalMid;
    wu.signalTreb.value = state.signalTreb;
    wu.signalBassAtt.value = state.signalBassAtt ?? state.signalBass;
    wu.signalMidAtt.value = state.signalMidAtt ?? state.signalMid;
    wu.signalTrebAtt.value = state.signalTrebAtt ?? state.signalTreb;
    applyHarmonicPercussiveUniforms(wu, state);
    wu.signalBeat.value = state.signalBeat;
    wu.signalBeatPulse.value = state.signalBeatPulse;
    wu.signalEnergy.value = state.signalEnergy;
    wu.signalTime.value = state.signalTime;
    wu.signalFrame.value = state.signalFrame ?? 0;
    wu.signalFps.value = state.signalFps ?? 60;
    this.syncMilkdropShaderBuiltinUniforms(wu, this.getWarpQTargets(wu), state);
    wu.videoEchoOrientation.value = state.videoEchoOrientation;

    // Per-frame variables referenced by the injected shader bodies are
    // uniforms driven from the CPU VM's computed frame state.
    for (const name of this.perFrameShaderVariables) {
      const value = state.perPixelVariables?.[name] ?? 0;
      const warpUniform = wu[name];
      if (warpUniform) {
        warpUniform.value = value;
      }
      const compositeUniform = this.compositeMaterial.uniforms[name];
      if (compositeUniform) {
        compositeUniform.value = value;
      }
    }

    // Zero for presets that never sample the blur textures: the warp and
    // feedback-blend softness taps are skipped instead of softened every
    // frame for no visible result.
    if (wu.feedbackSoftness) {
      wu.feedbackSoftness.value = state.feedbackSoftness;
    }
    if (this.feedbackBlendMaterial.uniforms.feedbackSoftness) {
      this.feedbackBlendMaterial.uniforms.feedbackSoftness.value =
        state.feedbackSoftness;
    }
  }

  private compQTargetsCache: (Vector4 | undefined)[] | null = null;
  private compQTargetsMaterial: ShaderMaterial['uniforms'] | null = null;
  private warpQTargetsCache: (Vector4 | undefined)[] | null = null;
  private warpQTargetsMaterial: ShaderMaterial['uniforms'] | null = null;

  private getCompQTargets(
    uniforms: ShaderMaterial['uniforms'],
  ): (Vector4 | undefined)[] {
    if (this.compQTargetsMaterial !== uniforms || !this.compQTargetsCache) {
      this.compQTargetsMaterial = uniforms;
      this.compQTargetsCache = Q_UNIFORM_NAMES.map(
        (name) => uniforms[name]?.value as Vector4 | undefined,
      );
    }
    return this.compQTargetsCache;
  }

  private getWarpQTargets(
    uniforms: ShaderMaterial['uniforms'],
  ): (Vector4 | undefined)[] {
    if (this.warpQTargetsMaterial !== uniforms || !this.warpQTargetsCache) {
      this.warpQTargetsMaterial = uniforms;
      this.warpQTargetsCache = Q_UNIFORM_NAMES.map(
        (name) => uniforms[name]?.value as Vector4 | undefined,
      );
    }
    return this.warpQTargetsCache;
  }

  /**
   * Feeds the MilkDrop shader-input uniforms (vec4 aspect, q1..q32 packed
   * into _qa.._qh) shared by the warp and composite materials. Aspect uses
   * MilkDrop's convention: .xy shrink the minor axis (values <= 1), .zw are
   * the inverses.
   */
  private syncMilkdropShaderBuiltinUniforms(
    uniforms: ShaderMaterial['uniforms'],
    qTargets: (Vector4 | undefined)[],
    state: MilkdropFeedbackCompositeState,
  ) {
    const aspect =
      Number.isFinite(state.aspect) && state.aspect > 0 ? state.aspect : 1;
    const aspectX = aspect < 1 ? aspect : 1;
    const aspectY = aspect > 1 ? 1 / aspect : 1;
    (uniforms.aspect.value as Vector4).set(
      aspectX,
      aspectY,
      1 / aspectX,
      1 / aspectY,
    );
    const vars = state.perPixelVariables;
    if (vars) {
      for (let group = 0; group < 8; group++) {
        const target = qTargets[group];
        if (!target) continue;
        const keys = Q_VAR_NAMES[group];
        target.set(
          vars[keys[0]] ?? 0,
          vars[keys[1]] ?? 0,
          vars[keys[2]] ?? 0,
          vars[keys[3]] ?? 0,
        );
      }
    } else {
      for (let group = 0; group < 8; group++) {
        qTargets[group]?.set(0, 0, 0, 0);
      }
    }
  }

  render(
    renderer: FeedbackFrameRenderer,
    sourceScene: Scene,
    sourceCamera: Camera,
  ) {
    return this.renderFrame(renderer, sourceScene, sourceCamera, true);
  }

  /** The outgoing deck of a live crossfade: composites into the display
   * target, which the incoming deck's present pass samples. */
  renderOffscreen(
    renderer: FeedbackFrameRenderer,
    sourceScene: Scene,
    sourceCamera: Camera,
  ) {
    return this.renderFrame(renderer, sourceScene, sourceCamera, false);
  }

  private renderFrame(
    renderer: FeedbackFrameRenderer,
    sourceScene: Scene,
    sourceCamera: Camera,
    present: boolean,
  ) {
    if (!renderer.setRenderTarget) {
      return false;
    }

    this.lastRenderer =
      renderer as SharedMilkdropFeedbackManager['lastRenderer'];

    renderSceneIntoFeedbackTarget(
      renderer as FeedbackSceneRenderer,
      sourceScene,
      sourceCamera,
      this.sceneTarget,
    );

    const warpShaderOwnsTransform =
      (this.warpMaterial.uniforms.hasDirectWarp.value as number) > 0.5;
    const warpShaderReadsField = this.warpFieldReady && warpShaderOwnsTransform;
    if (warpShaderReadsField) {
      renderer.setRenderTarget(this.warpUvTarget);
      renderer.render(this.warpUvScene, this.camera);
    }
    this.warpMaterial.uniforms.warpUvTex.value = this.warpUvTarget.texture;
    this.warpMaterial.uniforms.hasWarpUvField.value = warpShaderReadsField
      ? 1
      : 0;
    renderer.setRenderTarget(this.warpTarget);
    if (this.warpFieldReady && !warpShaderOwnsTransform) {
      // The grid already carries the preset's whole transform, per-pixel code
      // included; re-deriving it from uniforms here would apply it twice.
      this.warpMeshMaterial.uniforms.previousTex.value =
        this.readTarget.texture;
      this.warpMeshMaterial.uniforms.textureWrap.value =
        this.warpMaterial.uniforms.textureWrap.value;
      renderer.render(this.warpMeshScene, this.camera);
    } else {
      renderer.render(this.warpScene, this.camera);
    }

    // Internal frame (feedback loop): warped previous + fresh geometry.
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.feedbackBlendScene, this.camera);

    this.compositeMaterial.uniforms.internalTex.value =
      this.writeTarget.texture;

    const transitionAlpha =
      (this.presentMaterial.uniforms.transitionAlpha?.value as
        | number
        | undefined) ?? 0;

    if (!present || transitionAlpha > 0.001) {
      renderer.setRenderTarget(this.displayTarget);
      renderer.render(this.compositeScene, this.camera);

      if (
        this.blurEnabled &&
        this.profile.feedbackSoftness > MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD
      ) {
        this.renderBlurPasses(renderer);
      }

      if (present) {
        renderer.setRenderTarget(null);
        renderer.render(this.presentScene, this.camera);
      }
    } else {
      renderer.setRenderTarget(null);
      renderer.render(this.compositeScene, this.camera);

      if (
        this.blurEnabled &&
        this.profile.feedbackSoftness > MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD
      ) {
        this.renderBlurPasses(renderer);
      }
    }

    this.swap();
    return true;
  }

  private renderBlurPasses(renderer: {
    render(scene: Scene, camera: Camera): void;
    setRenderTarget?: (target: RenderTarget | null) => void;
  }) {
    const srcTex = this.writeTarget.texture;
    const srcW = this.writeTarget.width;
    const srcH = this.writeTarget.height;

    for (let i = 0; i < 3; i++) {
      const hTarget = this.blurHTargets[i];
      const vTarget = this.blurTargets[i];
      const radius = BLUR_PASS_RADII[i];

      this.blurHMaterial.uniforms.sourceTex.value = srcTex;
      this.blurHMaterial.uniforms.texelSize.value.set(1 / srcW, 1 / srcH);
      this.blurHMaterial.uniforms.radius.value = radius;
      this.blurQuad.material = this.blurHMaterial;
      renderer.setRenderTarget?.(hTarget);
      renderer.render(this.blurScene, this.camera);

      this.blurVMaterial.uniforms.sourceTex.value = hTarget.texture;
      this.blurVMaterial.uniforms.texelSize.value.set(
        1 / hTarget.width,
        1 / hTarget.height,
      );
      this.blurVMaterial.uniforms.radius.value = radius;
      this.blurQuad.material = this.blurVMaterial;
      renderer.setRenderTarget?.(vTarget);
      renderer.render(this.blurScene, this.camera);
    }
  }

  resize(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    const sceneWidth = Math.max(
      1,
      Math.round(width * this.sceneResolutionScale),
    );
    const sceneHeight = Math.max(
      1,
      Math.round(height * this.sceneResolutionScale),
    );
    const feedbackWidth = Math.max(
      1,
      Math.round(width * this.currentFeedbackResolutionScale),
    );
    const feedbackHeight = Math.max(
      1,
      Math.round(height * this.currentFeedbackResolutionScale),
    );
    const feedback = (
      target: WebGLRenderTarget | null,
      keepImage: boolean,
    ) => ({ target, width: feedbackWidth, height: feedbackHeight, keepImage });
    this.resizeTargets([
      // Redrawn from scratch every frame before anything reads them.
      {
        target: this.sceneTarget,
        width: sceneWidth,
        height: sceneHeight,
        keepImage: false,
      },
      feedback(this.warpTarget, false),
      feedback(this.warpUvTarget, false),
      feedback(this.writeTarget, false),
      // The feedback history the next frame warps.
      feedback(this.readTarget, true),
      // What a mid-blend snapshot draws from, and the snapshots themselves.
      feedback(this.displayTarget, true),
      feedback(this.savedFrameTargets[0], true),
      feedback(this.savedFrameTargets[1], true),
      // The composite samples the blur the previous frame left behind; the
      // horizontal pass is scratch within renderBlurPasses.
      ...BLUR_LEVEL_SCALES.flatMap((scale, level) => {
        const width = Math.max(1, Math.round(feedbackWidth * scale));
        const height = Math.max(1, Math.round(feedbackHeight * scale));
        return [
          { target: this.blurTargets[level], width, height, keepImage: true },
          { target: this.blurHTargets[level], width, height, keepImage: false },
        ];
      }),
    ]);
    this.compositeMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
    this.compositeMaterial.uniforms.texsize.value.set(
      Math.max(1, feedbackWidth),
      Math.max(1, feedbackHeight),
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
    this.feedbackBlendMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
  }

  dispose() {
    if (
      this.adaptiveResizeFrameId !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.adaptiveResizeFrameId);
      this.adaptiveResizeFrameId = null;
    }
    this.sceneTarget.dispose();
    this.warpTarget.dispose();
    this.warpUvTarget.dispose();
    this.warpUvGeometry.dispose();
    this.targets.forEach((target) => target.dispose());
    this.displayTarget.dispose();
    this.blurTargets.forEach((target) => target.dispose());
    this.blurHTargets.forEach((target) => target.dispose());
    for (const target of this.savedFrameTargets) {
      target?.dispose();
    }
    this.savedFrameTargets = [null, null];
    if (this.copyPass) {
      disposeMaterial(this.copyPass.material);
      this.copyPass = null;
    }
    disposeMaterial(this.compositeMaterial);
    disposeMaterial(this.presentMaterial);
    disposeMaterial(this.blurHMaterial);
    disposeMaterial(this.blurVMaterial);
    disposeMaterial(this.warpMaterial);
    disposeMaterial(this.feedbackBlendMaterial);
    // Invalidate any in-flight async shader warm-up and drop its materials.
    this.directShaderSwapRevision += 1;
    this.directShaderSwapPending = false;
    this.disposeRetiredWarmupMaterials();
    this.compositeScene.clear();
    this.presentScene.clear();
    this.blurScene.clear();
    this.warpScene.clear();
    this.feedbackBlendScene.clear();
  }
}

export function createSharedMilkdropFeedbackManager(
  width: number,
  height: number,
  behavior: MilkdropBackendBehavior,
) {
  return new SharedMilkdropFeedbackManager(width, height, behavior);
}
