/**
 * Builds the WebGPU feedback pipeline as Three.js TSL node graphs.
 *
 * The WebGPU backend does not consume the GLSL strings the WebGL path uses. It
 * builds equivalent shaders as TSL node graphs instead, which means every
 * preset shader construct needs a second lowering — from the parsed shader AST
 * to nodes — implemented here alongside the blur, warp and composite passes.
 *
 * That duplication is the file's size and its main hazard: this is the second
 * of two implementations that must agree pixel-for-pixel with the first, on
 * hardware many contributors do not have. Nothing fails loudly when they
 * diverge — the preset just looks slightly wrong somewhere else. Treat
 * `bun run lab:gpu-differential` as part of editing this file, not as an
 * optional follow-up.
 *
 * The file-level `noExplicitAny` suppression is deliberate: TSL's node graphs
 * are not fully typed under the repo's current module resolution.
 */
// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.

import type { Camera, Texture } from 'three';
import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  Vector4,
} from 'three';
import { NodeMaterial, type RenderTarget, TSL } from 'three/webgpu';
import { isAgentMode } from '../core/agent-api.ts';
import { createLogger } from '../core/logger.ts';
import { disposeMaterial } from '../utils/three/three-dispose';
import { MilkdropFeedbackManagerLifecycleBase } from './feedback-manager-lifecycle.ts';
import {
  applyCompositeUniformState,
  type FeedbackSceneRenderer,
  renderSceneIntoFeedbackTarget,
  resolveMilkdropBlurShaderRanges,
} from './feedback-manager-shared.ts';
import {
  type CompositeUniformBag,
  createApplyFeedbackWarpNode,
  createCompositeUniforms,
  createFeedbackRenderTarget,
  createSampleAuxTextureNode,
  createSampleUvNode,
  createScreenSampleUvNode,
  type FeedbackRendererLike,
  getShared3dAuxTexture,
  getSharedMilkdropAuxTextures,
  getSharedMilkdropTexture,
  hasOverlayBlendFeedback,
  hasOverlayReplaceFeedback,
  hasWarpTextureFeedback,
  MILKDROP_TEXTURE_FILES,
  resolveAuxTextureName,
  sampleFeedbackTarget,
} from './feedback-manager-webgpu-composite.ts';
import {
  type OutputConversionRenderer,
  renderWithoutOutputConversion,
} from './output-conversion-passthrough.ts';
import type { TslNode } from './renderer-helpers/tsl-node-types.ts';

export {
  resolveDirectShaderSamplerBinding,
  resolveDirectShaderSwizzle,
} from './feedback-manager-webgpu-bindings.ts';

import { isMobileDevice } from '../utils/browser/device-detect';
import {
  type FeedbackBackendProfile,
  getFeedbackBackendProfile,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from './backend-behavior';
import {
  MILKDROP_BLEND_DISSOLVE,
  MILKDROP_FEEDBACK_BLUR_OFFSET_BASE,
  MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE,
  MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD,
} from './feedback-composite-profile.ts';
import {
  resolveDirectShaderSamplerBinding,
  resolveDirectShaderSwizzle,
} from './feedback-manager-webgpu-bindings.ts';
import {
  type MilkdropShaderValueKind,
  resolveMilkdropShaderConstructorPattern,
} from './shader-expression-shared.ts';
import type {
  MilkdropExpressionNode,
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropPostprocessingProfile,
  MilkdropShaderExpressionNode,
  MilkdropShaderProgramPayload,
  MilkdropShaderStatement,
} from './types';
import { perPixelWritesWarpTransform } from './warp-sample-transform.ts';

const tslLog = createLogger('MilkdropTSL');

const {
  abs,
  acos,
  asin,
  atan,
  bool,
  ceil,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  exp2,
  Fn,
  floor,
  float,
  fract,
  fwidth,
  If,
  int,
  inversesqrt,
  length,
  log,
  log2,
  mat3,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  refract,
  round,
  select,
  sign,
  sin,
  smoothstep,
  step,
  tan,
  texture,
  transpose,
  trunc,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

const FULLSCREEN_QUAD_GEOMETRY = new PlaneGeometry(2, 2);
const GAUSSIAN_BLUR_KERNEL_RADIUS = 4;

/**
 * Native shader bodies are rewritten by normalizeHlslToGlsl before the AST
 * is built (sampler_blur1 → blur1Tex, sampler_fw_main → currentTex, ...), so
 * the sampler argument the TSL path sees is a texture uniform identifier, not
 * a sampler_* name. This map folds those identifiers back onto the canonical
 * sampler names the binding table resolves.
 */
const TEXTURE_IDENTIFIER_TO_SAMPLER: Record<string, string> = {
  currenttex: 'main',
  previoustex: 'pw_main',
  warptex: 'fc_main',
  noisetex: 'noise',
  simplextex: 'simplex',
  perlintex: 'perlin',
  voronoitex: 'voronoi',
  auratex: 'aura',
  causticstex: 'caustics',
  patterntex: 'pattern',
  fractaltex: 'fractal',
  videotex: 'video',
  glyphtex: 'glyph',
  organictex: 'organic',
  blur1tex: 'blur1',
  blur2tex: 'blur2',
  blur3tex: 'blur3',
};

/**
 * Screen-space wrap/clamp for uploaded textures, built once: the sampler
 * variants that take an explicit LOD or gradient cannot route through
 * sampleFeedbackTarget, so they select their coordinate space by hand.
 */
const screenSampleUvNode = /* @__PURE__ */ createScreenSampleUvNode();

/** Reused so clearing the feedback chain allocates nothing. */
const CLEAR_HISTORY_COLOR_SCRATCH = /* @__PURE__ */ new Color();

/** Shader sampler sources backed by one of the feedback manager's own targets. */
const RENDER_TARGET_SHADER_SOURCES = new Set([
  'main',
  'pw_main',
  'pc_main',
  'fc_main',
  'blur1',
  'blur2',
  'blur3',
]);

function resolveDirectShaderTextureNode(
  env: ShaderNodeEnv,
  canonicalSource: string,
): any {
  const uniforms = env.uniforms;
  switch (canonicalSource) {
    case 'main':
      return uniforms.currentTex;
    case 'pw_main':
    case 'pc_main':
      return uniforms.previousTex;
    case 'fc_main':
      return uniforms.warpTex;
    case 'blur1':
      return uniforms.blur1Tex;
    case 'blur2':
      return uniforms.blur2Tex;
    case 'blur3':
      return uniforms.blur3Tex;
    case 'noise':
      return uniforms.noiseTex;
    case 'noise_lq':
      return uniforms.noiseLqTex;
    case 'noisevol':
      return uniforms.noisevolTex;
    case 'perlin':
      return uniforms.perlinTex;
    case 'simplex':
      return uniforms.simplexTex;
    case 'voronoi':
      return uniforms.voronoiTex;
    case 'aura':
      return uniforms.auraTex;
    case 'caustics':
      return uniforms.causticsTex;
    case 'pattern':
      return uniforms.patternTex;
    case 'fractal':
      return uniforms.fractalTex;
    case 'video':
      return uniforms.videoTex;
    case 'glyph':
      return uniforms.glyphTex;
    case 'organic':
      return uniforms.organicTex;
    default:
      return null;
  }
}

function createGaussianBlurUniforms(initialSource: Texture) {
  return {
    sourceTex: texture(initialSource),
    texelSize: uniform(new Vector2(1, 1)),
    blurDirection: uniform(new Vector2(1, 0)),
    // Center weight + the 4 symmetric off-center weights, normalized so the
    // shader needs no weight-sum divide. Computed CPU-side per sigma change;
    // the previous in-shader exp() evaluated 9 identical Gaussians per pixel.
    kernelCenterWeight: uniform(1),
    kernelSideWeights: uniform(new Vector4(0, 0, 0, 0)),
    blurPixelStep: uniform(1),
  };
}

/** Normalized 9-tap Gaussian kernel for the given sigma. */
export function computeGaussianBlurKernelWeights(sigma: number) {
  const twoSigmaSq = Math.max(2 * sigma * sigma, 0.0001);
  const side = [1, 2, 3, 4].map((tap) => Math.exp(-(tap * tap) / twoSigmaSq));
  const sum = 1 + 2 * (side[0] + side[1] + side[2] + side[3]);
  return {
    center: 1 / sum,
    side: side.map((weight) => weight / sum) as [
      number,
      number,
      number,
      number,
    ],
  };
}

function createGaussianBlurOutputNode(
  blurUniforms: ReturnType<typeof createGaussianBlurUniforms>,
) {
  return Fn(() => {
    const centerUv = uv();
    const offset = blurUniforms.blurDirection.mul(
      blurUniforms.texelSize.mul(blurUniforms.blurPixelStep),
    );
    const sideWeights = [
      blurUniforms.kernelSideWeights.x,
      blurUniforms.kernelSideWeights.y,
      blurUniforms.kernelSideWeights.z,
      blurUniforms.kernelSideWeights.w,
    ];
    let weightedColor = sampleFeedbackTarget(
      blurUniforms.sourceTex,
      centerUv,
    ).mul(blurUniforms.kernelCenterWeight);

    for (let tap = 1; tap <= GAUSSIAN_BLUR_KERNEL_RADIUS; tap += 1) {
      const weight = sideWeights[tap - 1];
      const tapOffset = offset.mul(float(tap));
      weightedColor = weightedColor.add(
        sampleFeedbackTarget(
          blurUniforms.sourceTex,
          centerUv.add(tapOffset),
        ).mul(weight),
      );
      weightedColor = weightedColor.add(
        sampleFeedbackTarget(
          blurUniforms.sourceTex,
          centerUv.sub(tapOffset),
        ).mul(weight),
      );
    }

    return weightedColor;
  })();
}

function createPresentUniforms(initialSource: Texture) {
  return {
    currentTex: texture(initialSource),
    savedTex: texture(initialSource),
    transitionAlpha: uniform(0),
    patternAspect: uniform(16 / 9),
    // Display-frame postprocessing (profile-driven). Applied here — over the
    // COMPOSITED frame the present pass samples — never inside the composite
    // pass, which cannot take neighbor samples of its own output.
    postBloomStrength: uniform(0),
    postBloomRadius: uniform(0.5),
    postBloomThreshold: uniform(0.85),
    postChromaticAberration: uniform(0),
    postTexelSize: uniform(new Vector2(1 / 1280, 1 / 720)),
  };
}

function createPresentOutputNode(
  uniforms: ReturnType<typeof createPresentUniforms>,
) {
  // MilkDrop-style dissolve, mirroring the WebGL present shader in
  // feedback-manager-shared.ts: a static noise pattern sets when each pixel
  // flips from the saved frame to the live preset, so the transition sweeps
  // through the image in organic patches instead of one flat fade. Knobs
  // live in MILKDROP_BLEND_DISSOLVE (feedback-composite-profile.ts).
  // Sin-free hash (Dave Hoskins): fract(sin(x) * 43758.5453) breaks down on
  // mediump mobile GPUs (Mali/Adreno) and costs more there.
  const hash21 = (p: any) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
    const q = p3.add(dot(p3, p3.yzx.add(33.33)));
    return fract(q.x.add(q.y).mul(q.z));
  };
  // p is a 2D sample point: `u` below swizzles .x/.y, which only exists if
  // the parameter says it is a vec2 rather than `any`.
  const valueNoise = (p: TslNode<'vec2'>) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
    const a = hash21(i);
    const b = hash21(i.add(vec2(1.0, 0.0)));
    const c = hash21(i.add(vec2(0.0, 1.0)));
    const d = hash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  };
  const {
    coarseScale,
    fineScale,
    coarseWeight,
    fineOffset,
    band,
    savedZoomDrift,
  } = MILKDROP_BLEND_DISSOLVE;
  return Fn(() => {
    // Screen space for the effect math below, render-target space for the
    // reads themselves.
    const presentUv = uv();
    const current = sampleFeedbackTarget(uniforms.currentTex, presentUv);
    const base = current.rgb.toVar();

    // Chromatic aberration over the composited frame (profile-driven).
    If(step(0.0001, uniforms.postChromaticAberration), () => {
      const offset = presentUv
        .sub(0.5)
        .mul(uniforms.postChromaticAberration)
        .mul(uniforms.postTexelSize);
      const red = sampleFeedbackTarget(
        uniforms.currentTex,
        clamp(presentUv.add(offset), vec2(0), vec2(1)),
      ).r;
      const blue = sampleFeedbackTarget(
        uniforms.currentTex,
        clamp(presentUv.sub(offset), vec2(0), vec2(1)),
      ).b;
      base.assign(vec3(red, base.g, blue));
    });

    // Bloom over the composited frame (profile-driven).
    If(step(0.0001, uniforms.postBloomStrength), () => {
      const texel = uniforms.postTexelSize.mul(
        max(uniforms.postBloomRadius, 0.0001),
      );
      const top = sampleFeedbackTarget(
        uniforms.currentTex,
        clamp(presentUv.add(vec2(0, texel.y), vec2(0), vec2(1))),
      ).rgb;
      const bottom = sampleFeedbackTarget(
        uniforms.currentTex,
        clamp(presentUv.sub(vec2(0, texel.y), vec2(0), vec2(1))),
      ).rgb;
      const left = sampleFeedbackTarget(
        uniforms.currentTex,
        clamp(presentUv.sub(vec2(texel.x, 0), vec2(0), vec2(1))),
      ).rgb;
      const right = sampleFeedbackTarget(
        uniforms.currentTex,
        clamp(presentUv.add(vec2(texel.x, 0), vec2(0), vec2(1))),
      ).rgb;
      const blurred = top.add(bottom).add(left).add(right).div(4);
      const lum = dot(blurred, vec3(0.299, 0.587, 0.114));
      // UnrealBloom-style luminosity high-pass: add only the ABOVE-THRESHOLD
      // portion of the blurred neighborhood. Adding the full blurred color
      // under a threshold mask washed uniformly bright frames (noisevol comp
      // marble) toward white — ~40% clipped pixels vs ~1% on WebGL.
      const excess = max(lum.sub(uniforms.postBloomThreshold), 0).div(
        max(lum, 0.0001),
      );
      base.assign(
        base.add(blurred.mul(excess).mul(uniforms.postBloomStrength)),
      );
    });

    const result = vec4(max(base, vec3(0)), current.a).toVar();
    const linearA = clamp(uniforms.transitionAlpha, 0, 1);
    // Uniform branch mirroring the WebGL shader's early-out: the present
    // pass runs full-screen every frame, so outside a preset transition the
    // GPU must skip the dissolve math entirely (transitionAlpha is a
    // uniform, so this is uniform control flow and genuinely branches).
    If(linearA.greaterThan(0.001), () => {
      // Ease the global progression so the wipe starts and ends gently
      // instead of snapping into motion off the linear alpha ramp.
      const a = smoothstep(0.0, 1.0, linearA);
      // The saved frame is a static snapshot; zoom it slowly as it
      // dissolves out (alpha runs 1 -> 0) so the outgoing image keeps
      // moving instead of freezing for the whole blend.
      const drift = a.oneMinus().mul(savedZoomDrift).add(1.0);
      const savedUv = uv().sub(0.5).div(drift).add(0.5);
      const saved = sampleFeedbackTarget(uniforms.savedTex, savedUv);
      // Aspect-corrected sample point keeps dissolve patches round on any
      // viewport instead of stretched across the wide axis.
      const p = vec2(uv().x.mul(uniforms.patternAspect), uv().y);
      const pattern = valueNoise(p.mul(coarseScale))
        .mul(coarseWeight)
        .add(
          valueNoise(p.mul(fineScale).add(fineOffset)).mul(1 - coarseWeight),
        );
      // Remap so a=1 keeps every pixel on the saved frame and a=0 releases
      // every pixel, regardless of where its pattern threshold landed.
      const aa = a.mul(1.0 + 2.0 * band).sub(band);
      const local = smoothstep(pattern.sub(band), pattern.add(band), aa);
      const currentSq = current.rgb.mul(current.rgb);
      const savedSq = saved.rgb.mul(saved.rgb);
      const blendedRgb = mix(currentSq, savedSq, local).sqrt();
      const blendedAlpha = mix(current.a, saved.a, local);
      result.assign(vec4(blendedRgb, blendedAlpha));
    });
    return result;
  })();
}

type ShaderNodeValue = {
  kind: 'scalar' | 'vec2' | 'vec3' | 'vec4' | 'mat2';
  node: any;
};

type ShaderBinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||'
  | '&'
  | '|';

export type ShaderNodeEnv = {
  values: Map<string, ShaderNodeValue>;
  uniforms: CompositeUniformBag;
  /**
   * When present, every name `getShaderEnvValue` fails to resolve is recorded
   * here instead of vanishing. A null resolution is not an error by itself —
   * `runPerPixelProgram` drops the whole statement, which is the correct
   * fallback — but it must never be silent: an unbound `rad` once dropped the
   * per-pixel warp of 922 bundled presets and nothing anywhere said so.
   */
  unresolvedNames?: Set<string>;
  sampleUvNode: ReturnType<typeof createSampleUvNode>;
  sampleAuxTextureNode: CompositeAuxSampler;
  /** Stage-specific meaning of sampler_main. The comp stage sets this to the
   * reconstructed composited frame (feedback + geometry); without it, main
   * samples fall back to the geometry-only scene texture. */
  sampleMainNode?: (uvNode: any) => any;
};

type DirectShaderSwizzleComponent = 'x' | 'y' | 'z' | 'w';

/**
 * `colorValue` is declared as a vec3 rather than `any` so the mat3 multiply
 * below resolves to the vec3 overload. Left as `any`, three infers
 * `mat3.mul(any)` as returning another mat3, and the surrounding `clamp`
 * against vec3 bounds then has no matching overload.
 */
function hueRotateNode(colorValue: TslNode<'vec3'>, angle: TslNode<'float'>) {
  return Fn(() => {
    const s = sin(angle);
    const c = cos(angle);
    const rotationMatrix = mat3(
      float(0.213).add(c.mul(0.787)).sub(s.mul(0.213)),
      float(0.715).sub(c.mul(0.715)).sub(s.mul(0.715)),
      float(0.072).sub(c.mul(0.072)).add(s.mul(0.928)),
      float(0.213).sub(c.mul(0.213)).add(s.mul(0.143)),
      float(0.715).add(c.mul(0.285)).add(s.mul(0.14)),
      float(0.072).sub(c.mul(0.072)).sub(s.mul(0.283)),
      float(0.213).sub(c.mul(0.213)).sub(s.mul(0.787)),
      float(0.715).sub(c.mul(0.715)).add(s.mul(0.715)),
      float(0.072).add(c.mul(0.928)).add(s.mul(0.072)),
    );
    return clamp(rotationMatrix.mul(colorValue), vec3(0), vec3(1));
  })();
}

function applySaturationNode(colorValue: any, amount: any) {
  return Fn(() => {
    const luminance = dot(colorValue, vec3(0.299, 0.587, 0.114));
    return mix(vec3(luminance), colorValue, amount);
  })();
}

function applyContrastNode(colorValue: any, amount: any) {
  return clamp(colorValue.sub(0.5).mul(amount).add(0.5), vec3(0), vec3(1));
}

function makeShaderValue(
  kind: ShaderNodeValue['kind'],
  node: any,
): ShaderNodeValue {
  return { kind, node };
}

function shaderFloat(value: any) {
  return makeShaderValue(
    'scalar',
    typeof value === 'number' ? float(value) : value,
  );
}

function shaderVec2(x: any, y: any) {
  return makeShaderValue('vec2', vec2(x, y));
}

function shaderVec3(x: any, y: any, z: any) {
  return makeShaderValue('vec3', vec3(x, y, z));
}

function shaderVec4(x: any, y: any, z: any, w: any) {
  return makeShaderValue('vec4', vec4(x, y, z, w));
}

/**
 * A mat2 is represented as a vec4 packing its two columns
 * ([c0.x, c0.y, c1.x, c1.y]) so no separate TSL matrix node is needed and
 * column reads/writes reduce to swizzles.
 */
function shaderMat2(c0: ShaderNodeValue, c1: ShaderNodeValue) {
  return makeShaderValue(
    'mat2',
    vec4(c0.node.x, c0.node.y, c1.node.x, c1.node.y),
  );
}

function shaderMat2Column(value: ShaderNodeValue, index: number) {
  return index === 0
    ? shaderVec2(value.node.x, value.node.y)
    : shaderVec2(value.node.z, value.node.w);
}

const ZERO_MAT2 = shaderMat2(
  shaderVec2(float(0), float(0)),
  shaderVec2(float(0), float(0)),
);

/**
 * `M[i] = v` — replace one mat2 column.
 */
function setMat2Column(
  value: ShaderNodeValue | null,
  index: number,
  nextValue: ShaderNodeValue,
): ShaderNodeValue {
  const base = value ?? ZERO_MAT2;
  const c0 = shaderMat2Column(base, 0);
  const c1 = shaderMat2Column(base, 1);
  const assigned = coerceShaderValue(nextValue, 'vec2');
  return index === 0 ? shaderMat2(assigned, c1) : shaderMat2(c0, assigned);
}

/**
 * `M[i].x = v` — mutate one component of one mat2 column.
 */
function setMat2Component(
  value: ShaderNodeValue | null,
  index: number,
  component: string,
  nextValue: ShaderNodeValue,
): ShaderNodeValue {
  const base = value ?? ZERO_MAT2;
  const c0 = shaderMat2Column(base, 0);
  const c1 = shaderMat2Column(base, 1);
  const columnNode = (index === 0 ? c0 : c1).node.toVar();
  const assigned = coerceShaderValue(nextValue, 'scalar').node;
  if (component === 'x' || component === 'r') {
    columnNode.x.assign(assigned);
  } else {
    columnNode.y.assign(assigned);
  }
  const rebuilt = shaderVec2(columnNode.x, columnNode.y);
  return index === 0 ? shaderMat2(rebuilt, c1) : shaderMat2(c0, rebuilt);
}

/**
 * `int(0)`, `uint(0)`, `1u`, `1` → column index.
 */
function parseShaderIndex(expression: string): number | null {
  const cleaned = expression
    .replace(/^(?:u?int)\s*\(/iu, '')
    .replace(/\)$/u, '')
    .replace(/u$/iu, '')
    .trim();
  const parsed = Number(cleaned);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Column index of a read like `M[0]` or `M[int(0)]`. The HLSL normalizer
 * rewrites `uint(0)` to `int(0)`, so every indexed read in a native body
 * arrives as an `int(...)` call around a literal; the write side already
 * accepts that shape through `parseShaderIndex`, and reads were dropping the
 * whole statement on it.
 */
function resolveShaderIndexExpression(
  index: MilkdropShaderExpressionNode | null | undefined,
): number | null {
  if (!index) {
    return null;
  }
  const literal =
    index.type === 'literal'
      ? index
      : index.type === 'call' &&
          (index.name === 'int' || index.name === 'uint') &&
          index.args.length === 1 &&
          index.args[0]?.type === 'literal'
        ? index.args[0]
        : null;
  if (!literal) {
    return null;
  }
  const value = Number(literal.value);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** mat2 * v and v * mat2 and mat2 * mat2 column-major products. */
function multiplyMat2(
  operator: '*' | '/' | '%',
  left: ShaderNodeValue,
  right: ShaderNodeValue,
): ShaderNodeValue {
  if (operator !== '*') {
    return left;
  }
  if (left.kind === 'mat2' && right.kind === 'mat2') {
    const a0 = shaderMat2Column(left, 0);
    const a1 = shaderMat2Column(left, 1);
    const b0 = shaderMat2Column(right, 0);
    const b1 = shaderMat2Column(right, 1);
    const matTimesVec = (
      m0: ShaderNodeValue,
      m1: ShaderNodeValue,
      v: ShaderNodeValue,
    ) =>
      shaderVec2(
        m0.node.x.mul(v.node.x).add(m1.node.x.mul(v.node.y)),
        m0.node.y.mul(v.node.x).add(m1.node.y.mul(v.node.y)),
      );
    return shaderMat2(matTimesVec(a0, a1, b0), matTimesVec(a0, a1, b1));
  }
  const mat = left.kind === 'mat2' ? left : right;
  const scalar = left.kind === 'mat2' ? right : left;
  const c0 = shaderMat2Column(mat, 0);
  const c1 = shaderMat2Column(mat, 1);
  const s = coerceShaderValue(scalar, 'scalar').node;
  return shaderMat2(
    shaderVec2(c0.node.x.mul(s), c0.node.y.mul(s)),
    shaderVec2(c1.node.x.mul(s), c1.node.y.mul(s)),
  );
}

function shaderValueFromNode(node: any, kind: ShaderNodeValue['kind']) {
  if (kind === 'scalar') {
    return shaderFloat(node);
  }
  if (kind === 'vec2') {
    return makeShaderValue('vec2', node);
  }
  if (kind === 'vec3') {
    return makeShaderValue('vec3', node);
  }
  return makeShaderValue('vec4', node);
}

function getDirectShaderSwizzleComponentNode(
  value: ShaderNodeValue,
  component: DirectShaderSwizzleComponent,
) {
  if (value.kind === 'scalar') {
    return value.node;
  }
  if (component === 'w') {
    return value.kind === 'vec4' ? value.node.w : value.node.z;
  }
  if (component === 'x') {
    return value.node.x;
  }
  if (component === 'y') {
    return value.node.y;
  }
  return value.node.z;
}

function resolveShaderSwizzle(
  kind: ShaderNodeValue['kind'],
  property: string,
): {
  kind: ShaderNodeValue['kind'];
  components: DirectShaderSwizzleComponent[];
} | null {
  if (kind === 'scalar') return null;
  if (kind === 'mat2') return null;
  if (kind !== 'vec4') {
    return resolveDirectShaderSwizzle(kind, property);
  }
  const normalized = property.toLowerCase();
  const componentMap: Record<string, DirectShaderSwizzleComponent> = {
    x: 'x',
    y: 'y',
    z: 'z',
    w: 'w',
    r: 'x',
    g: 'y',
    b: 'z',
    a: 'w',
  };
  if (
    normalized.length < 1 ||
    normalized.length > 4 ||
    [...normalized].some((entry) => !(entry in componentMap))
  ) {
    return null;
  }
  const components = [...normalized].map((entry) => componentMap[entry]);
  return {
    kind:
      components.length === 1
        ? 'scalar'
        : components.length === 2
          ? 'vec2'
          : components.length === 3
            ? 'vec3'
            : 'vec4',
    components,
  };
}

function buildDirectShaderSwizzleValue(
  value: ShaderNodeValue,
  property: string,
): ShaderNodeValue | null {
  if (value.kind === 'scalar') {
    return null;
  }
  const swizzle = resolveShaderSwizzle(value.kind, property);
  if (!swizzle) {
    return null;
  }
  const componentNodes = swizzle.components.map((component) =>
    getDirectShaderSwizzleComponentNode(value, component),
  );
  if (swizzle.kind === 'scalar') {
    return shaderFloat(componentNodes[0]);
  }
  if (swizzle.kind === 'vec2') {
    return shaderVec2(componentNodes[0], componentNodes[1]);
  }
  if (swizzle.kind === 'vec3') {
    return shaderVec3(componentNodes[0], componentNodes[1], componentNodes[2]);
  }
  return shaderVec4(
    componentNodes[0],
    componentNodes[1],
    componentNodes[2],
    componentNodes[3],
  );
}

export function resolveDirectShaderConstructorPattern(
  name: string,
  argKinds: Array<ShaderNodeValue['kind']>,
) {
  return resolveMilkdropShaderConstructorPattern(
    name,
    argKinds as MilkdropShaderValueKind[],
  );
}

function coerceShaderValue(
  value: ShaderNodeValue,
  target: ShaderNodeValue['kind'],
): ShaderNodeValue {
  if (value.kind === target) {
    return value;
  }
  if (target === 'mat2') {
    if (value.kind === 'vec4') {
      return makeShaderValue('mat2', value.node);
    }
    const v = coerceShaderValue(value, 'scalar').node;
    return shaderMat2(shaderVec2(v, float(0)), shaderVec2(float(0), v));
  }
  if (target === 'scalar') {
    return shaderFloat(value.node);
  }
  if (target === 'vec2') {
    if (value.kind === 'scalar') {
      return makeShaderValue('vec2', vec2(value.node, value.node));
    }
    return makeShaderValue('vec2', vec2(value.node.x, value.node.y));
  }
  if (target === 'vec3') {
    if (value.kind === 'scalar') {
      return makeShaderValue('vec3', vec3(value.node, value.node, value.node));
    }
    return makeShaderValue(
      'vec3',
      vec3(value.node.x, value.node.y, value.node.z ?? 0),
    );
  }
  if (value.kind === 'scalar') {
    return makeShaderValue(
      'vec4',
      vec4(value.node, value.node, value.node, value.node),
    );
  }
  if (value.kind === 'vec2') {
    return makeShaderValue('vec4', vec4(value.node.x, value.node.y, 0, 0));
  }
  if (value.kind === 'vec3') {
    return makeShaderValue(
      'vec4',
      vec4(value.node.x, value.node.y, value.node.z, 0),
    );
  }
  return value;
}

function getShaderResultKind(
  left: ShaderNodeValue,
  right: ShaderNodeValue,
): ShaderNodeValue['kind'] {
  if (left.kind === 'mat2' || right.kind === 'mat2') {
    return 'mat2';
  }
  if (left.kind === 'vec4' || right.kind === 'vec4') {
    return 'vec4';
  }
  if (left.kind === 'vec3' || right.kind === 'vec3') {
    return 'vec3';
  }
  if (left.kind === 'vec2' || right.kind === 'vec2') {
    return 'vec2';
  }
  return 'scalar';
}

function toShaderBool(value: ShaderNodeValue) {
  const scalarValue = coerceShaderValue(value, 'scalar');
  return step(0.0001, abs(scalarValue.node));
}

/**
 * Smallest divisor magnitude the executor will divide by, so `x / 0` produces
 * a large number rather than an infinity that poisons the frame.
 */
const DIVIDE_EPSILON = 0.000001;

/**
 * Division that neither flips the sign of its result nor manufactures one out
 * of a NaN.
 *
 * The guard this replaces was `left / max(abs(right), eps)`, which got both
 * wrong. Taking `abs` of the divisor made `x / -2.0` evaluate as `x / 2.0`, so
 * every quotient with a negative denominator came out mirrored — which is most
 * of the screen for the `x / y` in the inlined `atan2` that MilkDrop's shader
 * transpiler emits. And `max(NaN, eps)` returns `eps` under WGSL's select-based
 * max, so a NaN divisor became a divide by one millionth: `0.1 / sqrt(negative)`
 * turned into 1e5 and saturated the whole frame white instead of producing the
 * NaN that WebGL's raw GLSL produces and renders as black.
 *
 * Only a divisor whose magnitude is genuinely near zero is lifted, and it is
 * lifted to `±eps` keeping its sign. `abs(NaN) < eps` is false, so a NaN
 * divisor stays NaN and the NaN propagates, matching the other backend.
 */
function createSafeDivisorNode(right: any) {
  const magnitude = max(abs(right), DIVIDE_EPSILON);
  const signedFloor = select(right.lessThan(0), magnitude.mul(-1), magnitude);
  return select(abs(right).lessThan(DIVIDE_EPSILON), signedFloor, right);
}

function createDivideNode(left: any, right: any) {
  return left.div(createSafeDivisorNode(right));
}

function createModNode(left: any, right: any) {
  return left.sub(floor(createDivideNode(left, right)).mul(right));
}

function createComparisonNode(operator: string, left: any, right: any) {
  switch (operator) {
    case '<':
      return select(left.lessThan(right), float(1), float(0));
    case '<=':
      return select(left.lessThanEqual(right), float(1), float(0));
    case '>':
      return select(left.greaterThan(right), float(1), float(0));
    case '>=':
      return select(left.greaterThanEqual(right), float(1), float(0));
    case '==':
      return select(abs(left.sub(right)).lessThan(0.0001), float(1), float(0));
    case '!=':
      return select(abs(left.sub(right)).lessThan(0.0001), float(0), float(1));
    default:
      return float(0);
  }
}

function applyShaderBinaryNode(
  operator: ShaderBinaryOperator,
  left: ShaderNodeValue,
  right: ShaderNodeValue,
): ShaderNodeValue {
  if (operator === '&&' || operator === '||') {
    const leftBool = toShaderBool(left);
    const rightBool = toShaderBool(right);
    return shaderFloat(
      operator === '&&'
        ? leftBool.mul(rightBool)
        : min(float(1), leftBool.add(rightBool)),
    );
  }

  // mat2 arithmetic is column-major and never reduces to the generic
  // kind-coercion path (vec2 * mat2 yields vec2, mat2 * mat2 yields mat2).
  if (left.kind === 'mat2' || right.kind === 'mat2') {
    if (operator === '*' || operator === '/' || operator === '%') {
      if (
        (operator === '*' && left.kind === 'mat2' && right.kind === 'vec2') ||
        (operator === '*' && left.kind === 'vec2' && right.kind === 'mat2')
      ) {
        const mat = left.kind === 'mat2' ? left : right;
        const vec = left.kind === 'mat2' ? right : left;
        const c0 = shaderMat2Column(mat, 0);
        const c1 = shaderMat2Column(mat, 1);
        const v = coerceShaderValue(vec, 'vec2').node;
        return left.kind === 'mat2'
          ? shaderVec2(
              c0.node.x.mul(v.x).add(c1.node.x.mul(v.y)),
              c0.node.y.mul(v.x).add(c1.node.y.mul(v.y)),
            )
          : shaderVec2(
              v.x.mul(c0.node.x).add(v.y.mul(c0.node.y)),
              v.x.mul(c1.node.x).add(v.y.mul(c1.node.y)),
            );
      }
      return multiplyMat2(operator, left, right);
    }
    if (left.kind === 'mat2' && right.kind === 'mat2') {
      const l0 = shaderMat2Column(left, 0);
      const l1 = shaderMat2Column(left, 1);
      const r0 = shaderMat2Column(right, 0);
      const r1 = shaderMat2Column(right, 1);
      const combine = (a: ShaderNodeValue, b: ShaderNodeValue) =>
        operator === '+'
          ? shaderVec2(a.node.x.add(b.node.x), a.node.y.add(b.node.y))
          : shaderVec2(a.node.x.sub(b.node.x), a.node.y.sub(b.node.y));
      return shaderMat2(combine(l0, r0), combine(l1, r1));
    }
    return left;
  }

  const kind = getShaderResultKind(left, right);
  const lhs = coerceShaderValue(left, kind).node;
  const rhs = coerceShaderValue(right, kind).node;

  switch (operator) {
    case '+':
      return shaderValueFromNode(lhs.add(rhs), kind);
    case '-':
      return shaderValueFromNode(lhs.sub(rhs), kind);
    case '*':
      return shaderValueFromNode(lhs.mul(rhs), kind);
    case '/':
      return shaderValueFromNode(createDivideNode(lhs, rhs), kind);
    case '%':
      return shaderValueFromNode(createModNode(lhs, rhs), kind);
    case '^':
      return shaderValueFromNode(pow(lhs, rhs), kind);
    case '<':
    case '<=':
    case '>':
    case '>=':
    case '==':
    case '!=':
      return shaderFloat(createComparisonNode(operator, lhs, rhs));
    default:
      return left;
  }
}

function setShaderEnvValue(
  env: ShaderNodeEnv,
  key: string,
  value: ShaderNodeValue,
) {
  env.values.set(key.toLowerCase(), value);
}

/**
 * A name that, when a directly executed body reads it without ever having
 * assigned it, is a MilkDrop per-frame register the VM owns (`tele`,
 * `hordist`, `vshift`, …) rather than anything this executor could resolve
 * on its own. Sampler identifiers are the one other thing that reaches the
 * scalar env unresolved — `tex2d(currentTex, uv)` compiles its arguments
 * before the sampler name is looked up in the binding table — so those are
 * excluded by shape.
 */
function isPerFrameVariableCandidate(name: string): boolean {
  return (
    /^[a-z][a-z0-9_]*$/u.test(name) &&
    !name.endsWith('tex') &&
    !name.startsWith('sampler_')
  );
}

function getShaderEnvValue(
  env: ShaderNodeEnv,
  key: string,
  options: { bindPerFrameVariable?: boolean } = {},
): ShaderNodeValue | null {
  const normalized = key.toLowerCase();
  const existing = env.values.get(normalized);
  if (existing) {
    return existing;
  }

  const uniformMap: Record<string, () => ShaderNodeValue> = {
    time: () => shaderFloat(env.uniforms.signalTime),
    aspect: () =>
      shaderVec4(
        env.uniforms.aspect.x,
        env.uniforms.aspect.y,
        env.uniforms.aspect.z,
        env.uniforms.aspect.w,
      ),
    bass: () => shaderFloat(env.uniforms.signalBass),
    bass_att: () => shaderFloat(env.uniforms.signalBassAtt),
    bassatt: () => shaderFloat(env.uniforms.signalBassAtt),
    mid: () => shaderFloat(env.uniforms.signalMid),
    mids: () => shaderFloat(env.uniforms.signalMid),
    mid_att: () => shaderFloat(env.uniforms.signalMidAtt),
    mids_att: () => shaderFloat(env.uniforms.signalMidAtt),
    midatt: () => shaderFloat(env.uniforms.signalMidAtt),
    midsatt: () => shaderFloat(env.uniforms.signalMidAtt),
    treb: () => shaderFloat(env.uniforms.signalTreb),
    treb_att: () => shaderFloat(env.uniforms.signalTrebAtt),
    trebatt: () => shaderFloat(env.uniforms.signalTrebAtt),
    treble: () => shaderFloat(env.uniforms.signalTreb),
    treble_att: () => shaderFloat(env.uniforms.signalTrebAtt),
    trebleatt: () => shaderFloat(env.uniforms.signalTrebAtt),
    percussive: () => shaderFloat(env.uniforms.signalPercussive),
    harmonic: () => shaderFloat(env.uniforms.signalHarmonic),
    percussive_low: () => shaderFloat(env.uniforms.signalPercussiveLow),
    percussivelow: () => shaderFloat(env.uniforms.signalPercussiveLow),
    percussive_mid: () => shaderFloat(env.uniforms.signalPercussiveMid),
    percussivemid: () => shaderFloat(env.uniforms.signalPercussiveMid),
    percussive_high: () => shaderFloat(env.uniforms.signalPercussiveHigh),
    percussivehigh: () => shaderFloat(env.uniforms.signalPercussiveHigh),
    percussive_ratio: () => shaderFloat(env.uniforms.signalPercussiveRatio),
    percussiveratio: () => shaderFloat(env.uniforms.signalPercussiveRatio),
    beat: () => shaderFloat(env.uniforms.signalBeat),
    beat_pulse: () => shaderFloat(env.uniforms.signalBeatPulse),
    progress: () => shaderFloat(env.uniforms.signalFrame),
    frame: () => shaderFloat(env.uniforms.signalFrame),
    fps: () => shaderFloat(env.uniforms.signalFps),
    vol: () => shaderFloat(env.uniforms.signalEnergy),
    rms: () => shaderFloat(env.uniforms.signalEnergy),
    music: () => shaderFloat(env.uniforms.signalEnergy),
    weighted_energy: () => shaderFloat(env.uniforms.signalEnergy),
    pi: () => shaderFloat(Math.PI),
    e: () => shaderFloat(Math.E),
    warp: () => shaderFloat(env.uniforms.warpScale),
    warp_scale: () => shaderFloat(env.uniforms.warpScale),
    dx: () => shaderFloat(env.uniforms.offsetX),
    offset_x: () => shaderFloat(env.uniforms.offsetX),
    translate_x: () => shaderFloat(env.uniforms.offsetX),
    dy: () => shaderFloat(env.uniforms.offsetY),
    offset_y: () => shaderFloat(env.uniforms.offsetY),
    translate_y: () => shaderFloat(env.uniforms.offsetY),
    rot: () => shaderFloat(env.uniforms.rotation),
    rotation: () => shaderFloat(env.uniforms.rotation),
    zoom: () => shaderFloat(env.uniforms.zoomMul),
    scale: () => shaderFloat(env.uniforms.zoomMul),
    saturation: () => shaderFloat(env.uniforms.saturation),
    sat: () => shaderFloat(env.uniforms.saturation),
    contrast: () => shaderFloat(env.uniforms.contrast),
    r: () => shaderFloat(env.uniforms.colorScale.x),
    red: () => shaderFloat(env.uniforms.colorScale.x),
    g: () => shaderFloat(env.uniforms.colorScale.y),
    green: () => shaderFloat(env.uniforms.colorScale.y),
    b: () => shaderFloat(env.uniforms.colorScale.z),
    blue: () => shaderFloat(env.uniforms.colorScale.z),
    hue: () => shaderFloat(env.uniforms.hueShift),
    hue_shift: () => shaderFloat(env.uniforms.hueShift),
    mix: () => shaderFloat(env.uniforms.mixAlpha),
    feedback: () => shaderFloat(env.uniforms.mixAlpha),
    feedback_alpha: () => shaderFloat(env.uniforms.mixAlpha),
    brighten: () => shaderFloat(env.uniforms.brightenBoost),
    invert: () => shaderFloat(env.uniforms.invertBoost),
    solarize: () => shaderFloat(env.uniforms.solarizeBoost),
    tint: () =>
      makeShaderValue(
        'vec3',
        vec3(env.uniforms.tint.x, env.uniforms.tint.y, env.uniforms.tint.z),
      ),
    colorscale: () =>
      makeShaderValue(
        'vec3',
        vec3(
          env.uniforms.colorScale.x,
          env.uniforms.colorScale.y,
          env.uniforms.colorScale.z,
        ),
      ),
    tint_r: () => shaderFloat(env.uniforms.tint.x),
    tint_g: () => shaderFloat(env.uniforms.tint.y),
    tint_b: () => shaderFloat(env.uniforms.tint.z),
    texsize: () =>
      shaderVec4(
        env.uniforms.texsize.x,
        env.uniforms.texsize.y,
        env.uniforms.texsize.z,
        env.uniforms.texsize.w,
      ),
    texsize_noise_lq: () =>
      shaderVec4(
        env.uniforms.texsizeNoiseLq.x,
        env.uniforms.texsizeNoiseLq.y,
        env.uniforms.texsizeNoiseLq.z,
        env.uniforms.texsizeNoiseLq.w,
      ),
    texsize_noise_hq: () =>
      shaderVec4(
        env.uniforms.texsizeNoiseHq.x,
        env.uniforms.texsizeNoiseHq.y,
        env.uniforms.texsizeNoiseHq.z,
        env.uniforms.texsizeNoiseHq.w,
      ),
    texsize_noisevol_hq: () =>
      shaderVec4(
        env.uniforms.texsizeNoisevolHq.x,
        env.uniforms.texsizeNoisevolHq.y,
        env.uniforms.texsizeNoisevolHq.z,
        env.uniforms.texsizeNoisevolHq.w,
      ),
    texelsize: () =>
      shaderVec2(env.uniforms.texelSize.x, env.uniforms.texelSize.y),
    scale1: () => shaderFloat(env.uniforms.scale1),
    bias1: () => shaderFloat(env.uniforms.bias1),
    scale2: () => shaderFloat(env.uniforms.scale2),
    bias2: () => shaderFloat(env.uniforms.bias2),
    scale3: () => shaderFloat(env.uniforms.scale3),
    bias3: () => shaderFloat(env.uniforms.bias3),
    rand_preset: () =>
      shaderVec4(
        env.uniforms.rand_preset.x,
        env.uniforms.rand_preset.y,
        env.uniforms.rand_preset.z,
        env.uniforms.rand_preset.w,
      ),
    // Butterchurn-compiled bodies address q registers through the packed
    // _qa.._qh vec4 uniforms (#define q1 _qa.x …). The uniform banks are
    // already packed four-per-vec4, so each maps straight to one uniform node.
    _qa: () => makeShaderValue('vec4', env.uniforms.perPixelQ[0]),
    _qb: () => makeShaderValue('vec4', env.uniforms.perPixelQ[1]),
    _qc: () => makeShaderValue('vec4', env.uniforms.perPixelQ[2]),
    _qd: () => makeShaderValue('vec4', env.uniforms.perPixelQ[3]),
    _qe: () => makeShaderValue('vec4', env.uniforms.perPixelQ[4]),
    _qf: () => makeShaderValue('vec4', env.uniforms.perPixelQ[5]),
    _qg: () => makeShaderValue('vec4', env.uniforms.perPixelQ[6]),
    _qh: () => makeShaderValue('vec4', env.uniforms.perPixelQ[7]),
    // Butterchurn shader bodies reference the time-driven roam oscillators as
    // vec4 macros; the WebGL templates define them as #defines. Provide the
    // same expressions here so statements multiplying by roam_sin/roam_cos
    // don't silently drop.
    // The compiler rewrites MilkDrop signal names (time, bass, frame, …) to
    // their signal* uniforms; the map must accept those rewritten forms.
    signaltime: () => shaderFloat(env.uniforms.signalTime),
    signalframe: () => shaderFloat(env.uniforms.signalFrame),
    signalfps: () => shaderFloat(env.uniforms.signalFps),
    signalbass: () => shaderFloat(env.uniforms.signalBass),
    signalbassatt: () => shaderFloat(env.uniforms.signalBassAtt),
    signalmid: () => shaderFloat(env.uniforms.signalMid),
    signalmidatt: () => shaderFloat(env.uniforms.signalMidAtt),
    signaltreb: () => shaderFloat(env.uniforms.signalTreb),
    signaltrebatt: () => shaderFloat(env.uniforms.signalTrebAtt),
    signalenergy: () => shaderFloat(env.uniforms.signalEnergy),
    signalbeat: () => shaderFloat(env.uniforms.signalBeat),
    signalbeatpulse: () => shaderFloat(env.uniforms.signalBeatPulse),
    signalpercussive: () => shaderFloat(env.uniforms.signalPercussive),
    signalharmonic: () => shaderFloat(env.uniforms.signalHarmonic),
    signalpercussivelow: () => shaderFloat(env.uniforms.signalPercussiveLow),
    signalpercussivemid: () => shaderFloat(env.uniforms.signalPercussiveMid),
    signalpercussivehigh: () => shaderFloat(env.uniforms.signalPercussiveHigh),
    signalpercussiveratio: () =>
      shaderFloat(env.uniforms.signalPercussiveRatio),
    roam_cos: () =>
      shaderVec4(
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(0.3)))),
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(1.3)))),
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(5.0)))),
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(20.0)))),
      ),
    roam_sin: () =>
      shaderVec4(
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(0.3)))),
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(1.3)))),
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(5.0)))),
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(20.0)))),
      ),
    slow_roam_cos: () =>
      shaderVec4(
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(0.005)))),
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(0.008)))),
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(0.013)))),
        float(0.5).add(float(0.5).mul(cos(env.uniforms.signalTime.mul(0.022)))),
      ),
    slow_roam_sin: () =>
      shaderVec4(
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(0.005)))),
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(0.008)))),
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(0.013)))),
        float(0.5).add(float(0.5).mul(sin(env.uniforms.signalTime.mul(0.022)))),
      ),
  };

  const registerMatch = /^(q|t)([1-9]|[12]\d|3[0-2])$/u.exec(normalized);
  const registerUniforms =
    registerMatch?.[1] === 'q'
      ? env.uniforms.perPixelQ
      : registerMatch?.[1] === 't'
        ? env.uniforms.perPixelT
        : null;
  const registerIndex = Number(registerMatch?.[2] ?? 0) - 1;
  // Registers live four-per-vec4 in the packed banks; a scalar read is a
  // component swizzle of the owning vector.
  const registerVector =
    registerUniforms && registerIndex >= 0
      ? registerUniforms[Math.floor(registerIndex / 4)]
      : null;
  const registerComponent = (['x', 'y', 'z', 'w'] as const)[registerIndex % 4];
  let resolved = registerVector
    ? shaderFloat(registerVector[registerComponent])
    : (uniformMap[normalized]?.() ?? null);
  // A read of a name nothing above supplies is a per-frame register the VM
  // computes (martin-adrift-on-a-dead-planet reads `tele` and `hordist` in
  // its warp body). WebGL declares these as `uniform float` and drives them
  // from the frame state; do the same here with one uniform node per name.
  // Only reads bind — assignShaderTarget passes bindPerFrameVariable: false,
  // so a body's own scratch locals never turn into uniforms, matching the
  // WebGL classifier's "first occurrence is an assignment ⇒ scratch" rule.
  const perFrameVariables = env.uniforms.perFrameVariables as
    | Map<string, ReturnType<typeof uniform>>
    | undefined;
  if (
    !resolved &&
    options.bindPerFrameVariable !== false &&
    perFrameVariables instanceof Map &&
    isPerFrameVariableCandidate(normalized)
  ) {
    let node = perFrameVariables.get(normalized);
    if (!node) {
      node = uniform(0);
      perFrameVariables.set(normalized, node);
    }
    resolved = shaderFloat(node);
  }
  if (resolved) {
    env.values.set(normalized, resolved);
  } else {
    env.unresolvedNames?.add(normalized);
  }
  return resolved;
}

export function compileShaderExpressionNode(
  node: MilkdropShaderExpressionNode | MilkdropExpressionNode,
  env: ShaderNodeEnv,
): ShaderNodeValue | null {
  switch (node.type) {
    case 'literal':
      return shaderFloat(node.value);
    case 'identifier':
      return getShaderEnvValue(env, node.name);
    case 'unary': {
      const operand = compileShaderExpressionNode(node.operand, env);
      if (!operand) {
        return null;
      }
      if (node.operator === '+') {
        return operand;
      }
      if (node.operator === '-') {
        return shaderValueFromNode(
          coerceShaderValue(operand, operand.kind).node.mul(-1),
          operand.kind,
        );
      }
      return shaderFloat(float(1).sub(toShaderBool(operand)));
    }
    case 'binary': {
      if (node.operator === '=') {
        return null;
      }
      const left = compileShaderExpressionNode(node.left, env);
      const right = compileShaderExpressionNode(node.right, env);
      if (!left || !right) {
        return null;
      }
      return applyShaderBinaryNode(node.operator, left, right);
    }
    case 'member': {
      const object = compileShaderExpressionNode(node.object, env);
      if (!object) {
        return null;
      }
      return buildDirectShaderSwizzleValue(object, node.property);
    }
    case 'index': {
      const object = compileShaderExpressionNode(node.object, env);
      if (object?.kind !== 'mat2') {
        return null;
      }
      const index = resolveShaderIndexExpression(node.index);
      if (index === null || index > 1) {
        return null;
      }
      return shaderMat2Column(object, index);
    }
    case 'call': {
      const name = node.name.toLowerCase();
      const samplerCall =
        name === 'tex2d' ||
        name === 'tex3d' ||
        name === 'texture' ||
        name === 'texture2d' ||
        name === 'texture3d' ||
        name === 'samplenoisevolume' ||
        name === 'tex2dlod' ||
        name === 'tex2dbias' ||
        name === 'tex2dgrad';
      const args = node.args
        .map((arg) => compileShaderExpressionNode(arg, env))
        .filter((value): value is ShaderNodeValue => value !== null);
      // Sampler calls carry a sampler identifier (sampler_main, blur1Tex, …)
      // that resolves through the binding table, not the scalar env, so it is
      // allowed to stay uncompiled. Every other call needs all args.
      if (
        args.length !== node.args.length &&
        !(samplerCall && args.length >= node.args.length - 1)
      ) {
        return null;
      }
      const constructorPattern = resolveDirectShaderConstructorPattern(
        name,
        args.map((entry) => entry.kind),
      );
      if (constructorPattern === 'vec2-pair') {
        return shaderVec2(
          coerceShaderValue(args[0], 'scalar').node,
          coerceShaderValue(args[1], 'scalar').node,
        );
      }
      if (constructorPattern === 'vec2-splat') {
        const scalar = coerceShaderValue(args[0], 'scalar').node;
        return shaderVec2(scalar, scalar);
      }
      if (constructorPattern === 'vec2-copy') {
        return args[0];
      }
      if (constructorPattern === 'vec3-triple') {
        return shaderVec3(
          coerceShaderValue(args[0], 'scalar').node,
          coerceShaderValue(args[1], 'scalar').node,
          coerceShaderValue(args[2], 'scalar').node,
        );
      }
      if (constructorPattern === 'vec3-vec2-scalar') {
        return shaderVec3(
          args[0].node.x,
          args[0].node.y,
          coerceShaderValue(args[1], 'scalar').node,
        );
      }
      if (constructorPattern === 'vec3-scalar-vec2') {
        return shaderVec3(
          coerceShaderValue(args[0], 'scalar').node,
          args[1].node.x,
          args[1].node.y,
        );
      }
      if (constructorPattern === 'vec3-splat') {
        const scalar = coerceShaderValue(args[0], 'scalar').node;
        return shaderVec3(scalar, scalar, scalar);
      }
      if (constructorPattern === 'vec3-copy') {
        return args[0];
      }
      if (constructorPattern === 'vec4-quad') {
        return shaderVec4(
          coerceShaderValue(args[0], 'scalar').node,
          coerceShaderValue(args[1], 'scalar').node,
          coerceShaderValue(args[2], 'scalar').node,
          coerceShaderValue(args[3], 'scalar').node,
        );
      }
      if (constructorPattern === 'vec4-vec3-scalar') {
        return shaderVec4(
          args[0].node.x,
          args[0].node.y,
          args[0].node.z,
          coerceShaderValue(args[1], 'scalar').node,
        );
      }
      if (constructorPattern === 'vec4-scalar-vec3') {
        return shaderVec4(
          coerceShaderValue(args[0], 'scalar').node,
          args[1].node.x,
          args[1].node.y,
          args[1].node.z,
        );
      }
      if (constructorPattern === 'vec4-vec2-vec2') {
        return shaderVec4(
          args[0].node.x,
          args[0].node.y,
          args[1].node.x,
          args[1].node.y,
        );
      }
      if (constructorPattern === 'vec4-splat') {
        const scalar = coerceShaderValue(args[0], 'scalar').node;
        return shaderVec4(scalar, scalar, scalar, scalar);
      }
      if (constructorPattern === 'vec4-copy') {
        return args[0];
      }
      if (constructorPattern === 'mat2-quad') {
        // GLSL column-major: mat2(a, b, c, d) → col0=(a, b), col1=(c, d).
        const s0 = coerceShaderValue(args[0], 'scalar').node;
        const s1 = coerceShaderValue(args[1], 'scalar').node;
        const s2 = coerceShaderValue(args[2], 'scalar').node;
        const s3 = coerceShaderValue(args[3], 'scalar').node;
        return shaderMat2(shaderVec2(s0, s1), shaderVec2(s2, s3));
      }
      if (constructorPattern === 'mat2-pair') {
        return shaderMat2(
          coerceShaderValue(args[0], 'vec2'),
          coerceShaderValue(args[1], 'vec2'),
        );
      }
      // MilkDrop 2 preamble helpers — see the matching GLSL emitter case in
      // compiler/shader-analysis-glsl.ts. Bodies call these without defining
      // them, so both backends have to supply them or the preset renders
      // black.
      if ((name === 'getpixel' || name === 'getblur0') && args.length >= 1) {
        const sampleUv = coerceShaderValue(args[0], 'vec2').node;
        const mainSample = env.sampleMainNode
          ? env.sampleMainNode(sampleUv)
          : env.uniforms.currentTex.sample(
              env.sampleUvNode(sampleUv, env.uniforms.textureWrap),
            ).rgb;
        return makeShaderValue('vec3', mainSample);
      }
      const blurHelperMatch = /^getblur([123])$/.exec(name);
      if (blurHelperMatch && args.length >= 1) {
        const level = blurHelperMatch[1] as '1' | '2' | '3';
        const sampleUv = coerceShaderValue(args[0], 'vec2').node;
        const blurTexture = env.uniforms[`blur${level}Tex`];
        return makeShaderValue(
          'vec3',
          blurTexture
            .sample(env.sampleUvNode(sampleUv, env.uniforms.textureWrap))
            .rgb.mul(env.uniforms[`scale${level}`])
            .add(env.uniforms[`bias${level}`]),
        );
      }
      if (
        (name === 'tex2d' ||
          name === 'tex3d' ||
          name === 'texture' ||
          name === 'texture2d' ||
          name === 'texture3d') &&
        node.args.length >= 2
      ) {
        const samplerArg = node.args[0];
        const rawSourceName =
          samplerArg?.type === 'identifier'
            ? samplerArg.name.toLowerCase()
            : 'sampler_main';
        const sourceName =
          TEXTURE_IDENTIFIER_TO_SAMPLER[rawSourceName] ?? rawSourceName;
        const coordinate = args[0];
        if (!coordinate) {
          return null;
        }
        const explicitVolumeSample = name === 'tex3d' || name === 'texture3d';
        const inferredVolumeSample =
          name === 'texture' && coordinate.kind === 'vec3';
        const sampleDimension =
          explicitVolumeSample || inferredVolumeSample ? '3d' : '2d';
        const resolvedBinding = resolveDirectShaderSamplerBinding(
          sourceName,
          sampleDimension,
        );
        if (!resolvedBinding) {
          return null;
        }
        const sampleUv =
          coordinate.kind === 'vec3'
            ? vec2(coordinate.node.x, coordinate.node.y)
            : coerceShaderValue(coordinate, 'vec2').node;
        const sampleZ =
          coordinate.kind === 'vec3' ? coordinate.node.z : float(0);
        if (resolvedBinding.canonicalSource === 'main') {
          if (env.sampleMainNode) {
            return makeShaderValue('vec3', env.sampleMainNode(sampleUv));
          }
          return makeShaderValue(
            'vec3',
            env.uniforms.currentTex.sample(
              env.sampleUvNode(sampleUv, env.uniforms.textureWrap),
            ).rgb,
          );
        }
        if (
          resolvedBinding.canonicalSource === 'pw_main' ||
          resolvedBinding.canonicalSource === 'pc_main'
        ) {
          return makeShaderValue(
            'vec3',
            env.uniforms.previousTex.sample(
              env.sampleUvNode(sampleUv, env.uniforms.textureWrap),
            ).rgb,
          );
        }
        if (resolvedBinding.canonicalSource === 'fc_main') {
          return makeShaderValue(
            'vec3',
            env.uniforms.warpTex.sample(
              env.sampleUvNode(sampleUv, env.uniforms.textureWrap),
            ).rgb,
          );
        }
        return makeShaderValue(
          'vec3',
          env.sampleAuxTextureNode.sampleStatic(
            resolvedBinding.canonicalSource,
            sampleDimension,
            sampleUv,
            sampleZ,
          ).rgb,
        );
      }
      if (name === 'samplenoisevolume' && args.length >= 1) {
        // Native bodies rewrite texture(sampler_noisevol*, vec3) to the
        // sampleNoiseVolume helper; mirror the GLSL atlas-slice emulation by
        // routing through the simplex volume slot.
        const coordinate = args[0];
        const sampleUv =
          coordinate.kind === 'vec3'
            ? vec2(coordinate.node.x, coordinate.node.y)
            : coerceShaderValue(coordinate, 'vec2').node;
        const sampleZ =
          coordinate.kind === 'vec3' ? coordinate.node.z : float(0);
        return makeShaderValue(
          'vec3',
          env.sampleAuxTextureNode.sampleStatic(
            'simplex',
            '3d',
            sampleUv,
            sampleZ,
          ).rgb,
        );
      }
      if (
        (name === 'tex2dlod' || name === 'tex2dbias' || name === 'tex2dgrad') &&
        node.args.length >= 2 &&
        args.length >= 1
      ) {
        const samplerArg = node.args[0];
        const rawSourceName =
          samplerArg?.type === 'identifier'
            ? samplerArg.name.toLowerCase()
            : 'sampler_main';
        const sourceName =
          TEXTURE_IDENTIFIER_TO_SAMPLER[rawSourceName] ?? rawSourceName;
        const resolvedBinding = resolveDirectShaderSamplerBinding(
          sourceName,
          '2d',
        );
        if (!resolvedBinding) {
          return null;
        }
        const textureNode = resolveDirectShaderTextureNode(
          env,
          resolvedBinding.canonicalSource,
        );
        if (!textureNode) {
          return null;
        }
        const coordinate = args[0];
        const coordUv =
          coordinate.kind === 'vec4'
            ? vec2(coordinate.node.x, coordinate.node.y)
            : coerceShaderValue(coordinate, 'vec2').node;
        // These variants sample through `.grad()`/`.level()`/`.bias()`, so
        // they cannot go through sampleFeedbackTarget and have to pick the
        // right coordinate space themselves: render-target space for the
        // feedback textures, plain screen space for uploaded ones.
        const sampleUv = RENDER_TARGET_SHADER_SOURCES.has(
          resolvedBinding.canonicalSource,
        )
          ? env.sampleUvNode(coordUv, env.uniforms.textureWrap)
          : screenSampleUvNode(coordUv, env.uniforms.textureWrap);
        if (name === 'tex2dgrad') {
          const dx =
            args.length >= 2
              ? coerceShaderValue(args[1], 'vec2').node
              : dFdx(coordUv);
          const dy =
            args.length >= 3
              ? coerceShaderValue(args[2], 'vec2').node
              : dFdy(coordUv);
          return makeShaderValue(
            'vec3',
            textureNode.grad(dx, dy).sample(sampleUv).rgb,
          );
        }
        const level =
          coordinate.kind === 'vec4' ? coordinate.node.w : (args[1]?.node ?? 0);
        if (name === 'tex2dlod') {
          return makeShaderValue(
            'vec3',
            textureNode.level(level).sample(sampleUv).rgb,
          );
        }
        return makeShaderValue(
          'vec3',
          textureNode.bias(level).sample(sampleUv).rgb,
        );
      }
      if ((name === 'mix' || name === 'lerp') && args.length >= 3) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        const left = coerceShaderValue(args[0], resultKind).node;
        const right = coerceShaderValue(args[1], resultKind).node;
        const amount = coerceShaderValue(args[2], 'scalar').node;
        return shaderValueFromNode(mix(left, right, amount), resultKind);
      }
      if (name === 'if' && args.length >= 3) {
        const condition = toShaderBool(args[0]);
        const resultKind = getShaderResultKind(args[1], args[2]);
        const whenTrue = coerceShaderValue(args[1], resultKind).node;
        const whenFalse = coerceShaderValue(args[2], resultKind).node;
        return shaderValueFromNode(
          mix(whenFalse, whenTrue, condition),
          resultKind,
        );
      }
      if (name === 'step' && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        const edge = coerceShaderValue(args[0], resultKind).node;
        const value = coerceShaderValue(args[1], resultKind).node;
        return shaderValueFromNode(step(edge, value), resultKind);
      }
      if (name === 'smoothstep' && args.length >= 3) {
        const resultKind = getShaderResultKind(args[0], args[2]);
        return shaderValueFromNode(
          smoothstep(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
            coerceShaderValue(args[2], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'sigmoid' && args.length >= 1) {
        const resultKind = args[0]?.kind ?? 'scalar';
        const value = coerceShaderValue(args[0], resultKind).node;
        const slope = coerceShaderValue(
          args[1] ?? shaderFloat(1),
          resultKind,
        ).node;
        return shaderValueFromNode(
          float(1).div(
            float(1).add(pow(float(Math.E), value.mul(slope).mul(-1))),
          ),
          resultKind,
        );
      }
      if ((name === 'mod' || name === 'fmod') && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          createModNode(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'abs' && args.length >= 1) {
        return shaderValueFromNode(abs(args[0].node), args[0].kind);
      }
      if (name === 'pow' && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          pow(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'sqrt' && args.length >= 1) {
        return shaderValueFromNode(pow(args[0].node, 0.5), args[0].kind);
      }
      if (name === 'sin' && args.length >= 1) {
        return shaderValueFromNode(sin(args[0].node), args[0].kind);
      }
      if (name === 'cos' && args.length >= 1) {
        return shaderValueFromNode(cos(args[0].node), args[0].kind);
      }
      if (name === 'fract' && args.length >= 1) {
        return shaderValueFromNode(fract(args[0].node), args[0].kind);
      }
      if (name === 'floor' && args.length >= 1) {
        return shaderValueFromNode(floor(args[0].node), args[0].kind);
      }
      if (name === 'min' && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          min(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'max' && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          max(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'clamp' && args.length >= 3) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          clamp(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
            coerceShaderValue(args[2], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'length' && args.length >= 1) {
        return shaderFloat(length(args[0].node));
      }
      if (name === 'dot' && args.length >= 2) {
        return shaderFloat(dot(args[0].node, args[1].node));
      }
      if (name === 'above' && args.length >= 2) {
        return shaderFloat(
          createComparisonNode('>', args[0].node, args[1].node),
        );
      }
      if (name === 'below' && args.length >= 2) {
        return shaderFloat(
          createComparisonNode('<', args[0].node, args[1].node),
        );
      }
      if (
        (name === 'greaterthanequal' ||
          name === 'greaterthan' ||
          name === 'lessthanequal' ||
          name === 'lessthan') &&
        args.length >= 2
      ) {
        // Component-wise vector comparisons (GLSL bvec result re-cast to a
        // numeric vec via the enclosing vecN(...) constructor).
        const kind = getShaderResultKind(args[0], args[1]);
        const lhs = coerceShaderValue(args[0], kind).node;
        const rhs = coerceShaderValue(args[1], kind).node;
        const compare = (a: any, b: any) => {
          const ge = step(b, a);
          const le = step(a, b);
          if (name === 'greaterthanequal') return ge;
          if (name === 'lessthanequal') return le;
          const equal = ge.mul(le);
          return name === 'greaterthan'
            ? ge.mul(float(1).sub(equal))
            : le.mul(float(1).sub(equal));
        };
        if (kind === 'scalar') {
          return shaderFloat(
            createComparisonNode(
              name === 'greaterthanequal'
                ? '>='
                : name === 'greaterthan'
                  ? '>'
                  : name === 'lessthanequal'
                    ? '<='
                    : '<',
              lhs,
              rhs,
            ),
          );
        }
        if (kind === 'vec2') {
          return shaderVec2(compare(lhs.x, rhs.x), compare(lhs.y, rhs.y));
        }
        if (kind === 'vec3') {
          return shaderVec3(
            compare(lhs.x, rhs.x),
            compare(lhs.y, rhs.y),
            compare(lhs.z, rhs.z),
          );
        }
        return shaderVec4(
          compare(lhs.x, rhs.x),
          compare(lhs.y, rhs.y),
          compare(lhs.z, rhs.z),
          compare(lhs.w, rhs.w),
        );
      }
      if (name === 'saturate' && args.length >= 1) {
        return shaderValueFromNode(clamp(args[0].node, 0, 1), args[0].kind);
      }
      if (name === 'tan' && args.length >= 1) {
        return shaderValueFromNode(tan(args[0].node), args[0].kind);
      }
      if (name === 'asin' && args.length >= 1) {
        return shaderValueFromNode(asin(args[0].node), args[0].kind);
      }
      if (name === 'acos' && args.length >= 1) {
        return shaderValueFromNode(acos(args[0].node), args[0].kind);
      }
      if (name === 'atan' && args.length >= 1) {
        return shaderValueFromNode(
          args.length >= 2
            ? atan(args[0].node, args[1].node)
            : atan(args[0].node),
          args[0].kind,
        );
      }
      if (name === 'atan2' && args.length >= 2) {
        return shaderValueFromNode(
          atan(args[0].node, args[1].node),
          args[0].kind,
        );
      }
      if (name === 'ceil' && args.length >= 1) {
        return shaderValueFromNode(ceil(args[0].node), args[0].kind);
      }
      if (name === 'sign' && args.length >= 1) {
        return shaderValueFromNode(sign(args[0].node), args[0].kind);
      }
      if (name === 'exp' && args.length >= 1) {
        return shaderValueFromNode(exp(args[0].node), args[0].kind);
      }
      if (name === 'exp2' && args.length >= 1) {
        return shaderValueFromNode(exp2(args[0].node), args[0].kind);
      }
      if (name === 'log' && args.length >= 1) {
        return shaderValueFromNode(
          log(max(args[0].node, float(0.000001))),
          args[0].kind,
        );
      }
      if (name === 'log2' && args.length >= 1) {
        return shaderValueFromNode(
          log2(max(args[0].node, float(0.000001))),
          args[0].kind,
        );
      }
      if (name === 'log10' && args.length >= 1) {
        return shaderValueFromNode(
          log(max(args[0].node, float(0.000001))).mul(float(Math.LOG10E)),
          args[0].kind,
        );
      }
      if (name === 'rsqrt' && args.length >= 1) {
        return shaderValueFromNode(
          inversesqrt(max(args[0].node, float(0.000001))),
          args[0].kind,
        );
      }
      if (name === 'inversesqrt' && args.length >= 1) {
        return shaderValueFromNode(
          inversesqrt(max(args[0].node, float(0.000001))),
          args[0].kind,
        );
      }
      if (name === 'trunc' && args.length >= 1) {
        return shaderValueFromNode(trunc(args[0].node), args[0].kind);
      }
      if (name === 'round' && args.length >= 1) {
        return shaderValueFromNode(round(args[0].node), args[0].kind);
      }
      if (name === 'frac' && args.length >= 1) {
        return shaderValueFromNode(fract(args[0].node), args[0].kind);
      }
      if (name === 'fwidth' && args.length >= 1) {
        return shaderValueFromNode(fwidth(args[0].node), args[0].kind);
      }
      if (name === 'ddx' && args.length >= 1) {
        return shaderValueFromNode(dFdx(args[0].node), args[0].kind);
      }
      if (name === 'ddy' && args.length >= 1) {
        return shaderValueFromNode(dFdy(args[0].node), args[0].kind);
      }
      if (name === 'dfdx' && args.length >= 1) {
        return shaderValueFromNode(dFdx(args[0].node), args[0].kind);
      }
      if (name === 'dfdy' && args.length >= 1) {
        return shaderValueFromNode(dFdy(args[0].node), args[0].kind);
      }
      if (name === 'cross' && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          cross(
            coerceShaderValue(args[0], 'vec3').node,
            coerceShaderValue(args[1], 'vec3').node,
          ),
          resultKind,
        );
      }
      if (name === 'normalize' && args.length >= 1) {
        return shaderValueFromNode(normalize(args[0].node), args[0].kind);
      }
      if (name === 'reflect' && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          reflect(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'refract' && args.length >= 3) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          refract(
            coerceShaderValue(args[0], resultKind).node,
            coerceShaderValue(args[1], resultKind).node,
            coerceShaderValue(args[2], 'scalar').node,
          ),
          resultKind,
        );
      }
      if (name === 'mul' && args.length >= 2) {
        const resultKind = getShaderResultKind(args[0], args[1]);
        return shaderValueFromNode(
          coerceShaderValue(args[0], resultKind).node.mul(
            coerceShaderValue(args[1], resultKind).node,
          ),
          resultKind,
        );
      }
      if (name === 'transpose' && args.length >= 1) {
        return shaderValueFromNode(transpose(args[0].node), args[0].kind);
      }
      if (name === 'float' && args.length >= 1) {
        return shaderValueFromNode(float(args[0].node), args[0].kind);
      }
      if (name === 'half' && args.length >= 1) {
        return shaderValueFromNode(float(args[0].node), args[0].kind);
      }
      if (name === 'int' && args.length >= 1) {
        return shaderValueFromNode(int(args[0].node), args[0].kind);
      }
      if (name === 'bool' && args.length >= 1) {
        return shaderValueFromNode(bool(args[0].node), args[0].kind);
      }
      return null;
    }
  }
}

function assignShaderTarget(
  env: ShaderNodeEnv,
  statement: MilkdropShaderStatement,
  value: ShaderNodeValue,
) {
  const rawTarget = statement.target.toLowerCase();
  const target =
    rawTarget === 'return' ? (env.values.has('ret') ? 'ret' : 'uv') : rawTarget;
  const segments = target.split('.');
  const baseKey = segments[0] ?? target;
  // A write never binds a per-frame register: the base lookup is only for
  // compound assignment and swizzle writes into an existing value.
  const baseValue = getShaderEnvValue(env, baseKey, {
    bindPerFrameVariable: false,
  });
  const nextValue =
    statement.operator === '=' || !baseValue
      ? value
      : applyShaderBinaryNode(
          statement.operator.slice(0, -1) as '+' | '-' | '*' | '/',
          baseValue,
          value,
        );

  // Matrix column writes (`M[int(0)] = ...`, `M[1u].x = ...`) build up a
  // mat2 column-by-column; treat them as component writes into the packed
  // vec2 columns instead of opaque per-index env keys.
  const indexedMatch = /^([a-z_][a-z0-9_]*)\[([^\]]+)\]$/i.exec(
    segments[0] ?? '',
  );
  if (indexedMatch) {
    const matrixName = indexedMatch[1];
    const index = parseShaderIndex(indexedMatch[2]);
    if (index === null) {
      return;
    }
    const matrixValue = getShaderEnvValue(env, matrixName, {
      bindPerFrameVariable: false,
    });
    if (segments.length === 1) {
      setShaderEnvValue(
        env,
        matrixName,
        setMat2Column(matrixValue, index, nextValue),
      );
      return;
    }
    const property = segments[1]?.toLowerCase();
    if (
      !property ||
      !(
        property === 'x' ||
        property === 'y' ||
        property === 'r' ||
        property === 'g'
      )
    ) {
      return;
    }
    setShaderEnvValue(
      env,
      matrixName,
      setMat2Component(matrixValue, index, property, nextValue),
    );
    return;
  }

  if (segments.length === 1) {
    setShaderEnvValue(env, baseKey, nextValue);
    return;
  }

  const property = segments[1]?.toLowerCase();
  if (!property) {
    return;
  }

  // A swizzle assignment can target a variable that only has a bare
  // declaration (`vec2 tmpvar_2;` — no initializer). The declaration carries
  // no executable value, so without materializing the vector here the
  // assignment is dropped and every dependent statement cascades into a null
  // expression. Size the zero vector from the swizzle: w → vec4, z → vec3,
  // otherwise vec2.
  const requiredKind = resolveSwizzleAssignmentKind(property);
  if (!requiredKind) {
    return;
  }
  let base = baseValue;
  if (!base) {
    base = shaderValueFromNode(
      requiredKind === 'vec4'
        ? vec4(0, 0, 0, 0)
        : requiredKind === 'vec3'
          ? vec3(0, 0, 0)
          : vec2(0, 0),
      requiredKind,
    );
  }

  if (base.kind === 'scalar') {
    return;
  }

  // A vector built up component-by-component can outgrow its first swizzle
  // (`.xy` then `.z`); take the union of both sizes so the later component
  // isn't dropped.
  const effectiveKind =
    base.kind === 'vec4' || requiredKind === 'vec4'
      ? 'vec4'
      : base.kind === 'vec3' || requiredKind === 'vec3'
        ? 'vec3'
        : 'vec2';

  const swizzle = resolveShaderSwizzle(effectiveKind, property);
  if (!swizzle) {
    return;
  }
  if (new Set(swizzle.components).size !== swizzle.components.length) {
    return;
  }
  const parent = coerceShaderValue(base, effectiveKind).node.toVar();
  const assignedValue = coerceShaderValue(nextValue, swizzle.kind);
  swizzle.components.forEach((component, index) => {
    const targetNode =
      component === 'x'
        ? parent.x
        : component === 'y'
          ? parent.y
          : component === 'z'
            ? parent.z
            : parent.w;
    const sourceNode =
      swizzle.kind === 'scalar'
        ? assignedValue.node
        : getDirectShaderSwizzleComponentNode(
            assignedValue,
            (['x', 'y', 'z', 'w'][index] ??
              'x') as DirectShaderSwizzleComponent,
          );
    targetNode.assign(sourceNode);
  });
  setShaderEnvValue(env, baseKey, shaderValueFromNode(parent, effectiveKind));
}

/**
 * Vector size implied by a swizzle-assignment property. `w`/`a` need a vec4,
 * `z`/`b` need at least a vec3, everything else fits in a vec2.
 */
function resolveSwizzleAssignmentKind(
  property: string,
): 'vec2' | 'vec3' | 'vec4' | null {
  const normalized = property.toLowerCase();
  if (
    normalized.length === 0 ||
    [...normalized].some((entry) => !'xyzwabrg'.includes(entry))
  ) {
    return null;
  }
  if ([...normalized].some((entry) => entry === 'w' || entry === 'a')) {
    return 'vec4';
  }
  if ([...normalized].some((entry) => entry === 'z' || entry === 'b')) {
    return 'vec3';
  }
  return 'vec2';
}

/**
 * Execute a direct shader program statement by statement against `env`,
 * building the TSL node for each right-hand side and assigning it to the
 * statement's target. Exported for the headless executor tests: they run a
 * body through this and inspect the value kinds the env ends up holding.
 */
export function runShaderProgram(
  statements: MilkdropShaderStatement[],
  env: ShaderNodeEnv,
) {
  statements.forEach((statement) => {
    const value = compileShaderExpressionNode(statement.expression, env);
    if (!value) {
      return;
    }
    assignShaderTarget(env, statement, value);
  });
}

function runPerPixelProgram(
  statements: NonNullable<
    MilkdropFeedbackCompositeState['perPixelPrograms']
  >['statements'],
  env: ShaderNodeEnv,
) {
  // Collect rather than throw: a statement whose RHS cannot compile is
  // skipped, which is the right fallback — but it has to be visible. Before
  // this, an unbound name nulled the expression, the statement evaporated,
  // and the preset rendered with a silently different warp. 922 bundled
  // presets lost their rad/ang-driven per-pixel warp that way and no log
  // line existed to say so. This runs once per node-graph build (per preset
  // compile), not per frame, so logging here is cheap.
  if (!env.unresolvedNames) {
    env.unresolvedNames = new Set<string>();
  }
  const unresolved = env.unresolvedNames;
  const dropped: string[] = [];
  statements.forEach((statement) => {
    unresolved.clear();
    const value = compileShaderExpressionNode(statement.expression, env);
    if (value) {
      setShaderEnvValue(env, statement.target, value);
    } else {
      dropped.push(
        unresolved.size > 0
          ? `${statement.target} (unresolved: ${[...unresolved].join(', ')})`
          : statement.target,
      );
    }
  });
  if (dropped.length > 0) {
    tslLog.warn(
      `Dropped ${dropped.length}/${statements.length} per-pixel statement(s): ${dropped.join('; ')}`,
    );
  }
}

/**
 * Bind the stage uv and the rad/ang helpers the WebGL warp/composite templates
 * precompute from it. Shader bodies reference rad/ang as ambient values, so
 * without them statements like `(0.02 / (rad + 0.02))` silently drop.
 */
function setShaderStageUvGeometry(env: ShaderNodeEnv, uvNode: any) {
  setShaderEnvValue(env, 'uv', makeShaderValue('vec2', uvNode));
  // uv_orig → vUv in the compiled bodies: the un-transformed screen uv.
  setShaderEnvValue(env, 'vuv', makeShaderValue('vec2', uv()));
  const centered = uvNode.sub(0.5);
  setShaderEnvValue(
    env,
    'rad',
    shaderFloat(
      length(
        vec2(
          centered.x.mul(env.uniforms.aspect.x),
          centered.y.mul(env.uniforms.aspect.y),
        ),
      ).mul(2.0),
    ),
  );
  setShaderEnvValue(env, 'ang', shaderFloat(atan(centered.y, centered.x)));
}

/**
 * Seed the four geometry inputs MilkDrop hands every warp-mesh vertex before
 * running the per-pixel block, in MilkDrop's own coordinate space.
 *
 * On WebGPU there is no CPU warp mesh at all -- vm.ts takes the procedural
 * mesh descriptor, buildMeshField returns zero points and setWarpField only
 * exists on the WebGL manager -- so this per-fragment program IS the per-pixel
 * warp path. It used to seed only `x` and `y`, as raw uv(): wrong space, and
 * `rad`/`ang` unbound entirely, which made every statement reading them
 * compile to null and get dropped by runPerPixelProgram.
 *
 * The formula is butterchurn's `runPixelEquations` vertex loop
 * (butterchurn 2.6.7, lib/butterchurn.js:2596-2610), which is the faithful
 * MilkDrop 2 port and is already what this file's shader-stage helper
 * (setShaderStageUvGeometry), the WebGL warp/comp templates
 * (feedback-manager-shared.ts:970, :1161) and the CPU mesh lattice
 * (vm/geometry-builder.ts buildStaticMeshLattice) all use:
 *
 *   x   = xNdc *  0.5 * aspectx + 0.5    // 0 = left,  1 = right
 *   y   = yNdc * -0.5 * aspecty + 0.5    // 0 = TOP,   1 = bottom
 *   rad = sqrt(xNdc^2*aspectx^2 + yNdc^2*aspecty^2)
 *   ang = atan2(yNdc*aspecty, xNdc*aspectx)
 *
 * Three deliberate non-features, all three agreed on by BOTH reference
 * implementations:
 *   1. rad/ang are NOT re-centred on cx/cy. projectM 3.1.12 -- the native
 *      oracle the parity corpus is captured from -- binds `rad` and `ang`
 *      READ-ONLY to origrad/origtheta (BuiltinParams.cpp:396-398), a mesh
 *      built once at init from the fixed screen centre
 *      (PresetFrameIO.cpp:97-98). butterchurn likewise reads cx/cy only in
 *      the sampling transform further down the same loop. A `warpCenter`
 *      uniform would encode a formula neither reference has.
 *   2. aspect is applied to the FIRST power. Squaring it (which happens if
 *      you take the aspect-corrected x/y and multiply by aspect again) is
 *      not what either reference does.
 *   3. ang's y term keeps the y-UP NDC sign -- the opposite sign from the
 *      `y` variable, which is y-down.
 *
 * Known oracle gap, recorded rather than encoded: projectM 3.1.12 drops
 * aspect from rad/ang entirely and normalises by 0.7071067 (1/sqrt2), so its
 * rad is ~1/sqrt2 of MilkDrop's even at square aspect, and its `x`/`y` carry
 * no aspect at all. On the default 1280x720 capture (aspecty = 0.5625) that
 * is a large, irreducible difference for rad-heavy presets. Matching it would
 * break MilkDrop fidelity and split WebGPU from WebGL, so it is not done here.
 */
function setPerPixelEnvGeometry(
  env: ShaderNodeEnv,
  screenUv: any,
  seedTransformVariables = false,
) {
  const aspectX = env.uniforms.aspect.x;
  const aspectY = env.uniforms.aspect.y;
  const ndcX = screenUv.x.sub(0.5).mul(2);
  const ndcY = screenUv.y.sub(0.5).mul(2);
  const aspectNdcX = ndcX.mul(aspectX);
  const aspectNdcY = ndcY.mul(aspectY);
  const radNode = length(vec2(aspectNdcX, aspectNdcY));
  setShaderEnvValue(env, 'x', shaderFloat(ndcX.mul(0.5).mul(aspectX).add(0.5)));
  setShaderEnvValue(
    env,
    'y',
    shaderFloat(ndcY.mul(-0.5).mul(aspectY).add(0.5)),
  );
  setShaderEnvValue(env, 'rad', shaderFloat(radNode));
  setShaderEnvValue(env, 'ang', shaderFloat(atan(aspectNdcY, aspectNdcX)));
  if (seedTransformVariables) {
    // MilkDrop seeds every per-pixel vertex with the frame's cx/cy/sx/sy/
    // zoomexp before running the block (butterchurn runPixelEquations:2610-
    // 2621). Without these the names resolve to nothing -- there is no uniform
    // alias for them -- so `cx = cx + 0.1` compiles to null and the whole
    // statement is silently dropped by runPerPixelProgram.
    //
    // Seeded into the per-pixel env rather than added to the shared uniform
    // alias table on purpose: that table also serves the warp/comp HLSL
    // stages, where `cx`/`sx` are ordinary preset-declared locals and an alias
    // would shadow them.
    const centreScale = env.uniforms.warpCenterScale;
    setShaderEnvValue(env, 'cx', shaderFloat(centreScale.x));
    setShaderEnvValue(env, 'cy', shaderFloat(centreScale.y));
    setShaderEnvValue(env, 'sx', shaderFloat(centreScale.z));
    setShaderEnvValue(env, 'sy', shaderFloat(centreScale.w));
    setShaderEnvValue(
      env,
      'zoomexp',
      shaderFloat(env.uniforms.warpZoomExponent),
    );
  }
  // The zoom exponent reads the GEOMETRIC rad, never the env one: butterchurn's
  // `zoom2V` closes over the outer `rad` local, so a preset writing `rad` in
  // its per-pixel block does not move its own zoom. (transformMeshPoint on the
  // CPU disagrees and re-reads local.rad; butterchurn wins here.)
  return radNode;
}

function applyDirectWarpProgram(
  program: MilkdropShaderProgramPayload | null,
  env: ShaderNodeEnv,
  currentUv: any,
  samplePreviousFrame?: (uvNode: any) => any,
) {
  if (!program) {
    return null;
  }
  const stageEnv: ShaderNodeEnv = {
    ...env,
    values: new Map(env.values),
    sampleMainNode: samplePreviousFrame,
  };
  const warpUv = currentUv.toVar();
  setShaderStageUvGeometry(stageEnv, warpUv);
  // MilkDrop binds sampler_main to the feedback texture in the warp stage
  // (the WebGL warp pass sets currentTex = the previous frame). Initialize
  // ret to that sample so both ret-writing and uv-displacing warp bodies
  // produce the same color output the WebGL warp pass writes to warpTex.
  setShaderEnvValue(
    stageEnv,
    'ret',
    makeShaderValue(
      'vec3',
      samplePreviousFrame
        ? samplePreviousFrame(warpUv)
        : env.uniforms.currentTex.sample(
            env.sampleUvNode(warpUv, env.uniforms.textureWrap),
          ).rgb,
    ),
  );
  runShaderProgram(program.statements, stageEnv);
  return getShaderEnvValue(stageEnv, 'ret')?.node ?? null;
}

function applyDirectCompProgram(
  program: MilkdropShaderProgramPayload | null,
  env: ShaderNodeEnv,
  compUv: any,
  initialColor: any,
  sampleMainNode?: (uvNode: any) => any,
) {
  if (!program) {
    return initialColor;
  }
  const stageEnv: ShaderNodeEnv = {
    ...env,
    values: new Map(env.values),
    sampleMainNode,
  };
  setShaderStageUvGeometry(stageEnv, compUv);
  setShaderEnvValue(
    stageEnv,
    'ret',
    makeShaderValue('vec3', initialColor.toVar()),
  );
  runShaderProgram(program.statements, stageEnv);
  return coerceShaderValue(
    getShaderEnvValue(stageEnv, 'ret') ?? makeShaderValue('vec3', initialColor),
    'vec3',
  ).node;
}

/**
 * The aux-texture sampler, typed as returning the vec4 it always builds.
 *
 * `createSampleAuxTextureNode` is one `select()` chain over ~15 branches,
 * each constructing a vec4; three widens the chain to
 * `Node<'float' | 'vec4'>` because of the operand count, not because any
 * path yields a scalar. Callers take `.rgb`/`.rg`, which the union does not
 * carry, so the narrowing is stated once here rather than at every use.
 */
type AuxSamplerFactory = ReturnType<typeof createSampleAuxTextureNode>;

/**
 * Both halves declared as returning a vec4 rather than inheriting the
 * factory's inferred types: each is a `select()` chain over ~15 branches,
 * every one of which constructs a vec4, and three widens the chain to
 * `Node<'float' | 'vec4'>` because of the operand count, not because any path
 * yields a scalar. Callers take `.rgb`/`.rg`, which the union does not carry.
 */
type CompositeAuxSampler = {
  dynamic: (
    ...args: Parameters<AuxSamplerFactory['dynamic']>
  ) => TslNode<'vec4'>;
  sampleStatic: (
    ...args: Parameters<AuxSamplerFactory['sampleStatic']>
  ) => TslNode<'vec4'>;
};

function createCompositeAuxSampler(
  uniforms: CompositeUniformBag,
): CompositeAuxSampler {
  return createSampleAuxTextureNode(
    uniforms.noiseTex,
    uniforms.perlinTex,
    uniforms.simplexTex,
    uniforms.voronoiTex,
    uniforms.auraTex,
    uniforms.causticsTex,
    uniforms.patternTex,
    uniforms.fractalTex,
    uniforms.videoTex,
    uniforms.glyphTex,
    uniforms.organicTex,
    uniforms.noiseLqTex,
    uniforms.noisevolTex,
    uniforms.blur1Tex,
    uniforms.blur2Tex,
    uniforms.blur3Tex,
    {
      noise: uniforms.noiseTex3D,
      simplex: uniforms.simplexTex3D,
      voronoi: uniforms.voronoiTex3D,
      aura: uniforms.auraTex3D,
      caustics: uniforms.causticsTex3D,
      pattern: uniforms.patternTex3D,
      fractal: uniforms.fractalTex3D,
      perlin: uniforms.perlinTex3D,
      noisevol: uniforms.noisevolTex3D,
    },
  ) as unknown as CompositeAuxSampler;
}

/**
 * Builds this frame's internal image — the warped previous frame with fresh
 * geometry blended on top — which is what feeds the next frame's warp.
 * MilkDrop never feeds the comp stage's output back into the loop, so the
 * comp program, color adjustments, and post chain all live in the
 * display-only composite node instead.
 */
/** nVideoEchoOrientation bit 0 flips x, bit 1 flips y. */
const applyVideoEchoOrientationNode = Fn(
  ([sampleUv, orientation]: [any, any]) => {
    const flipX = step(0.5, orientation.sub(floor(orientation.div(2)).mul(2)));
    const flipY = step(1.5, orientation.sub(floor(orientation.div(4)).mul(4)));
    return vec2(
      mix(sampleUv.x, float(1).sub(sampleUv.x), flipX),
      mix(sampleUv.y, float(1).sub(sampleUv.y), flipY),
    );
  },
);

function createFeedbackBlendOutputNode(
  uniforms: CompositeUniformBag,
  shaderPrograms: {
    warp: MilkdropShaderProgramPayload | null;
    comp: MilkdropShaderProgramPayload | null;
  } = {
    warp: null,
    comp: null,
  },
  perPixelPrograms?: MilkdropFeedbackCompositeState['perPixelPrograms'],
) {
  const sampleUvNode = createSampleUvNode();
  const applyFeedbackWarpNode = createApplyFeedbackWarpNode();
  const sampleAuxTextureNode = createCompositeAuxSampler(uniforms);

  return Fn(() => {
    const hasDirectWarpProgram = shaderPrograms.warp !== null;
    const shaderEnv: ShaderNodeEnv = {
      values: new Map<string, ShaderNodeValue>(),
      uniforms,
      sampleUvNode,
      sampleAuxTextureNode,
    };
    const baseUv = uv();
    const centeredUv = baseUv.sub(0.5);

    const perPixelEnv: ShaderNodeEnv = {
      ...shaderEnv,
      values: new Map(shaderEnv.values),
    };
    // Blast-radius gate. Only a preset whose per-pixel block actually assigns
    // to cx/cy/sx/sy/zoomexp gets the full MilkDrop transform below; every
    // other preset keeps the byte-identical legacy node graph and therefore
    // cannot move by even one ULP. That covers presets with no per-pixel block
    // at all (100-square) and presets whose block only touches the four
    // variables the legacy path already consumed (rovastar-parallel-universe:
    // dx/dy only).
    const usesWarpTransformVariables = perPixelWritesWarpTransform(
      perPixelPrograms?.statements,
    );
    const perPixelRad = setPerPixelEnvGeometry(
      perPixelEnv,
      baseUv,
      usesWarpTransformVariables,
    );
    if (perPixelPrograms) {
      runPerPixelProgram(perPixelPrograms.statements, perPixelEnv);
    }
    const activeWarp =
      getShaderEnvValue(perPixelEnv, 'warp')?.node ?? uniforms.warpScale;
    const activeZoom =
      getShaderEnvValue(perPixelEnv, 'zoom')?.node ?? uniforms.zoomMul;
    const activeRot =
      getShaderEnvValue(perPixelEnv, 'rot')?.node ?? uniforms.rotation;
    const activeOffsetX =
      getShaderEnvValue(perPixelEnv, 'dx')?.node ?? uniforms.offsetX;
    const activeOffsetY =
      getShaderEnvValue(perPixelEnv, 'dy')?.node ?? uniforms.offsetY;

    // Sampling coordinates must invert the intended image transform (rotate
    // backward to find where displayed content came from), so negate the
    // rotation to make the image visually rotate by +rot, matching the WebGL
    // warp/composite shaders and the CPU/GPU mesh transform direction.
    const rotationSin = sin(activeRot).mul(-1);
    const rotationCos = cos(activeRot);
    const rotateAboutOrigin = (point: any) =>
      vec2(
        point.x.mul(rotationCos).sub(point.y.mul(rotationSin)),
        point.x.mul(rotationSin).add(point.y.mul(rotationCos)),
      );

    let transformedUv: any;
    if (!usesWarpTransformVariables) {
      transformedUv = rotateAboutOrigin(centeredUv)
        .div(max(activeZoom, 0.0001))
        .add(vec2(activeOffsetX, activeOffsetY));
    } else {
      // The MilkDrop sampling transform, ordered as butterchurn 2.6.7's
      // runPixelEquations:2626-2657. Documented in full, with the points where
      // the repo's CPU mesh path disagrees, in warp-sample-transform.ts --
      // computeWarpSampleUv there is the scalar twin of this node graph and is
      // what the unit test pins. Keep the two in step.
      const activeCx =
        getShaderEnvValue(perPixelEnv, 'cx')?.node ??
        uniforms.warpCenterScale.x;
      const activeCy =
        getShaderEnvValue(perPixelEnv, 'cy')?.node ??
        uniforms.warpCenterScale.y;
      const activeSx =
        getShaderEnvValue(perPixelEnv, 'sx')?.node ??
        uniforms.warpCenterScale.z;
      const activeSy =
        getShaderEnvValue(perPixelEnv, 'sy')?.node ??
        uniforms.warpCenterScale.w;
      const activeZoomExp =
        getShaderEnvValue(perPixelEnv, 'zoomexp')?.node ??
        uniforms.warpZoomExponent;

      // cx/cy are MilkDrop [0,1] coordinates: aspect-squeezed, y measured
      // DOWNWARD. Screen uv here is aspect-free and y-up, so undo both --
      // exactly the inverse of the `x`/`y` the program was handed.
      const warpCentre = vec2(
        activeCx.sub(0.5).div(uniforms.aspect.x),
        activeCy.sub(0.5).div(uniforms.aspect.y).mul(-1),
      );

      // zoom ^ (zoomexp ^ (rad*2 - 1)), about the SCREEN centre -- never cx/cy.
      // The zoomexp == 1 branch returns `zoom` untouched because a GPU pow() is
      // exp2(y*log2(x)) and pow(z, 1.0) is therefore not z bit-for-bit; without
      // the select, every preset in the gate would shift by ~1e-7 for nothing.
      // The clamps bound the pow away from f32 overflow on presets that ship
      // extreme zoom/zoomexp pairs; they sit on the zoomexp != 1 branch only,
      // so the 0.0001 divisor floor below stays the sole guard on the
      // degenerate zoom -> 0 case a passing reference depends on.
      const zoomPowExponent = clamp(
        pow(clamp(activeZoomExp, 0.0001, 10000), perPixelRad.mul(2).sub(1)),
        0.0001,
        10000,
      );
      const zoomDivisor = select(
        abs(activeZoomExp.sub(1)).lessThan(0.000001),
        activeZoom,
        clamp(
          pow(clamp(activeZoom, 0.0001, 10000), zoomPowExponent),
          0.0001,
          10000,
        ),
      );
      const zoomedUv = centeredUv.div(max(zoomDivisor, 0.0001));

      // (u - c)/s + c, emitted as u/s + (c - c/s). At s == 1 the bracket is
      // `c - c` -- exactly zero -- and u/1 is exactly u, so a preset that moves
      // only cx/cy cannot perturb the coordinate here. Writing it the obvious
      // way instead loses ~1 ULP of the CENTRE, which is ~6e-8 of uv.
      // sx/sy of exactly zero would make that bracket Inf - Inf; the CPU path
      // guards the same case with `scaleX || 1`.
      const safeScale = vec2(
        select(abs(activeSx).lessThan(1e-8), float(1), activeSx),
        select(abs(activeSy).lessThan(1e-8), float(1), activeSy),
      );
      const scaledUv = zoomedUv
        .div(safeScale)
        .add(warpCentre.sub(warpCentre.div(safeScale)));

      // R(u - c) + c, emitted as R(u) + (c - R(c)) for the same reason: at
      // rot == 0 the rotation is the numeric identity, so the bracket is
      // exactly zero. This is what keeps 300-beatdetect-bassmidtreb --
      // `per_pixel_1=cx=x` over sx=sy=1, rot unset, zoom=1 -- bit-for-bit
      // identical to the legacy path. Its cx write is mathematically inert in
      // MilkDrop too, and a currently-passing reference must not move for it.
      transformedUv = rotateAboutOrigin(scaledUv)
        .add(warpCentre.sub(rotateAboutOrigin(warpCentre)))
        .add(vec2(activeOffsetX, activeOffsetY));
    }

    // Direct warp: mirror the WebGL warp pass. MilkDrop runs the warp shader
    // as its own pass over the previous frame (sampler_main = feedback) and
    // the shader's `ret` is the warped color; the blend pass then lays the
    // fresh scene on top at the plain screen uv without re-warping it.
    if (hasDirectWarpProgram) {
      const samplePreviousFrame = (sampleCoord: any) =>
        uniforms.previousTex.sample(
          sampleUvNode(sampleCoord, uniforms.textureWrap),
        ).rgb;
      const warpColor = applyDirectWarpProgram(
        shaderPrograms.warp,
        shaderEnv,
        transformedUv.add(0.5),
        samplePreviousFrame,
      );
      const sceneUv = uv();
      const current = uniforms.currentTex.sample(
        sampleUvNode(sceneUv, uniforms.textureWrap),
      );
      const previousColor = (
        warpColor ??
        uniforms.previousTex.sample(sampleUvNode(sceneUv, uniforms.textureWrap))
          .rgb
      ).mul(uniforms.decay);
      return vec4(previousColor.add(current.rgb), 1);
    }

    const currentUv = applyFeedbackWarpNode(
      transformedUv.add(0.5),
      activeWarp,
      activeRot,
    ).toVar();
    const previousUv = applyFeedbackWarpNode(
      currentUv.sub(0.5).div(max(uniforms.zoom, 0.0001)).add(0.5),
      activeWarp.mul(0.8),
      activeRot.mul(0.6),
    ).toVar();
    const warpTextureMask = step(0.5, uniforms.warpTextureSource).mul(
      step(0.0001, uniforms.warpTextureAmount),
    );
    // `CompositeUniformBag` is `Record<string, any>`, so `.mul(any)` resolves
    // to the widest overload (vec3) and the uv chain stops being a vec2.
    // These two are `uniform(new Vector2(...))` at their declaration
    // (feedback-manager-webgpu-composite.ts), so saying so here keeps the
    // chain honest without typing all 114 uniforms.
    const warpUv = currentUv
      .mul(uniforms.warpTextureScale as TslNode<'vec2'>)
      .add(uniforms.warpTextureOffset as TslNode<'vec2'>);
    const warpVector = sampleAuxTextureNode
      .dynamic(
        uniforms.warpTextureSource,
        uniforms.warpTextureSampleDimension,
        warpUv,
        uniforms.warpTextureVolumeSliceZ,
      )
      .rg.sub(0.5)
      .toVar();
    currentUv.addAssign(
      warpVector.mul(uniforms.warpTextureAmount).mul(0.12).mul(warpTextureMask),
    );
    previousUv.addAssign(
      warpVector.mul(uniforms.warpTextureAmount).mul(0.08).mul(warpTextureMask),
    );

    const current = uniforms.currentTex.sample(
      sampleUvNode(currentUv, uniforms.textureWrap),
    );
    const previous = uniforms.previousTex.sample(
      sampleUvNode(previousUv, uniforms.textureWrap),
    );
    const previousColor = previous.rgb.mul(uniforms.decay);

    // Internal frame: the warped, decayed previous frame with this frame's
    // geometry drawn over it. Control-driven presets used to blend the two by
    // videoEchoAlpha instead, so a preset without video echo (alpha 0)
    // discarded its history outright: fDecay did nothing and no warp variable
    // could accumulate, because there was never anything left to move. Video
    // echo is a display-stage effect in MilkDrop, not the mechanism that
    // carries feedback. Mirrors the WebGL blend in feedback-manager-shared.ts.
    //
    // The scene colour arrives premultiplied — three.js blends src.rgb times
    // src.a into a target that starts at zero — so this is a straight over,
    // not a mix (a mix darkens covered pixels twice).
    const coverage = clamp(current.a, 0, 1);
    const color = previousColor.mul(float(1).sub(coverage)).add(current.rgb);

    return vec4(color, 1);
  })();
}

/**
 * Display-only composite: renders the comp program, color adjustments,
 * overlay, and the post chain over the internal frame into the display
 * target. Mirrors the WebGL split — nothing computed here feeds the next
 * frame.
 */
function createCompositeOutputNode(
  uniforms: CompositeUniformBag,
  shaderPrograms: {
    warp: MilkdropShaderProgramPayload | null;
    comp: MilkdropShaderProgramPayload | null;
  } = {
    warp: null,
    comp: null,
  },
) {
  const sampleUvNode = createSampleUvNode();
  const sampleAuxTextureNode = createCompositeAuxSampler(uniforms);

  return Fn(() => {
    const hasDirectCompProgram = shaderPrograms.comp !== null;
    const shaderEnv: ShaderNodeEnv = {
      values: new Map<string, ShaderNodeValue>(),
      uniforms,
      sampleUvNode,
      sampleAuxTextureNode,
    };
    const baseUv = uv();

    // MilkDrop's comp stage reads sampler_main as this frame's composited
    // internal image, written by the feedback-blend pass.
    const sampleMainNode = (sampleCoord: any) =>
      uniforms.internalTex.sample(
        sampleUvNode(sampleCoord, uniforms.textureWrap),
      ).rgb;

    const color = sampleMainNode(baseUv).toVar();

    // MilkDrop's video echo is a display effect: the frame is drawn a second
    // time, zoomed by fVideoEchoZoom and flipped per nVideoEchoOrientation,
    // blended over the first by fVideoEchoAlpha. Flipping the feedback sample
    // instead (what this did) rotated the carried history every frame and
    // broke the invariant the effect is defined by — at alpha 0.5 with
    // orientation 3 the output equals its own 180-degree rotation (projectM
    // reference self-correlation 0.9994, ours 0.66 before this).
    const echoUv = applyVideoEchoOrientationNode(
      baseUv.sub(0.5).div(max(uniforms.videoEchoZoom, 0.0001)).add(0.5),
      uniforms.videoEchoOrientation,
    );
    color.assign(
      mix(color, sampleMainNode(echoUv), clamp(uniforms.videoEchoAlpha, 0, 1)),
    );

    // Apply color adjustments in MilkDrop order — before the comp program,
    // matching the WebGL composite pass
    color.assign(hueRotateNode(color, uniforms.hueShift));
    color.assign(applySaturationNode(color, uniforms.saturation));
    color.assign(applyContrastNode(color, uniforms.contrast));
    color.assign(color.mul(uniforms.colorScale));
    color.assign(color.mul(uniforms.tint));

    if (hasDirectCompProgram) {
      color.assign(
        applyDirectCompProgram(
          shaderPrograms.comp,
          shaderEnv,
          // Comp equations address the un-warped screen uv in MilkDrop.
          baseUv,
          color,
          sampleMainNode,
        ),
      );
    }

    // Overlay texture
    const overlaySourceMask = step(0.5, uniforms.overlayTextureSource);
    const overlayReplaceMask = step(0.5, uniforms.overlayTextureMode).mul(
      float(1).sub(step(1.5, uniforms.overlayTextureMode)),
    );
    const overlayBlendMask = step(1.5, uniforms.overlayTextureMode).mul(
      step(0.0001, uniforms.overlayTextureAmount),
    );
    const overlayMask = overlaySourceMask.mul(
      max(overlayReplaceMask, overlayBlendMask),
    );
    // `CompositeUniformBag` is `Record<string, any>`, so `.mul(any)` resolves
    // to the widest overload (vec3) and the uv chain stops being a vec2.
    // These two are `uniform(new Vector2(...))` at their declaration
    // (feedback-manager-webgpu-composite.ts), so saying so here keeps the
    // chain honest without typing all 114 uniforms.
    const overlayUv = baseUv
      .mul(uniforms.overlayTextureScale as TslNode<'vec2'>)
      .add(uniforms.overlayTextureOffset as TslNode<'vec2'>);
    const overlaySample = sampleAuxTextureNode.dynamic(
      uniforms.overlayTextureSource,
      uniforms.overlayTextureSampleDimension,
      overlayUv,
      uniforms.overlayTextureVolumeSliceZ,
    ).rgb;
    const overlayColor = mix(
      overlaySample,
      vec3(1).sub(overlaySample),
      step(0.5, uniforms.overlayTextureInvert),
    );
    const overlayAmount = clamp(uniforms.overlayTextureAmount, 0, 1.5);
    const overlayReplace = overlayColor;
    const overlayMixAmount = clamp(overlayAmount, 0, 1);
    const overlayMix = mix(color, overlayColor, overlayMixAmount);
    const overlayAdd = min(vec3(1), color.add(overlayColor.mul(overlayAmount)));
    const overlayMultiply = color.mul(
      mix(vec3(1), overlayColor, overlayMixAmount),
    );
    const overlaySubtract = max(
      vec3(0),
      color.sub(overlayColor.mul(overlayAmount)),
    );
    const overlayResult = select(
      uniforms.overlayTextureMode.lessThan(1.5),
      overlayReplace,
      select(
        uniforms.overlayTextureMode.lessThan(2.5),
        overlayMix,
        select(
          uniforms.overlayTextureMode.lessThan(3.5),
          overlayAdd,
          select(
            uniforms.overlayTextureMode.lessThan(4.5),
            overlayMultiply,
            overlaySubtract,
          ),
        ),
      ),
    );
    color.assign(mix(color, overlayResult, overlayMask));

    // MilkDrop's own curves — brighten = sqrt, darken = square, solarize =
    // c(1-c)4 — matching the WebGL composite and Butterchurn's shader. The
    // previous approximations changed each curve's shape, and solarize's was
    // wrong at the black end: abs(c - 0.5) * 2 maps 0 to WHITE, so a dark
    // preset with bSolarize rendered as a white field.
    color.assign(
      mix(
        color,
        max(color, vec3(0)).sqrt(),
        clamp(max(uniforms.brighten, uniforms.brightenBoost), 0, 1),
      ),
    );

    color.assign(mix(color, color.mul(color), step(0.5, uniforms.darken)));

    color.assign(
      mix(
        color,
        color.mul(float(1).sub(color)).mul(4.0),
        clamp(max(uniforms.solarize, uniforms.solarizeBoost), 0, 1),
      ),
    );

    // Invert
    color.assign(
      mix(
        color,
        vec3(1).sub(color),
        clamp(max(uniforms.invert, uniforms.invertBoost), 0, 1),
      ),
    );

    // Darken center
    const centerDist = baseUv.sub(0.5).length();
    const centerMask = clamp(float(1).sub(centerDist.mul(1.4)), 0, 1);
    const centerMultiplier = float(1).sub(
      smoothstep(0, 0.35, centerMask).mul(0.03),
    );
    color.assign(
      color.mul(
        mix(float(1), centerMultiplier, step(0.5, uniforms.darkenCenter)),
      ),
    );

    // Vignette
    const vigEnabled = step(0.01, uniforms.vignette);
    const vigDist = baseUv.sub(0.5).length();
    const vigAmount = clamp(
      float(1).sub(vigDist.mul(float(1).add(uniforms.vignette.mul(0.8)))),
      0,
      1,
    );
    color.assign(color.mul(mix(vec3(1), vec3(vigAmount), vigEnabled)));

    // Chromatic aberration
    const chromaEnabled = step(0.01, uniforms.chromaticAberration);
    const chromaDir = baseUv
      .sub(0.5)
      .mul(uniforms.chromaticAberration.mul(0.02));
    const chromaR = sampleFeedbackTarget(
      uniforms.internalTex,
      baseUv.add(chromaDir),
    ).r;
    const chromaB = sampleFeedbackTarget(
      uniforms.internalTex,
      baseUv.sub(chromaDir),
    ).b;
    color.assign(mix(color, vec3(chromaR, color.g, chromaB), chromaEnabled));

    // Red-blue stereo
    const stereoEnabled = step(0.5, uniforms.redBlueStereo);
    const stereoOffset = float(0.003).add(uniforms.signalEnergy.mul(0.003));
    const leftStereo = uniforms.internalTex.sample(
      sampleUvNode(baseUv.sub(vec2(stereoOffset, 0)), uniforms.textureWrap),
    ).rgb;
    const rightStereo = uniforms.internalTex.sample(
      sampleUvNode(baseUv.add(vec2(stereoOffset, 0)), uniforms.textureWrap),
    ).rgb;
    const stereoColor = vec3(leftStereo.r, rightStereo.g, rightStereo.b);
    color.assign(mix(color, stereoColor, stereoEnabled.mul(0.85)));

    // Gamma stays a power at the END of the chain, matching the WebGL
    // composite. See the note there: the exponent form is what projectM was
    // measured to do, and moving it to Butterchurn's position regressed the
    // comp-shader references hard.
    color.assign(
      pow(
        max(color, vec3(0)),
        vec3(float(1).div(max(uniforms.gammaAdj, 0.0001))),
      ),
    );

    // Post-processing pass (WebGPU full-path equivalents of WebGL passes)
    // Only pointwise effects run in-pass. The old in-pass bloom, chromatic
    // aberration, and afterimage nodes sampled internalTex / previousTex —
    // the PRE-COMP internal image — so whenever the postprocessing profile
    // enabled them they replaced comp-program output channels with
    // internal-image pixels (chroma alone turned every grayscale comp preset
    // green by zeroing R/B). Bloom and chroma now run in the present pass
    // over the COMPOSITED frame.
    color.assign(applyPostFilmGrainNode(uniforms)(color));

    // Afterimage accumulator (THREE.AfterimagePass semantics): the history
    // texture is last frame's composited display frame — the retired half of
    // the display ping-pong, never the feedback chain. The max() is
    // pointwise, so it is safe in-pass; inserting a separate pass between
    // composite and present trips a Dawn TextureBinding|RenderAttachment
    // synchronization-scope error. Runs before the present pass's bloom and
    // chroma (WebGL orders bloom before afterimage; the trails there don't
    // re-bloom either, so the visible difference is negligible).
    If(step(0.0001, uniforms.postAfterimageDamp), () => {
      const history = sampleFeedbackTarget(
        uniforms.displayHistoryTex,
        baseUv,
      ).rgb;
      const damped = history
        .mul(uniforms.postAfterimageDamp)
        .mul(step(vec3(0.1), history));
      color.assign(max(color, damped));
    });

    return vec4(max(color, vec3(0)), 1);
  })();
}

function applyPostFilmGrainNode(uniforms: CompositeUniformBag) {
  return Fn(([baseColor]: [any]) => {
    const sampleUv = uv();
    const amount = uniforms.postFilmGrainAmount;
    const enabled = step(0.0001, amount);
    const outColor = baseColor.toVar();

    If(enabled, () => {
      const resolutionNoise = sampleUv
        .mul(vec2(uniforms.texsize.x, uniforms.texsize.y))
        .add(uniforms.signalTime.mul(1000));
      const hashed = fract(
        sin(dot(resolutionNoise, vec2(12.9898, 78.233))).mul(43758.5453),
      );
      // FilmPass semantics (three's FilmShader): multiplicative grain scaled
      // by the pixel itself — base * (1 + intensity * clamp(0.1 + noise)).
      // The old additive ±amount grain stamped a visible dot field over
      // bright frames that WebGL's FilmPass never shows.
      const grain = clamp(hashed.add(0.1), 0, 1).mul(amount);
      outColor.assign(baseColor.mul(grain.add(1)));
    });

    return outColor;
  });
}

/**
 * Identity snapshot of the inputs that force a node-graph rebuild. The state
 * wrapper is rebuilt every frame, but the program payloads and statement
 * arrays inside it are stable per compiled preset, so reference equality is
 * an exact change signal — the previous multi-KB string key concatenated the
 * full shader sources every frame just to compare them.
 */
type CompositeStateIdentity = {
  shaderExecution: MilkdropFeedbackCompositeState['shaderExecution'];
  warp: unknown;
  comp: unknown;
  perPixelStatements: unknown;
};

// ~2s at 60fps: long enough to ride out beat-driven oscillation of the
// scene-resolution predicates, short enough to reclaim the cheaper feedback
// resolution soon after a preset stops needing the scene path.
const WEBGPU_SCENE_RESOLUTION_RELEASE_FRAMES = 120;

function compositeStateIdentityChanged(
  previous: CompositeStateIdentity | null,
  state: MilkdropFeedbackCompositeState,
) {
  return (
    !previous ||
    previous.shaderExecution !== state.shaderExecution ||
    previous.warp !== state.shaderPrograms.warp ||
    previous.comp !== state.shaderPrograms.comp ||
    previous.perPixelStatements !== (state.perPixelPrograms?.statements ?? null)
  );
}

class WebGPUMilkdropFeedbackManager
  extends MilkdropFeedbackManagerLifecycleBase<RenderTarget>
  implements MilkdropFeedbackManager
{
  readonly compositeScene = new Scene();
  readonly feedbackBlendScene = new Scene();
  readonly presentScene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  readonly compositeMaterial: NodeMaterial & { uniforms: CompositeUniformBag };
  readonly feedbackBlendMaterial: NodeMaterial & {
    uniforms: CompositeUniformBag;
  };
  readonly presentMaterial: NodeMaterial & {
    uniforms: ReturnType<typeof createPresentUniforms>;
  };
  readonly blurMaterial: NodeMaterial & {
    uniforms: ReturnType<typeof createGaussianBlurUniforms>;
  };
  readonly sceneTarget: RenderTarget;
  readonly targets: [RenderTarget, RenderTarget];
  // Display frames ping-pong so the composite pass can sample last frame's
  // composited output (afterimage history) while writing this frame's.
  readonly displayTargets: [RenderTarget, RenderTarget];
  private displayIndex = 0;
  readonly blurTarget: RenderTarget;
  readonly blurScene = new Scene();
  readonly profile: FeedbackBackendProfile;
  readonly auxTextures: Record<string, Texture>;
  compositeIdentity: CompositeStateIdentity | null = null;
  sceneResolutionReleaseCountdown = 0;
  lastBlurKernelSigma = -1;
  currentOverlayTextureName: keyof typeof MILKDROP_TEXTURE_FILES | null = null;
  currentWarpTextureName: keyof typeof MILKDROP_TEXTURE_FILES | null = null;
  // Saved frames ping-pong too: the present material keeps savedTex bound
  // even when transitionAlpha=0 skips the dissolve branch, so rendering the
  // present scene INTO the texture savedTex points at trips Dawn's
  // TextureBinding|RenderAttachment same-scope validation on every save
  // after the first.
  private savedFrameTargets: [RenderTarget | null, RenderTarget | null] = [
    null,
    null,
  ];
  private savedFrameIndex = 0;
  private lastRenderer: FeedbackRendererLike | null = null;
  private compositeSwapRevision = 0;
  // Warm-up materials from the previous preset swap. They are kept alive
  // until the next swap (or dispose): releasing them immediately would
  // decrement the renderer's code-keyed program refcounts and evict the very
  // pipelines the warm-up just compiled before the live materials rebuild.
  private retiredWarmMaterials: NodeMaterial[] = [];

  constructor(
    width: number,
    height: number,
    profile: FeedbackBackendProfile = WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile,
  ) {
    super(width, height, profile);
    this.profile = profile;
    this.camera.position.z = 1;
    this.camera.matrixAutoUpdate = false;
    this.camera.updateMatrixWorld(true);
    this.feedbackBlendScene.matrixAutoUpdate = false;
    this.compositeScene.matrixAutoUpdate = false;
    this.presentScene.matrixAutoUpdate = false;
    this.blurScene.matrixAutoUpdate = false;
    this.auxTextures = getSharedMilkdropAuxTextures();
    for (const name of Object.keys(MILKDROP_TEXTURE_FILES) as Array<
      keyof typeof MILKDROP_TEXTURE_FILES
    >) {
      void getShared3dAuxTexture(name).then((tex3d) => {
        const uniformKey = `${name}Tex3D`;
        if (this.compositeMaterial?.uniforms[uniformKey]) {
          this.compositeMaterial.uniforms[uniformKey].value = tex3d;
        }
      });
    }
    this.sceneTarget = createFeedbackRenderTarget(
      width,
      height,
      this.sceneResolutionScale,
    );
    this.targets = [
      createFeedbackRenderTarget(width, height, this.feedbackResolutionScale),
      createFeedbackRenderTarget(width, height, this.feedbackResolutionScale),
    ];
    this.displayTargets = [
      createFeedbackRenderTarget(width, height, this.feedbackResolutionScale),
      createFeedbackRenderTarget(width, height, this.feedbackResolutionScale),
    ];
    this.blurTarget = createFeedbackRenderTarget(
      width,
      height,
      this.feedbackResolutionScale,
    );

    const uniforms = createCompositeUniforms(
      this.sceneTarget.texture,
      this.targets[0].texture,
      this.auxTextures,
    );
    uniforms.internalTex.value = this.targets[1].texture;
    uniforms.blur1Tex.value = this.blurTarget.texture;
    uniforms.blur2Tex.value = this.blurTarget.texture;
    uniforms.blur3Tex.value = this.blurTarget.texture;
    uniforms.texelSize.value.set(
      1 / Math.max(1, this.targets[0].width),
      1 / Math.max(1, this.targets[0].height),
    );
    // MilkDrop's texsize is the size of the MAIN (feedback) texture the
    // shaders sample, not the viewport. The feedback targets run at a
    // resolution scale, and neighbor-tap shaders (game-of-life style CA
    // warp bodies do `uv + texsize.zw`) need EXACT one-texel offsets — a
    // viewport-derived texsize made every tap land ~0.95 texels off and the
    // linear filter averaged the cells dead.
    uniforms.texsize.value.set(
      this.targets[0].width,
      this.targets[0].height,
      1 / Math.max(1, this.targets[0].width),
      1 / Math.max(1, this.targets[0].height),
    );

    // The feedback-blend and composite materials share one uniform bag, so
    // applyCompositeState feeds both passes.
    const feedbackBlendMaterial = new NodeMaterial();
    feedbackBlendMaterial.outputNode = createFeedbackBlendOutputNode(uniforms);
    feedbackBlendMaterial.needsUpdate = true;
    this.feedbackBlendMaterial = Object.assign(feedbackBlendMaterial, {
      uniforms,
    });

    const compositeMaterial = new NodeMaterial();
    compositeMaterial.outputNode = createCompositeOutputNode(uniforms);
    compositeMaterial.needsUpdate = true;
    this.compositeMaterial = Object.assign(compositeMaterial, {
      uniforms,
    });

    const blurUniforms = createGaussianBlurUniforms(this.targets[0].texture);
    const blurMaterial = new NodeMaterial();
    blurMaterial.outputNode = createGaussianBlurOutputNode(blurUniforms);
    blurMaterial.needsUpdate = true;
    this.blurMaterial = Object.assign(blurMaterial, { uniforms: blurUniforms });

    const presentUniforms = createPresentUniforms(
      this.displayTargets[0].texture,
    );
    const presentMaterial = new NodeMaterial();
    presentMaterial.outputNode = createPresentOutputNode(presentUniforms);
    presentMaterial.needsUpdate = true;
    this.presentMaterial = Object.assign(presentMaterial, {
      uniforms: presentUniforms,
    });

    const feedbackBlendQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.feedbackBlendMaterial,
    );
    const compositeQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.compositeMaterial,
    );
    const presentQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.presentMaterial,
    );
    const blurQuad = new Mesh(FULLSCREEN_QUAD_GEOMETRY, this.blurMaterial);
    this.feedbackBlendScene.add(feedbackBlendQuad);
    this.compositeScene.add(compositeQuad);
    this.presentScene.add(presentQuad);
    this.blurScene.add(blurQuad);
  }

  setAudioTexture(audioTexture: Texture | null): void {
    if (this.compositeMaterial?.uniforms?.audioTex) {
      this.compositeMaterial.uniforms.audioTex.value = audioTexture;
    }
  }

  /**
   * Empties the feedback chain so the next frame starts from nothing.
   *
   * Only the WebGL manager implemented this, so a `resetHistory` frame — what
   * the deterministic frame pump uses to make a capture reproducible — left
   * native WebGPU rendering on top of whatever the previous warmup had
   * accumulated. Measured with `lab:backend-diff`, that put the same-backend
   * run-to-run mismatch at a 48.9% median on WebGPU against 6.0% on WebGL,
   * which buries any real disagreement between the two.
   */
  clearHistory(): void {
    const renderer = this.lastRenderer as
      | (FeedbackRendererLike & {
          clear?: () => void;
          getClearAlpha?: () => number;
          setClearAlpha?: (alpha: number) => void;
          getClearColor?: (target: Color) => Color;
          setClearColor?: (color: Color | number, alpha?: number) => void;
        })
      | null;
    if (!renderer?.setRenderTarget) {
      return;
    }
    const previousClearAlpha = renderer.getClearAlpha?.() ?? 1;
    const previousClearColor = renderer.getClearColor?.(
      CLEAR_HISTORY_COLOR_SCRATCH,
    );
    renderer.setClearColor?.(0x000000, 0);
    for (const target of [
      this.targets[0],
      this.targets[1],
      this.displayTargets[0],
      this.displayTargets[1],
      this.blurTarget,
      this.sceneTarget,
      this.savedFrameTargets[0],
      this.savedFrameTargets[1],
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

  swap() {
    this.index = (this.index + 1) % 2;
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;
  }

  saveCurrentFrame(): void {
    let target = this.savedFrameTargets[this.savedFrameIndex];
    if (!target) {
      target = createFeedbackRenderTarget(
        this.viewportWidth,
        this.viewportHeight,
        this.currentFeedbackResolutionScale,
      );
      this.savedFrameTargets[this.savedFrameIndex] = target;
    }
    const renderer = this.lastRenderer;
    if (!renderer?.setRenderTarget) return;
    renderer.setRenderTarget(target);
    const oldAlpha = this.presentMaterial.uniforms.transitionAlpha.value;
    this.presentMaterial.uniforms.transitionAlpha.value = 0;
    renderer.render(this.presentScene, this.camera);
    this.presentMaterial.uniforms.transitionAlpha.value = oldAlpha;
    this.presentMaterial.uniforms.savedTex.value = target.texture;
    this.savedFrameIndex = 1 - this.savedFrameIndex;
  }

  applyPostprocessingProfile(
    profile: MilkdropPostprocessingProfile | null | undefined,
  ) {
    const uniforms = this.compositeMaterial.uniforms;
    const presentUniforms = this.presentMaterial.uniforms;
    const enabled = Boolean(profile?.enabled);
    // Bloom and chromatic aberration run in the PRESENT pass over the
    // composited frame; their old composite-pass versions sampled the
    // pre-comp internal image and corrupted comp-program output (the
    // noisevol green-screen bug).
    presentUniforms.postBloomStrength.value = enabled
      ? (profile?.bloomStrength ?? 0)
      : 0;
    presentUniforms.postBloomThreshold.value = profile?.bloomThreshold ?? 0.85;
    presentUniforms.postBloomRadius.value = profile?.bloomRadius ?? 0.5;
    presentUniforms.postTexelSize.value.set(
      1 / Math.max(1, this.displayTargets[0].width),
      1 / Math.max(1, this.displayTargets[0].height),
    );
    uniforms.postFilmGrainAmount.value = enabled
      ? (profile?.filmNoise ?? 0)
      : 0;
    presentUniforms.postChromaticAberration.value = enabled
      ? (profile?.chromaOffset ?? 0)
      : 0;
    // Afterimage accumulates over the display ping-pong inside the composite
    // pass (see createCompositeOutputNode) — never over the feedback chain.
    uniforms.postAfterimageDamp.value = enabled
      ? Math.max(profile?.afterimageDamp ?? 0, 0)
      : 0;
  }

  private async warmAndSwapCompositeNodes(
    renderer: FeedbackRendererLike & {
      compileAsync: (
        scene: Scene,
        camera: OrthographicCamera,
      ) => Promise<unknown>;
      getRenderTarget?: () => RenderTarget | null;
    },
    revision: number,
    feedbackBlendNode: unknown,
    compositeNode: unknown,
  ) {
    for (const material of this.retiredWarmMaterials) {
      disposeMaterial(material);
    }
    this.retiredWarmMaterials = [];

    const warmBlend = new NodeMaterial();
    warmBlend.outputNode = feedbackBlendNode as typeof warmBlend.outputNode;
    warmBlend.needsUpdate = true;
    const warmComposite = new NodeMaterial();
    warmComposite.outputNode = compositeNode as typeof warmComposite.outputNode;
    warmComposite.needsUpdate = true;

    const warmScene = new Scene();
    warmScene.matrixAutoUpdate = false;
    warmScene.add(new Mesh(FULLSCREEN_QUAD_GEOMETRY, warmBlend));
    warmScene.add(new Mesh(FULLSCREEN_QUAD_GEOMETRY, warmComposite));

    // Compile against the real feedback target so the pipeline cache key
    // (color format, sample count) matches the live passes.
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    try {
      renderer.setRenderTarget(this.writeTarget);
      await renderer.compileAsync(warmScene, this.camera);
    } catch {
      // Warm-up is best-effort: on failure the swap below still happens and
      // the first frame compiles synchronously, which is the old behavior.
    } finally {
      try {
        renderer.setRenderTarget(previousTarget);
      } catch {
        // The renderer may have been disposed mid-warm-up.
      }
    }

    if (revision !== this.compositeSwapRevision) {
      // A newer preset superseded this swap while its pipelines compiled.
      disposeMaterial(warmBlend);
      disposeMaterial(warmComposite);
      return;
    }

    this.retiredWarmMaterials = [warmBlend, warmComposite];
    this.feedbackBlendMaterial.outputNode =
      feedbackBlendNode as typeof this.feedbackBlendMaterial.outputNode;
    this.feedbackBlendMaterial.needsUpdate = true;
    this.compositeMaterial.outputNode =
      compositeNode as typeof this.compositeMaterial.outputNode;
    this.compositeMaterial.needsUpdate = true;
  }

  applyCompositeState(state: MilkdropFeedbackCompositeState) {
    const blurShaderRanges = resolveMilkdropBlurShaderRanges(
      state.perPixelVariables,
    );
    if (compositeStateIdentityChanged(this.compositeIdentity, state)) {
      // The bound per-frame registers belong to the outgoing preset's
      // bodies; the rebuild below re-binds whatever the new ones read.
      (
        this.compositeMaterial.uniforms.perFrameVariables as
          | Map<string, unknown>
          | undefined
      )?.clear();
      this.compositeIdentity = {
        shaderExecution: state.shaderExecution,
        warp: state.shaderPrograms.warp,
        comp: state.shaderPrograms.comp,
        perPixelStatements: state.perPixelPrograms?.statements ?? null,
      };
      // MilkDrop rolls rand_preset once per preset load; shader-program
      // changes are a close-enough signal for a fresh draw.
      const randUniform = this.compositeMaterial.uniforms.rand_preset;
      if (
        randUniform &&
        typeof (randUniform.value as Vector4)?.set === 'function'
      ) {
        (randUniform.value as Vector4).set(
          Math.random(),
          Math.random(),
          Math.random(),
          Math.random(),
        );
      }
      const nextFeedbackBlendNode = createFeedbackBlendOutputNode(
        this.feedbackBlendMaterial.uniforms,
        state.shaderPrograms,
        state.perPixelPrograms,
      );
      const nextCompositeNode = createCompositeOutputNode(
        this.compositeMaterial.uniforms,
        state.shaderPrograms,
      );
      const revision = ++this.compositeSwapRevision;
      const renderer = this.lastRenderer as
        | (FeedbackRendererLike & {
            compileAsync?: (
              scene: Scene,
              camera: OrthographicCamera,
            ) => Promise<unknown>;
            getRenderTarget?: () => RenderTarget | null;
          })
        | null;
      // Agent mode (headless captures, labs, e2e) pumps simulation frames
      // synchronously and reads the canvas immediately after a preset apply;
      // a deferred swap would capture the previous preset's styling and trip
      // duplicate-frame guards. Those environments run desktop GPUs where the
      // synchronous pipeline compile is cheap, so they keep the direct path.
      if (renderer?.compileAsync && !isAgentMode()) {
        // Progressive apply, mirroring the WebGL manager: assigning the new
        // output nodes directly makes the next render create their pipelines
        // through the synchronous createRenderPipeline — on mobile drivers
        // (Adreno) that is a multi-second GPU-task stall for shader-heavy
        // presets. Warm the pipelines through compileAsync on throwaway
        // materials first; the live swap then hits the renderer's
        // code-keyed program cache and the driver's pipeline cache.
        void this.warmAndSwapCompositeNodes(
          renderer as FeedbackRendererLike & {
            compileAsync: (
              scene: Scene,
              camera: OrthographicCamera,
            ) => Promise<unknown>;
            getRenderTarget?: () => RenderTarget | null;
          },
          revision,
          nextFeedbackBlendNode,
          nextCompositeNode,
        );
      } else {
        this.feedbackBlendMaterial.outputNode = nextFeedbackBlendNode;
        this.feedbackBlendMaterial.needsUpdate = true;
        this.compositeMaterial.outputNode = nextCompositeNode;
        this.compositeMaterial.needsUpdate = true;
      }
    }

    const needsSceneResolution =
      state.shaderExecution === 'direct' ||
      Math.abs(state.zoom - 1) > 0.0001 ||
      state.videoEchoOrientation !== 0 ||
      state.feedbackTexture > 0.5 ||
      hasOverlayReplaceFeedback(state) ||
      hasOverlayBlendFeedback(state) ||
      hasWarpTextureFeedback(state) ||
      state.brighten > 0.5 ||
      state.darken > 0.5 ||
      state.darkenCenter > 0.5 ||
      state.solarize > 0.5 ||
      state.invert > 0.5 ||
      (state.redBlueStereo ?? 0) > 0.5 ||
      Math.abs(state.gammaAdj - 1) > 0.0001;
    // Several of the inputs above (zoom, brighten, solarize, gammaAdj, …) are
    // per-frame MilkDrop variables that presets animate across the
    // thresholds, and a scale change triggers resize() — a destroy/recreate
    // of every render target. Latch upward immediately (correctness needs
    // the scene-resolution path the frame it's requested) but only release
    // after the condition has been continuously false for a cooldown, so a
    // beat-driven preset can't thrash target reallocation at beat rate.
    if (needsSceneResolution) {
      this.sceneResolutionReleaseCountdown =
        WEBGPU_SCENE_RESOLUTION_RELEASE_FRAMES;
    } else if (this.sceneResolutionReleaseCountdown > 0) {
      this.sceneResolutionReleaseCountdown -= 1;
    }
    const holdSceneResolution =
      needsSceneResolution || this.sceneResolutionReleaseCountdown > 0;
    const nextResolutionScale = holdSceneResolution
      ? this.sceneResolutionScale
      : this.feedbackResolutionScale *
        this.adaptiveFeedbackResolutionMultiplier;
    if (
      Math.abs(nextResolutionScale - this.currentFeedbackResolutionScale) >
      0.0001
    ) {
      this.currentFeedbackResolutionScale = nextResolutionScale;
      this.resize(this.viewportWidth, this.viewportHeight);
    }

    const overlayTextureName = resolveAuxTextureName(
      state.overlayTextureSource,
    );
    const warpTextureName = resolveAuxTextureName(state.warpTextureSource);
    if (overlayTextureName !== this.currentOverlayTextureName) {
      this.currentOverlayTextureName = overlayTextureName;
      if (
        overlayTextureName &&
        !['noise', 'perlin', 'simplex'].includes(overlayTextureName)
      ) {
        this.compositeMaterial.uniforms[`${overlayTextureName}Tex`].value =
          getSharedMilkdropTexture(
            MILKDROP_TEXTURE_FILES[overlayTextureName],
            overlayTextureName === 'aura',
          );
      }
    }
    if (warpTextureName !== this.currentWarpTextureName) {
      this.currentWarpTextureName = warpTextureName;
      if (
        warpTextureName &&
        !['noise', 'perlin', 'simplex'].includes(warpTextureName)
      ) {
        this.compositeMaterial.uniforms[`${warpTextureName}Tex`].value =
          getSharedMilkdropTexture(
            MILKDROP_TEXTURE_FILES[warpTextureName],
            warpTextureName === 'aura',
          );
      }
    }

    this.compositeMaterial.uniforms.mixAlpha.value = state.mixAlpha;
    this.compositeMaterial.uniforms.zoom.value = state.zoom;
    this.compositeMaterial.uniforms.videoEchoOrientation.value =
      state.videoEchoOrientation;
    this.compositeMaterial.uniforms.feedbackTexture.value =
      state.feedbackTexture;
    applyCompositeUniformState(
      this.compositeMaterial.uniforms,
      state,
      blurShaderRanges,
    );
    // Zero for presets that never sample the blur textures: shouldBlur reads
    // this uniform, so the gaussian passes are skipped instead of rasterized
    // into a target nothing samples.
    if (this.compositeMaterial.uniforms.feedbackSoftness) {
      this.compositeMaterial.uniforms.feedbackSoftness.value =
        state.feedbackSoftness;
    }
    const perPixelVariables = state.perPixelVariables;
    for (let vector = 0; vector < 8; vector += 1) {
      const base = vector * 4;
      (this.compositeMaterial.uniforms.perPixelQ[vector].value as Vector4).set(
        perPixelVariables?.[`q${base + 1}`] ?? 0,
        perPixelVariables?.[`q${base + 2}`] ?? 0,
        perPixelVariables?.[`q${base + 3}`] ?? 0,
        perPixelVariables?.[`q${base + 4}`] ?? 0,
      );
      (this.compositeMaterial.uniforms.perPixelT[vector].value as Vector4).set(
        perPixelVariables?.[`t${base + 1}`] ?? 0,
        perPixelVariables?.[`t${base + 2}`] ?? 0,
        perPixelVariables?.[`t${base + 3}`] ?? 0,
        perPixelVariables?.[`t${base + 4}`] ?? 0,
      );
    }
    // Per-frame registers the directly executed bodies read (`tele`,
    // `hordist`, …), bound by the executor on first read. Same source and
    // same zero default as the WebGL path's per-frame uniforms; non-finite
    // values are clamped to 0 for the same reason the warp bases below are.
    const perFrameVariableUniforms = this.compositeMaterial.uniforms
      .perFrameVariables as Map<string, { value: number }> | undefined;
    if (perFrameVariableUniforms) {
      for (const [name, node] of perFrameVariableUniforms) {
        const value = perPixelVariables?.[name];
        node.value =
          typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }
    }
    // Per-frame bases for the warp variables the per-pixel program may
    // overwrite. Read off the same variable bag q/t come from rather than
    // plumbed through MilkdropFeedbackCompositeState, and guarded the way
    // renderer-helpers/feedback-composite.ts guards zoom/rot/dx/dy: the bag is
    // preset-controlled and the warp divides by zoom, so one NaN would take the
    // whole feedback chain to a black frame.
    const readWarpBase = (key: string, fallback: number) => {
      const value = perPixelVariables?.[key];
      return typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;
    };
    const warpCentreScaleUniform =
      this.compositeMaterial.uniforms.warpCenterScale;
    if (
      warpCentreScaleUniform &&
      typeof (warpCentreScaleUniform.value as Vector4)?.set === 'function'
    ) {
      (warpCentreScaleUniform.value as Vector4).set(
        readWarpBase('cx', 0.5),
        readWarpBase('cy', 0.5),
        readWarpBase('sx', 1),
        readWarpBase('sy', 1),
      );
    }
    if (this.compositeMaterial.uniforms.warpZoomExponent) {
      this.compositeMaterial.uniforms.warpZoomExponent.value = readWarpBase(
        'zoomexp',
        1,
      );
    }
    const aspect =
      Number.isFinite(state.aspect) && state.aspect > 0 ? state.aspect : 1;
    const aspectX = aspect < 1 ? aspect : 1;
    const aspectY = aspect > 1 ? 1 / aspect : 1;
    const aspectUniform = this.compositeMaterial.uniforms.aspect;
    if (
      aspectUniform &&
      typeof (aspectUniform.value as Vector4)?.set === 'function'
    ) {
      (aspectUniform.value as Vector4).set(
        aspectX,
        aspectY,
        1 / aspectX,
        1 / aspectY,
      );
    }
  }

  render(renderer: FeedbackRendererLike, scene: Scene, camera: Camera) {
    this.lastRenderer = renderer;
    this.compositeMaterial.uniforms.currentTex.value = this.sceneTarget.texture;

    const softness =
      this.compositeMaterial.uniforms.feedbackSoftness.value ?? 0;
    const shouldBlur = softness > MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD;

    renderSceneIntoFeedbackTarget(
      renderer as FeedbackSceneRenderer,
      scene,
      camera,
      this.sceneTarget,
    );

    if (shouldBlur) {
      const blurTexelSize = this.blurMaterial.uniforms.texelSize.value;
      const sigma = Math.max(0.5, softness * 1.5);
      if (sigma !== this.lastBlurKernelSigma) {
        this.lastBlurKernelSigma = sigma;
        const weights = computeGaussianBlurKernelWeights(sigma);
        this.blurMaterial.uniforms.kernelCenterWeight.value = weights.center;
        (this.blurMaterial.uniforms.kernelSideWeights.value as Vector4).set(
          ...weights.side,
        );
      }
      this.blurMaterial.uniforms.blurPixelStep.value =
        MILKDROP_FEEDBACK_BLUR_OFFSET_BASE +
        softness * MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE;
      this.blurMaterial.uniforms.sourceTex.value = this.readTarget.texture;
      this.blurMaterial.uniforms.blurDirection.value.set(1, 0);
      renderer.setRenderTarget(this.blurTarget);
      renderer.render(this.blurScene, this.camera);

      // Vertical pass writes the softened previous frame back over the read
      // target; the blend pass consumes it and the swap retires it.
      this.blurMaterial.uniforms.sourceTex.value = this.blurTarget.texture;
      this.blurMaterial.uniforms.blurDirection.value.set(0, 1);
      renderer.setRenderTarget(this.readTarget);
      renderer.render(this.blurScene, this.camera);

      this.compositeMaterial.uniforms.texelSize.value.copy(blurTexelSize);
    } else {
      this.compositeMaterial.uniforms.texelSize.value.set(
        1 / Math.max(1, this.readTarget.width),
        1 / Math.max(1, this.readTarget.height),
      );
    }
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;

    // Internal frame (feedback loop): warped previous + fresh geometry.
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.feedbackBlendScene, this.camera);

    // Display frame: comp program + post effects over the internal frame.
    // Never fed back — MilkDrop's comp output is display-only. The display
    // targets ping-pong: the composite samples the retired half as the
    // afterimage history while writing the other.
    this.compositeMaterial.uniforms.internalTex.value =
      this.writeTarget.texture;
    this.compositeMaterial.uniforms.warpTex.value = this.writeTarget.texture;
    // Ping-pong only while the afterimage accumulator is active: alternating
    // the render target and the present's currentTex binding every frame
    // churns bind groups for nothing when the history is never read.
    const afterimageActive =
      (this.compositeMaterial.uniforms.postAfterimageDamp.value as number) >
      0.0001;
    const writeIndex = afterimageActive ? this.displayIndex : 0;
    const displayWrite = this.displayTargets[writeIndex];
    const displayHistory = this.displayTargets[1 - writeIndex];
    this.compositeMaterial.uniforms.displayHistoryTex.value =
      displayHistory.texture;
    renderer.setRenderTarget(displayWrite);
    renderer.render(this.compositeScene, this.camera);
    this.presentMaterial.uniforms.currentTex.value = displayWrite.texture;
    if (afterimageActive) {
      this.displayIndex = 1 - this.displayIndex;
    }

    // The WebGL feedback path presents through toneMapped=false
    // ShaderMaterials, so its output is never ACES-tone-mapped and never gets
    // an output color-space encode (raw ShaderMaterials skip the
    // colorspace_fragment chunk). The WebGPU common renderer applies BOTH to
    // every output-target render regardless of material flags — the
    // linear→sRGB encode alone lifted geiss-game-of-life from ~14 to ~49
    // mean luminance vs WebGL. Suspend tone mapping AND the output
    // color-space transform around the present to match WebGL's luminance.
    renderWithoutOutputConversion(
      renderer as FeedbackRendererLike & OutputConversionRenderer,
      () => {
        renderer.setRenderTarget(null);
        renderer.render(this.presentScene, this.camera);
      },
    );
    this.swap();
    return true;
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
    this.targets.forEach((target) =>
      target.setSize(feedbackWidth, feedbackHeight),
    );
    this.displayTargets.forEach((target) =>
      target.setSize(feedbackWidth, feedbackHeight),
    );
    this.blurTarget.setSize(feedbackWidth, feedbackHeight);
    this.compositeMaterial.uniforms.blur1Tex.value = this.blurTarget.texture;
    this.compositeMaterial.uniforms.blur2Tex.value = this.blurTarget.texture;
    this.compositeMaterial.uniforms.blur3Tex.value = this.blurTarget.texture;
    for (const target of this.savedFrameTargets) {
      target?.setSize(feedbackWidth, feedbackHeight);
    }
    this.compositeMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
    this.blurMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
    // Feedback-target size, not viewport — see the constructor note on
    // one-texel neighbor taps.
    this.compositeMaterial.uniforms.texsize.value.set(
      feedbackWidth,
      feedbackHeight,
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
  }

  dispose() {
    // Invalidate any in-flight pipeline warm-up so it cannot swap nodes onto
    // disposed materials.
    this.compositeSwapRevision += 1;
    for (const material of this.retiredWarmMaterials) {
      disposeMaterial(material);
    }
    this.retiredWarmMaterials = [];
    if (
      this.adaptiveResizeFrameId !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.adaptiveResizeFrameId);
      this.adaptiveResizeFrameId = null;
    }
    this.sceneTarget.dispose();
    this.targets.forEach((target) => target.dispose());
    this.displayTargets.forEach((target) => target.dispose());
    this.blurTarget.dispose();
    for (const target of this.savedFrameTargets) {
      target?.dispose();
    }
    this.savedFrameTargets = [null, null];
    disposeMaterial(this.compositeMaterial);
    disposeMaterial(this.feedbackBlendMaterial);
    disposeMaterial(this.presentMaterial);
    disposeMaterial(this.blurMaterial);
    this.compositeScene.clear();
    this.feedbackBlendScene.clear();
    this.presentScene.clear();
    this.blurScene.clear();
  }
}

export function createMilkdropWebGPUFeedbackManager(
  width: number,
  height: number,
) {
  return new WebGPUMilkdropFeedbackManager(
    width,
    height,
    getFeedbackBackendProfile('webgpu', { mobile: isMobileDevice() }),
  );
}
