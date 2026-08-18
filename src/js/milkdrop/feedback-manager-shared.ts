import {
  type Camera,
  Color,
  DataTexture,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  type RenderTarget,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector4,
  type WebGLRenderTarget,
} from 'three';
import { getSharedMilkdropCapturedVideoTexture } from '../core/services/captured-video-texture.ts';
import { disposeMaterial } from '../utils/three/three-dispose';
import type {
  FeedbackBackendProfile,
  MilkdropBackendBehavior,
} from './backend-behavior';
import {
  extractReferencedCustomSamplers,
  type MilkdropCustomSamplerDeclaration,
} from './compiler/custom-samplers.ts';
import {
  extractNativeShaderBody,
  splitShaderGlobalsAndBody,
} from './compiler/shader-analysis.ts';
import {
  generateGlslFromShaderStatements,
  injectDirectShaderGlsl,
} from './compiler/shader-analysis-glsl.ts';
import { isMilkdropShaderProgramBackendExecutable } from './compiler/shader-execution-classification.ts';
import {
  MILKDROP_BLEND_DISSOLVE,
  MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  MILKDROP_FEEDBACK_BLUR_BLEND_SCALE,
  MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD,
} from './feedback-composite-profile.ts';
import { MilkdropFeedbackManagerLifecycleBase } from './feedback-manager-lifecycle.ts';
import { createWebGLFeedbackRenderTarget } from './feedback-render-targets.ts';
import {
  AUX_TEXTURE_SPECS,
  type AuxTextureName,
  configureMilkdropTexture,
  getSharedMilkdropTexture,
  resolveAuxTextureName,
} from './feedback-texture-utils.ts';
import {
  AUX_TEXTURE_ATLAS_GRID_SIZE,
  AUX_TEXTURE_ATLAS_SLICE_COUNT,
} from './feedback-volume-sampling.ts';
import { applyHarmonicPercussiveUniforms } from './harmonic-percussive-shader-signals.ts';
import { createMilkdropNoiseTexture } from './milkdrop-native-noise.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropShaderProgramPayload,
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

type SharedAuxTextureMap = Record<AuxTextureName | 'video', Texture>;

const sharedMilkdropTexturePlaceholder = (() => {
  const texture = new DataTexture(
    new Uint8Array([128, 128, 128, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.needsUpdate = true;
  return configureMilkdropTexture(texture);
})();
const sharedMilkdropNativeNoiseTexture = createMilkdropNoiseTexture();

function getSharedMilkdropTexturePlaceholder() {
  return sharedMilkdropTexturePlaceholder;
}

function getSharedAuxTextures(): SharedAuxTextureMap {
  return {
    noise: sharedMilkdropNativeNoiseTexture,
    perlin: sharedMilkdropNativeNoiseTexture,
    simplex: sharedMilkdropNativeNoiseTexture,
    voronoi: getSharedMilkdropTexturePlaceholder(),
    aura: getSharedMilkdropTexturePlaceholder(),
    caustics: getSharedMilkdropTexturePlaceholder(),
    pattern: getSharedMilkdropTexturePlaceholder(),
    fractal: getSharedMilkdropTexturePlaceholder(),
    video: getSharedMilkdropCapturedVideoTexture(),
  };
}

/**
 * MilkDrop shader-input surface referenced by transpiled preset bodies:
 * q1..q32 (packed into vec4 uniforms _qa.._qh, matching butterchurn),
 * vec4 aspect (.xy = aspect multipliers, .zw = inverses), rand_preset,
 * and the roam oscillators (derived from time on the GPU with the same
 * frequencies butterchurn computes on the CPU).
 */
const MILKDROP_SHADER_BUILTIN_DECLARATIONS = `
        uniform vec4 aspect;
        uniform vec4 _qa;
        uniform vec4 _qb;
        uniform vec4 _qc;
        uniform vec4 _qd;
        uniform vec4 _qe;
        uniform vec4 _qf;
        uniform vec4 _qg;
        uniform vec4 _qh;
        uniform vec4 rand_preset;
        #define q1 _qa.x
        #define q2 _qa.y
        #define q3 _qa.z
        #define q4 _qa.w
        #define q5 _qb.x
        #define q6 _qb.y
        #define q7 _qb.z
        #define q8 _qb.w
        #define q9 _qc.x
        #define q10 _qc.y
        #define q11 _qc.z
        #define q12 _qc.w
        #define q13 _qd.x
        #define q14 _qd.y
        #define q15 _qd.z
        #define q16 _qd.w
        #define q17 _qe.x
        #define q18 _qe.y
        #define q19 _qe.z
        #define q20 _qe.w
        #define q21 _qf.x
        #define q22 _qf.y
        #define q23 _qf.z
        #define q24 _qf.w
        #define q25 _qg.x
        #define q26 _qg.y
        #define q27 _qg.z
        #define q28 _qg.w
        #define q29 _qh.x
        #define q30 _qh.y
        #define q31 _qh.z
        #define q32 _qh.w
        #define blur1_min bias1
        #define blur1_max (bias1 + scale1)
        #define blur2_min bias2
        #define blur2_max (bias2 + scale2)
        #define blur3_min bias3
        #define blur3_max (bias3 + scale3)
        #define roam_cos (0.5 + 0.5 * cos(signalTime * vec4(0.3, 1.3, 5.0, 20.0)))
        #define roam_sin (0.5 + 0.5 * sin(signalTime * vec4(0.3, 1.3, 5.0, 20.0)))
        #define slow_roam_cos (0.5 + 0.5 * cos(signalTime * vec4(0.005, 0.008, 0.013, 0.022)))
        #define slow_roam_sin (0.5 + 0.5 * sin(signalTime * vec4(0.005, 0.008, 0.013, 0.022)))
`;

const Q_VAR_NAMES: readonly (readonly [string, string, string, string])[] = [
  ['q1', 'q2', 'q3', 'q4'],
  ['q5', 'q6', 'q7', 'q8'],
  ['q9', 'q10', 'q11', 'q12'],
  ['q13', 'q14', 'q15', 'q16'],
  ['q17', 'q18', 'q19', 'q20'],
  ['q21', 'q22', 'q23', 'q24'],
  ['q25', 'q26', 'q27', 'q28'],
  ['q29', 'q30', 'q31', 'q32'],
];
const Q_UNIFORM_NAMES = [
  '_qa',
  '_qb',
  '_qc',
  '_qd',
  '_qe',
  '_qf',
  '_qg',
  '_qh',
] as const;

/**
 * Emulated 3D noise sampling for preset bodies transpiled from
 * tex3D(sampler_noisevol*, ...): routes through the simplex atlas
 * (source 2.0) with slice blending. The vec2 overload covers bodies
 * that sample the volume texture with a flat coordinate.
 */
const MILKDROP_NOISE_VOLUME_HELPERS = `
        vec4 sampleNoiseVolume(vec3 p) {
          return sampleAuxTexture(2.0, 1.0, p.xy, p.z);
        }

        vec4 sampleNoiseVolume(vec2 p) {
          return sampleAuxTexture2d(2.0, p);
        }
`;

// Aux-texture sampling and the control-driven feedback warp are needed by
// both the feedback-blend pass (warp-texture displacement, legacy warp) and
// the composite pass (overlay/comp-body sampling), so they live in one
// shared chunk instead of drifting apart as duplicates.
const MILKDROP_AUX_SAMPLING_HELPERS = `
        vec2 sampleUv(vec2 uv, float wrapMode) {
          return wrapMode > 0.5 ? fract(uv) : clamp(uv, 0.0, 1.0);
        }

        vec4 sampleAuxTexture2d(float source, vec2 uv) {
          if (source < 0.5) {
            return vec4(0.5, 0.5, 0.5, 1.0);
          }
          if (source < 1.5) {
            return texture2D(noiseTex, uv);
          }
          if (source < 2.5) {
            return texture2D(simplexTex, uv);
          }
          if (source < 3.5) {
            return texture2D(voronoiTex, uv);
          }
          if (source < 4.5) {
            return texture2D(auraTex, uv);
          }
          if (source < 5.5) {
            return texture2D(causticsTex, uv);
          }
          if (source < 6.5) {
            return texture2D(patternTex, uv);
          }
          if (source < 7.5) {
            return texture2D(fractalTex, uv);
          }
          if (source < 8.5) {
            return texture2D(videoTex, uv);
          }
          if (source < 9.5) {
            return texture2D(perlinTex, uv);
          }
          return vec4(0.5, 0.5, 0.5, 1.0);
        }

        vec2 atlasSliceUv(vec2 uv, float sliceIndex) {
          vec2 localUv = mix(vec2(0.01), vec2(0.99), fract(uv));
          float gridSize = ${AUX_TEXTURE_ATLAS_GRID_SIZE.toFixed(1)};
          vec2 tileSize = vec2(1.0 / gridSize);
          float column = mod(sliceIndex, gridSize);
          float row = floor(sliceIndex / gridSize);
          return (vec2(column, row) + localUv) * tileSize;
        }

        vec4 sampleAuxTexture(float source, float sampleDimension, vec2 uv, float sliceZ) {
          vec2 wrappedUv = fract(uv);
          if (sampleDimension < 0.5) {
            return sampleAuxTexture2d(source, wrappedUv);
          }
          float sliceCount = ${AUX_TEXTURE_ATLAS_SLICE_COUNT.toFixed(1)};
          float wrappedSliceZ = fract(sliceZ);
          float scaledSlice = wrappedSliceZ * sliceCount;
          float sliceIndexA = mod(floor(scaledSlice), sliceCount);
          float sliceIndexB = mod(sliceIndexA + 1.0, sliceCount);
          float sliceBlend = fract(scaledSlice);
          float edgeMargin = 0.02;
          if (sliceBlend < edgeMargin) {
            return sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexA));
          }
          if (sliceBlend > 1.0 - edgeMargin) {
            return sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexB));
          }
          vec4 sliceA = sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexA));
          vec4 sliceB = sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexB));
          return mix(sliceA, sliceB, sliceBlend);
        }
`;

// The control-driven feedback warp is shared by the warp pass and the
// feedback-blend pass, and by the WebGPU feedback node, so every stage warps
// with identical math. The warp pass must not define its own variant here —
// divergent formulas made the feedback chain and the fresh-scene sample
// disagree and drove WebGL away from WebGPU.
const MILKDROP_FEEDBACK_WARP_HELPER = `
        vec2 applyFeedbackWarp(vec2 uv, float amount, float rotationAmount) {
          // Zero warp + zero rotation is an identity polar round-trip; skip
          // the atan/sin/cos entirely. Both inputs are uniform-driven, so the
          // branch is coherent across the whole pass.
          if (abs(amount) < 0.000001 && abs(rotationAmount) < 0.000001) {
            return uv;
          }
          vec2 centered = uv - 0.5;
          float radius = length(centered);
          float angle = atan(centered.y, centered.x);
          float spiral = sin(radius * 18.0 - angle * 4.0) * amount * 0.08;
          angle += spiral + rotationAmount * 0.22;
          radius *= 1.0 + cos(angle * 3.0 + radius * 10.0) * amount * 0.05;
          return vec2(cos(angle), sin(angle)) * radius + 0.5;
        }
`;

/**
 * Builds this frame's internal image — the warped previous frame with fresh
 * geometry on top — which is what feeds the next frame's warp pass. MilkDrop
 * never feeds the comp shader's output back into the loop; keeping this
 * blend in its own pass lets the composite pass stay display-only.
 */
const MILKDROP_FEEDBACK_BLEND_FRAGMENT_SHADER = `
        uniform sampler2D currentTex;
        uniform sampler2D warpTex;
        uniform sampler2D noiseTex;
        uniform sampler2D simplexTex;
        uniform sampler2D voronoiTex;
        uniform sampler2D auraTex;
        uniform sampler2D causticsTex;
        uniform sampler2D patternTex;
        uniform sampler2D fractalTex;
        uniform sampler2D videoTex;
        uniform sampler2D perlinTex;
        uniform float videoEchoAlpha;
        uniform float textureWrap;
        uniform float warpScale;
        uniform float offsetX;
        uniform float offsetY;
        uniform float rotation;
        uniform float zoomMul;
        uniform float feedbackSoftness;
        uniform float decay;
        uniform float hasDirectWarp;
        uniform vec2 texelSize;
        uniform float warpTextureSource;
        uniform float warpTextureSampleDimension;
        uniform float warpTextureAmount;
        uniform vec2 warpTextureScale;
        uniform vec2 warpTextureOffset;
        uniform float warpTextureVolumeSliceZ;
        varying vec2 vUv;
${MILKDROP_AUX_SAMPLING_HELPERS}
${MILKDROP_FEEDBACK_WARP_HELPER}
        void main() {
          vec2 centeredUv = vUv - 0.5;
          // Sampling coordinates must invert the intended image transform
          // (rotate backward to find where displayed content came from), so
          // this uses -rotation to make the image visually rotate by +rot,
          // matching the CPU/GPU mesh and motion-vector transform direction.
          float rotSin = -sin(rotation);
          float rotCos = cos(rotation);
          vec2 rotatedUv = vec2(
            centeredUv.x * rotCos - centeredUv.y * rotSin,
            centeredUv.x * rotSin + centeredUv.y * rotCos
          );
          vec2 transformedUv = rotatedUv / max(zoomMul, 0.0001) + vec2(offsetX, offsetY);

          vec2 currentUv = hasDirectWarp > 0.5
            ? transformedUv + 0.5
            : applyFeedbackWarp(transformedUv + 0.5, warpScale, rotation);
          if (warpTextureSource > 0.5 && warpTextureAmount > 0.0001) {
            vec2 warpUv = currentUv * warpTextureScale + warpTextureOffset;
            vec2 warpVector =
              sampleAuxTexture(
                warpTextureSource,
                warpTextureSampleDimension,
                warpUv,
                warpTextureVolumeSliceZ
              ).rg - 0.5;
            currentUv += warpVector * warpTextureAmount * 0.12;
          }
          // Direct-warp presets draw fresh geometry over the already-warped
          // previous frame, so the scene must not be re-warped here.
          vec2 sceneUv = hasDirectWarp > 0.5 ? vUv : currentUv;
          vec4 current = texture2D(currentTex, sampleUv(sceneUv, textureWrap));
          vec4 previous = texture2D(warpTex, sampleUv(vUv, textureWrap));
          vec3 previousColor = previous.rgb;
          if (feedbackSoftness > ${MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD.toFixed(2)}) {
            vec2 off = texelSize * (0.75 + feedbackSoftness * 0.5);
            vec3 softened = (
              previous.rgb * 4.0 +
              texture2D(warpTex, sampleUv(vUv + vec2(off.x, 0.0), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv - vec2(off.x, 0.0), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv + vec2(0.0, off.y), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv - vec2(0.0, off.y), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv + vec2(off.x, off.y), textureWrap)).rgb +
              texture2D(warpTex, sampleUv(vUv - vec2(off.x, off.y), textureWrap)).rgb +
              texture2D(warpTex, sampleUv(vUv + vec2(off.x, -off.y), textureWrap)).rgb +
              texture2D(warpTex, sampleUv(vUv - vec2(off.x, -off.y), textureWrap)).rgb
            ) / 16.0;
            previousColor = mix(
              previousColor,
              softened,
              clamp(feedbackSoftness * ${MILKDROP_FEEDBACK_BLUR_BLEND_SCALE.toFixed(2)}, 0.0, ${MILKDROP_FEEDBACK_BLUR_BLEND_CAP.toFixed(1)})
            );
          }
          // Apply decay to the previous frame color so history dissipates over time.
          previousColor *= decay;
          // With a direct warp shader, feedback is the warped previous frame
          // under this frame's geometry (MilkDrop clears to the warp output);
          // the legacy echo blend stays for control-driven presets.
          vec3 color = hasDirectWarp > 0.5
            ? previousColor + current.rgb
            : mix(
                current.rgb,
                previousColor,
                clamp(videoEchoAlpha, 0.0, 1.0)
              );
          gl_FragColor = vec4(color, 1.0);
        }
      `;

const MILKDROP_BASE_COMPOSITE_FRAGMENT_SHADER = `
        uniform sampler2D internalTex;
        uniform sampler2D currentTex;
        uniform sampler2D previousTex;
        uniform sampler2D noiseTex;
        uniform sampler2D simplexTex;
        uniform sampler2D voronoiTex;
        uniform sampler2D auraTex;
        uniform sampler2D causticsTex;
        uniform sampler2D patternTex;
        uniform sampler2D fractalTex;
        uniform sampler2D videoTex;
        uniform sampler2D perlinTex;
        uniform sampler2D audioTex;
        uniform sampler2D warpTex;
        uniform sampler2D blur1Tex;
        uniform sampler2D blur2Tex;
        uniform sampler2D blur3Tex;
        uniform float scale1;
        uniform float bias1;
        uniform float scale2;
        uniform float bias2;
        uniform float scale3;
        uniform float bias3;
        uniform float videoEchoAlpha;
        uniform float brighten;
        uniform float darken;
        uniform float darkenCenter;
        uniform float solarize;
        uniform float invert;
        uniform float redBlueStereo;
        uniform float gammaAdj;
        uniform float textureWrap;
        uniform float warpScale;
        uniform float offsetX;
        uniform float offsetY;
        uniform float rotation;
        uniform float zoomMul;
        uniform float saturation;
        uniform float contrast;
        uniform vec3 colorScale;
        uniform float hueShift;
        uniform float brightenBoost;
        uniform float invertBoost;
        uniform float solarizeBoost;
        uniform float vignette;
        uniform float chromaticAberration;
        uniform vec3 tint;
        uniform float feedbackSoftness;
        uniform float currentFrameBoost;
        uniform float overlayTextureSource;
        uniform float overlayTextureMode;
        uniform float overlayTextureSampleDimension;
        uniform float overlayTextureInvert;
        uniform float overlayTextureAmount;
        uniform vec2 overlayTextureScale;
        uniform vec2 overlayTextureOffset;
        uniform float overlayTextureVolumeSliceZ;
        uniform float warpTextureSource;
        uniform float warpTextureSampleDimension;
        uniform float warpTextureAmount;
        uniform vec2 warpTextureScale;
        uniform vec2 warpTextureOffset;
        uniform float warpTextureVolumeSliceZ;
        uniform float signalBass;
        uniform float signalMid;
        uniform float signalTreb;
        uniform float signalBassAtt;
        uniform float signalMidAtt;
        uniform float signalTrebAtt;
        uniform float signalPercussive;
        uniform float signalHarmonic;
        uniform float signalPercussiveLow;
        uniform float signalPercussiveMid;
        uniform float signalPercussiveHigh;
        uniform float signalPercussiveRatio;
        uniform float signalBeat;
        uniform float signalBeatPulse;
        uniform float signalEnergy;
        uniform float signalTime;
        uniform float signalFrame;
        uniform float signalFps;
        uniform float decay;
${MILKDROP_SHADER_BUILTIN_DECLARATIONS}
        uniform float hasDirectWarp;
        uniform vec2 texelSize;
        varying vec2 vUv;

        vec3 hueRotate(vec3 color, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          mat3 mat = mat3(
            0.213 + c * 0.787 - s * 0.213,
            0.715 - c * 0.715 - s * 0.715,
            0.072 - c * 0.072 + s * 0.928,
            0.213 - c * 0.213 + s * 0.143,
            0.715 + c * 0.285 + s * 0.140,
            0.072 - c * 0.072 - s * 0.283,
            0.213 - c * 0.213 - s * 0.787,
            0.715 - c * 0.715 + s * 0.715,
            0.072 + c * 0.928 + s * 0.072
          );
          return clamp(mat * color, 0.0, 1.0);
        }

        vec3 applySaturation(vec3 color, float amount) {
          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          return mix(vec3(luminance), color, amount);
        }

        vec3 applyContrast(vec3 color, float amount) {
          return clamp((color - 0.5) * amount + 0.5, 0.0, 1.0);
        }

        float milkdropTrunc(float value) {
          return sign(value) * floor(abs(value));
        }

        float milkdropIntMod(float left, float right) {
          float l = milkdropTrunc(left);
          float r = milkdropTrunc(right);
          if (abs(r) <= 0.000001) return 0.0;
          return l - r * milkdropTrunc(l / r);
        }

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p, int octaves) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            value += amplitude * noise(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
          }
          return value;
        }

${MILKDROP_AUX_SAMPLING_HELPERS}
${MILKDROP_NOISE_VOLUME_HELPERS}
        // MilkDrop's comp shader reads sampler_main as the current
        // *composited* frame — the internal image the feedback-blend pass
        // wrote this frame (warped feedback + geometry). Injected comp
        // bodies have their sampler_main samples rewritten to this helper.
        vec4 sampleCompFrame(vec2 sampleCoord) {
          return texture2D(internalTex, sampleUv(sampleCoord, textureWrap));
        }

        // --- DIRECT_WARP_START ---
        // --- DIRECT_WARP_END ---

        // --- DIRECT_COMP_START ---
        // --- DIRECT_COMP_END ---

        void main() {
          // The feedback-blend pass already built this frame's internal
          // image (warped feedback + geometry). This pass is display-only,
          // matching MilkDrop: nothing computed here feeds the next frame.
          vec3 color = texture2D(internalTex, sampleUv(vUv, textureWrap)).rgb;
          // Uniform branch: skip the sin/cos + mat3 build when no hue shift
          // is active (the common case) — mobile GPUs run transcendentals on
          // a slow special-function unit.
          if (abs(hueShift) > 0.0001) {
            color = hueRotate(color, hueShift);
          }
          color = applySaturation(color, saturation);
          color = applyContrast(color, contrast);
          color *= colorScale;
          color *= tint;

          vec2 uv = vUv;
          vec2 uv_orig = vUv;
          vec3 ret = color;
          float rad = length(vec2((uv.x - 0.5) * aspect.x, (uv.y - 0.5) * aspect.y)) * 2.0;
          float ang = atan(uv.y - 0.5, uv.x - 0.5);

          // --- DIRECT_COMP_START ---
          // --- DIRECT_COMP_END ---

          color = ret;
          bool overlayReplace = overlayTextureMode > 0.5 && overlayTextureMode < 1.5;
          bool overlayBlend = overlayTextureMode >= 1.5 && overlayTextureAmount > 0.0001;
          if (overlayTextureSource > 0.5 && (overlayReplace || overlayBlend)) {
            vec2 overlayUv = vUv * overlayTextureScale + overlayTextureOffset;
            vec3 overlayColor = sampleAuxTexture(
              overlayTextureSource,
              overlayTextureSampleDimension,
              overlayUv,
              overlayTextureVolumeSliceZ
            ).rgb;
            if (overlayTextureInvert > 0.5) {
              overlayColor = 1.0 - overlayColor;
            }
            float amount = clamp(overlayTextureAmount, 0.0, 1.5);
            if (overlayTextureMode < 1.5) {
              color = overlayColor;
            } else if (overlayTextureMode < 2.5) {
              color = mix(color, overlayColor, clamp(amount, 0.0, 1.0));
            } else if (overlayTextureMode < 3.5) {
              color = min(vec3(1.0), color + overlayColor * amount);
            } else if (overlayTextureMode < 4.5) {
              color *= mix(vec3(1.0), overlayColor, clamp(amount, 0.0, 1.0));
            } else {
              color = max(vec3(0.0), color - overlayColor * amount);
            }
          }
          // projectM post-effects order: brighten → darken → solarize → invert
          // → gamma_adj (last). The extra MilkDrop 2/3 effects (darken_center,
          // vignette, chromatic aberration, red-blue stereo) are applied after
          // the core sequence but before gamma.
          if (brighten > 0.01 || brightenBoost > 0.01) {
            color = min(vec3(1.0), mix(color, color * (1.0 + 0.18 + brightenBoost * 0.35), clamp(max(brighten, brightenBoost), 0.0, 1.0)));
          }
          if (darken > 0.5) {
            color = mix(color, color * 0.82, 1.0);
          }
          if (solarize > 0.01 || solarizeBoost > 0.01) {
            float amount = clamp(max(solarize, solarizeBoost), 0.0, 1.0);
            color = mix(color, abs(color - 0.5) * 2.0, amount);
          }
          if (invert > 0.01 || invertBoost > 0.01) {
            float amount = clamp(max(invert, invertBoost), 0.0, 1.0);
            color = mix(color, 1.0 - color, amount);
          }
          if (darkenCenter > 0.5) {
            float centerDist = length(vUv - vec2(0.5));
            float centerMask = clamp(1.0 - centerDist * 1.4, 0.0, 1.0);
            color = mix(color, color * 0.97, smoothstep(0.0, 0.35, centerMask));
          }
          if (vignette > 0.01) {
            float dist = length(vUv - vec2(0.5));
            float vig = clamp(1.0 - dist * (1.0 + vignette * 0.8), 0.0, 1.0);
            color *= mix(vec3(1.0), vec3(vig), clamp(vignette, 0.0, 1.0));
          }
          if (chromaticAberration > 0.01) {
            float amount = clamp(chromaticAberration, 0.0, 1.0);
            vec2 dir = (vUv - vec2(0.5)) * amount * 0.02;
            float r = texture2D(internalTex, sampleUv(vUv + dir, textureWrap)).r;
            float b = texture2D(internalTex, sampleUv(vUv - dir, textureWrap)).b;
            color = vec3(r, color.g, b);
          }
          if (redBlueStereo > 0.5) {
            float stereoOffset = 0.003 + signalEnergy * 0.003;
            vec2 stereoShift = vec2(stereoOffset, 0.0);
            vec3 leftColor = texture2D(internalTex, sampleUv(vUv - stereoShift, textureWrap)).rgb;
            vec3 rightColor = texture2D(internalTex, sampleUv(vUv + stereoShift, textureWrap)).rgb;
            color = mix(color, vec3(leftColor.r, rightColor.g, rightColor.b), 0.85);
          }
          // Uniform branch: gamma is 1.0 for most presets, and pow costs
          // three log/exp pairs per pixel. Sibling effects above are already
          // uniform-guarded; this was the one that wasn't.
          if (abs(gammaAdj - 1.0) > 0.0001) {
            color = pow(max(color, vec3(0.0)), vec3(1.0 / max(gammaAdj, 0.0001)));
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `;

const MILKDROP_WARP_FRAGMENT_SHADER = `
        uniform sampler2D currentTex;
        uniform sampler2D previousTex;
        uniform sampler2D warpTex;
        uniform sampler2D blur1Tex;
        uniform sampler2D blur2Tex;
        uniform sampler2D blur3Tex;
        uniform vec2 texelSize;
        uniform sampler2D noiseTex;
        uniform sampler2D simplexTex;
        uniform sampler2D voronoiTex;
        uniform sampler2D auraTex;
        uniform sampler2D causticsTex;
        uniform sampler2D patternTex;
        uniform sampler2D fractalTex;
        uniform sampler2D videoTex;
        uniform sampler2D perlinTex;
        uniform sampler2D audioTex;
        uniform float scale1;
        uniform float bias1;
        uniform float scale2;
        uniform float bias2;
        uniform float scale3;
        uniform float bias3;
        uniform float warpScale;
        uniform float zoom;
        uniform float zoomMul;
        uniform float rotation;
        uniform float offsetX;
        uniform float offsetY;
        uniform float textureWrap;
        uniform float warpTextureSource;
        uniform float warpTextureSampleDimension;
        uniform float warpTextureAmount;
        uniform vec2 warpTextureScale;
        uniform vec2 warpTextureOffset;
        uniform float warpTextureVolumeSliceZ;
        uniform float hasDirectWarp;
        uniform float signalBass;
        uniform float signalMid;
        uniform float signalTreb;
        uniform float signalBassAtt;
        uniform float signalMidAtt;
        uniform float signalTrebAtt;
        uniform float signalPercussive;
        uniform float signalHarmonic;
        uniform float signalPercussiveLow;
        uniform float signalPercussiveMid;
        uniform float signalPercussiveHigh;
        uniform float signalPercussiveRatio;
        uniform float signalBeat;
        uniform float signalBeatPulse;
        uniform float signalEnergy;
        uniform float signalTime;
        uniform float signalFrame;
        uniform float signalFps;
        uniform float videoEchoOrientation;
${MILKDROP_SHADER_BUILTIN_DECLARATIONS}
        varying vec2 vUv;

        float sq(float x) { return x * x; }
        float cube(float x) { return x * x * x; }
        float sigmoid(float x, float sharpness) { return 1.0 / (1.0 + exp(-x * sharpness)); }
        float between(float val, float low, float high) { return step(low, val) * step(val, high); }
        float above(float val, float threshold) { return step(threshold, val); }
        float below(float val, float threshold) { return 1.0 - step(threshold, val); }
        float equalF(float a, float b) { return 1.0 - step(0.0001, abs(a - b)); }
        float milkdropTrunc(float value) { return sign(value) * floor(abs(value)); }
        float milkdropIntMod(float left, float right) {
          float l = milkdropTrunc(left);
          float r = milkdropTrunc(right);
          if (abs(r) <= 0.000001) return 0.0;
          return l - r * milkdropTrunc(l / r);
        }
        float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 uv) { vec2 i = floor(uv); vec2 f = fract(uv); f = f*f*(3.0-2.0*f); return mix(mix(rand(i+vec2(0.0,0.0)), rand(i+vec2(1.0,0.0)), f.x), mix(rand(i+vec2(0.0,1.0)), rand(i+vec2(1.0,1.0)), f.x), f.y); }

${MILKDROP_AUX_SAMPLING_HELPERS}
${MILKDROP_NOISE_VOLUME_HELPERS}
${MILKDROP_FEEDBACK_WARP_HELPER}
        vec2 applyVideoEchoOrientationTransform(vec2 uv, float orientation) {
          float flipU = step(0.5, mod(orientation, 2.0));
          float flipV = step(1.5, mod(orientation, 4.0));
          return vec2(
            mix(uv.x, 1.0 - uv.x, flipU),
            mix(uv.y, 1.0 - uv.y, flipV)
          );
        }

        // --- DIRECT_WARP_GLOBALS_START ---
        // --- DIRECT_WARP_GLOBALS_END ---

        void main() {
          vec2 centeredUv = vUv - 0.5;
          // See the composite pass's identical comment: sampling coords
          // invert the rotation direction relative to point transforms.
          float rotSin = -sin(rotation);
          float rotCos = cos(rotation);
          vec2 rotatedUv = vec2(centeredUv.x * rotCos - centeredUv.y * rotSin, centeredUv.x * rotSin + centeredUv.y * rotCos);
          vec2 transformedUv = rotatedUv / max(zoomMul, 0.0001) + vec2(offsetX, offsetY);

          vec2 uv = transformedUv + 0.5;
          vec2 uv_orig = vUv;
          vec3 ret = texture2D(currentTex, sampleUv(uv, textureWrap)).rgb;
          float rad = length(vec2((uv.x - 0.5) * aspect.x, (uv.y - 0.5) * aspect.y)) * 2.0;
          float ang = atan(uv.y - 0.5, uv.x - 0.5);

          // --- DIRECT_WARP_START ---
          // --- DIRECT_WARP_END ---

          if (hasDirectWarp > 0.5) {
            // The injected warp body computed this fragment's warped feedback
            // sample into ret; it IS this pass's output.
            gl_FragColor = vec4(ret, 1.0);
            return;
          }

          vec2 currentUv = hasDirectWarp > 0.5
            ? transformedUv + 0.5
            : applyFeedbackWarp(transformedUv + 0.5, warpScale, rotation);
          vec2 prevUv = hasDirectWarp > 0.5
            ? (currentUv - 0.5) / max(zoom, 0.0001) + 0.5
            : applyFeedbackWarp(
                (currentUv - 0.5) / max(zoom, 0.0001) + 0.5,
                warpScale * 0.8,
                rotation * 0.6
              );
          if (warpTextureSource > 0.5 && warpTextureAmount > 0.0001) {
            vec2 warpUv = currentUv * warpTextureScale + warpTextureOffset;
            vec2 warpVector =
              sampleAuxTexture(
                warpTextureSource,
                warpTextureSampleDimension,
                warpUv,
                warpTextureVolumeSliceZ
              ).rg - 0.5;
            prevUv += warpVector * warpTextureAmount * 0.08;
          }
          prevUv = applyVideoEchoOrientationTransform(prevUv, videoEchoOrientation);
          gl_FragColor = texture2D(previousTex, sampleUv(prevUv, textureWrap));
        }
      `;

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
    for (const match of stripShaderComments(template).matchAll(
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/gu,
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

  const perFrameVariables = extractReferencedPerFrameVariables([
    warpGlobals,
    warpBody,
    cleanCompBody,
  ]);
  const perFrameVariableDeclarations = perFrameVariables
    .map((name) => `uniform float ${name};\n`)
    .join('');

  const warp =
    perFrameVariableDeclarations +
    buildCustomSamplerUniformDeclarations([warpGlobals, warpBody]) +
    injectDirectShaderGlsl(
      MILKDROP_WARP_FRAGMENT_SHADER,
      warpBody,
      null,
      warpGlobals,
    );

  // Build composite shader: warp section kept empty since warp runs separate
  const composite =
    perFrameVariableDeclarations +
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
  private savedFrameTarget: WebGLRenderTarget | null = null;
  private readonly halfFloatFeedback: boolean;
  private lastRenderer: {
    render(scene: Scene, camera: Camera): void;
    setRenderTarget?: (target: WebGLRenderTarget | null) => void;
  } | null = null;
  readonly profile: FeedbackBackendProfile;
  readonly auxTextures: SharedAuxTextureMap;
  private blurEnabled = false;
  private lastWarpGlsl: string | null = null;
  private lastCompGlsl: string | null = null;
  /** Bumped per shader swap so a stale async warm-up can't apply. */
  private directShaderSwapRevision = 0;
  /** Warm-up materials kept alive until the live materials share their
   * programs; see setDirectShaderPrograms. */
  private retiredWarmupMaterials: ShaderMaterial[] = [];
  private perFrameShaderVariables: string[] = [];
  private customSamplers: MilkdropCustomSamplerDeclaration[] = [];
  readonly warpMaterial: ShaderMaterial;
  readonly warpScene: Scene;

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
        blur1Tex: { value: this.blurTargets[0].texture },
        blur2Tex: { value: this.blurTargets[1].texture },
        blur3Tex: { value: this.blurTargets[2].texture },
        texelSize: { value: new Vector2(1, 1) },
        noiseTex: { value: this.auxTextures.noise },
        simplexTex: { value: this.auxTextures.simplex },
        voronoiTex: { value: this.auxTextures.voronoi },
        auraTex: { value: this.auxTextures.aura },
        causticsTex: { value: this.auxTextures.caustics },
        patternTex: { value: this.auxTextures.pattern },
        fractalTex: { value: this.auxTextures.fractal },
        videoTex: { value: this.auxTextures.video },
        perlinTex: { value: this.auxTextures.perlin },
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
          // The saved frame is a static snapshot; zoom it slowly as it
          // dissolves out (alpha runs 1 -> 0) so the outgoing image keeps
          // moving instead of freezing for the whole blend.
          float drift = 1.0 +
            ${MILKDROP_BLEND_DISSOLVE.savedZoomDrift.toFixed(4)} * (1.0 - a);
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
        audioTex: { value: null },
        warpTex: { value: this.warpTarget.texture },
        blur1Tex: { value: this.blurTargets[0].texture },
        blur2Tex: { value: this.blurTargets[1].texture },
        blur3Tex: { value: this.blurTargets[2].texture },
        ...BLUR_RANGE_UNIFORM_DEFAULTS,
        videoEchoAlpha: { value: 0 },
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
  }

  saveCurrentFrame(): void {
    if (!this.savedFrameTarget) {
      this.savedFrameTarget = createWebGLFeedbackRenderTarget(
        this.viewportWidth,
        this.viewportHeight,
        {
          resolutionScale: this.currentFeedbackResolutionScale,
          useHalfFloatFeedback: this.halfFloatFeedback,
          samples: 1,
        },
      );
    }
    if (
      this.savedFrameTarget.width !== this.readTarget.width ||
      this.savedFrameTarget.height !== this.readTarget.height
    ) {
      this.savedFrameTarget.setSize(
        this.readTarget.width,
        this.readTarget.height,
      );
    }
    const renderer = this.lastRenderer;
    if (!renderer?.setRenderTarget) return;
    renderer.setRenderTarget(this.savedFrameTarget);
    const oldAlpha = this.presentMaterial.uniforms.transitionAlpha.value;
    this.presentMaterial.uniforms.transitionAlpha.value = 0;
    renderer.render(this.presentScene, this.camera);
    this.presentMaterial.uniforms.transitionAlpha.value = oldAlpha;
    this.presentMaterial.uniforms.savedTex.value =
      this.savedFrameTarget.texture;
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

    const renderer = this.lastRenderer as
      | (NonNullable<SharedMilkdropFeedbackManager['lastRenderer']> & {
          compileAsync?: (scene: Scene, camera: Camera) => Promise<unknown>;
        })
      | null;
    const hasCustomShaders = warpGlsl !== null || compGlsl !== null;
    const compileAsync = renderer?.compileAsync?.bind(renderer);
    if (!hasCustomShaders || !compileAsync) {
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
    renderer: {
      render(scene: Scene, camera: Camera): void;
      setRenderTarget?: (target: RenderTarget | null) => void;
    },
    sourceScene: Scene,
    sourceCamera: Camera,
  ) {
    if (!renderer.setRenderTarget) {
      return false;
    }

    this.lastRenderer =
      renderer as SharedMilkdropFeedbackManager['lastRenderer'];

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(sourceScene, sourceCamera);

    renderer.setRenderTarget(this.warpTarget);
    renderer.render(this.warpScene, this.camera);

    // Internal frame (feedback loop): warped previous + fresh geometry.
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.feedbackBlendScene, this.camera);

    this.compositeMaterial.uniforms.internalTex.value =
      this.writeTarget.texture;

    const transitionAlpha =
      (this.presentMaterial.uniforms.transitionAlpha?.value as
        | number
        | undefined) ?? 0;

    if (transitionAlpha > 0.001) {
      renderer.setRenderTarget(this.displayTarget);
      renderer.render(this.compositeScene, this.camera);

      if (
        this.blurEnabled &&
        this.profile.feedbackSoftness > MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD
      ) {
        this.renderBlurPasses(renderer);
      }

      renderer.setRenderTarget(null);
      renderer.render(this.presentScene, this.camera);
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
    this.sceneTarget.setSize(sceneWidth, sceneHeight);
    this.warpTarget.setSize(feedbackWidth, feedbackHeight);
    this.targets.forEach((target) =>
      target.setSize(feedbackWidth, feedbackHeight),
    );
    this.displayTarget.setSize(feedbackWidth, feedbackHeight);
    if (this.savedFrameTarget) {
      this.savedFrameTarget.setSize(feedbackWidth, feedbackHeight);
    }
    for (let level = 0; level < BLUR_LEVEL_SCALES.length; level += 1) {
      const levelWidth = Math.max(
        1,
        Math.round(feedbackWidth * BLUR_LEVEL_SCALES[level]),
      );
      const levelHeight = Math.max(
        1,
        Math.round(feedbackHeight * BLUR_LEVEL_SCALES[level]),
      );
      this.blurTargets[level].setSize(levelWidth, levelHeight);
      this.blurHTargets[level].setSize(levelWidth, levelHeight);
    }
    this.compositeMaterial.uniforms.texelSize.value.set(
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
    this.targets.forEach((target) => target.dispose());
    this.displayTarget.dispose();
    this.blurTargets.forEach((target) => target.dispose());
    this.blurHTargets.forEach((target) => target.dispose());
    this.savedFrameTarget?.dispose();
    this.savedFrameTarget = null;
    disposeMaterial(this.compositeMaterial);
    disposeMaterial(this.presentMaterial);
    disposeMaterial(this.blurHMaterial);
    disposeMaterial(this.blurVMaterial);
    disposeMaterial(this.warpMaterial);
    disposeMaterial(this.feedbackBlendMaterial);
    // Invalidate any in-flight async shader warm-up and drop its materials.
    this.directShaderSwapRevision += 1;
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
