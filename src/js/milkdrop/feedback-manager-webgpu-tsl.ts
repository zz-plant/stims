// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import type { Camera, Texture } from 'three';
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  type Vector4,
} from 'three';
// @ts-expect-error - 'three/webgpu' requires moduleResolution: "bundler" or "nodenext", but project uses "node".
import { NodeMaterial, type RenderTarget, TSL } from 'three/webgpu';
import { disposeMaterial } from '../utils/three/three-dispose';
import { MilkdropFeedbackManagerLifecycleBase } from './feedback-manager-lifecycle.ts';
import {
  applyCompositeUniformState,
  resolveMilkdropBlurShaderRanges,
} from './feedback-manager-shared.ts';
import {
  type CompositeUniformBag,
  createApplyFeedbackWarpNode,
  createCompositeUniforms,
  createFeedbackRenderTarget,
  createSampleAuxTextureNode,
  createSampleUvNode,
  type FeedbackRendererLike,
  getShared3dAuxTexture,
  getSharedMilkdropAuxTextures,
  getSharedMilkdropTexture,
  hasOverlayBlendFeedback,
  hasOverlayReplaceFeedback,
  hasWarpTextureFeedback,
  MILKDROP_TEXTURE_FILES,
  resolveAuxTextureName,
} from './feedback-manager-webgpu-composite.ts';

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
    kernelSigma: uniform(1),
    blurPixelStep: uniform(1),
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
    const twoSigmaSq = blurUniforms.kernelSigma
      .mul(blurUniforms.kernelSigma)
      .mul(2);
    let weightedColor = vec4(0, 0, 0, 0);
    let weightSum = float(0);

    for (
      let tap = -GAUSSIAN_BLUR_KERNEL_RADIUS;
      tap <= GAUSSIAN_BLUR_KERNEL_RADIUS;
      tap += 1
    ) {
      const tapFloat = float(tap);
      const i2 = tapFloat.mul(tapFloat);
      const exponent = float(0).sub(i2).div(max(twoSigmaSq, 0.0001));
      const weight = exp(exponent);
      const sampleUv = centerUv.add(offset.mul(tapFloat));
      weightedColor = weightedColor.add(
        blurUniforms.sourceTex.sample(sampleUv).mul(weight),
      );
      weightSum = weightSum.add(weight);
    }

    return weightedColor.div(max(weightSum, 0.0001));
  })();
}

function createPresentUniforms(initialSource: Texture) {
  return {
    currentTex: texture(initialSource),
    savedTex: texture(initialSource),
    transitionAlpha: uniform(0),
    patternAspect: uniform(16 / 9),
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
  const valueNoise = (p: any) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
    const a = hash21(i);
    const b = hash21(i.add(vec2(1.0, 0.0)));
    const c = hash21(i.add(vec2(0.0, 1.0)));
    const d = hash21(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  };
  const { coarseScale, fineScale, coarseWeight, fineOffset, band } =
    MILKDROP_BLEND_DISSOLVE;
  return Fn(() => {
    const current = uniforms.currentTex.sample(uv());
    const result = vec4(current).toVar();
    const linearA = clamp(uniforms.transitionAlpha, 0, 1);
    // Uniform branch mirroring the WebGL shader's early-out: the present
    // pass runs full-screen every frame, so outside a preset transition the
    // GPU must skip the dissolve math entirely (transitionAlpha is a
    // uniform, so this is uniform control flow and genuinely branches).
    If(linearA.greaterThan(0.001), () => {
      const saved = uniforms.savedTex.sample(uv());
      // Ease the global progression so the wipe starts and ends gently
      // instead of snapping into motion off the linear alpha ramp.
      const a = smoothstep(0.0, 1.0, linearA);
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

type ShaderNodeEnv = {
  values: Map<string, ShaderNodeValue>;
  uniforms: CompositeUniformBag;
  sampleUvNode: ReturnType<typeof createSampleUvNode>;
  sampleAuxTextureNode: ReturnType<typeof createSampleAuxTextureNode>;
  /** Stage-specific meaning of sampler_main. The comp stage sets this to the
   * reconstructed composited frame (feedback + geometry); without it, main
   * samples fall back to the geometry-only scene texture. */
  sampleMainNode?: (uvNode: any) => any;
};

type DirectShaderSwizzleComponent = 'x' | 'y' | 'z' | 'w';

function hueRotateNode(colorValue: any, angle: any) {
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

function createModNode(left: any, right: any) {
  return left.sub(floor(left.div(max(abs(right), 0.000001))).mul(right));
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
      return shaderValueFromNode(lhs.div(max(abs(rhs), 0.000001)), kind);
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

function getShaderEnvValue(
  env: ShaderNodeEnv,
  key: string,
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
    // _qa.._qh vec4 uniforms (#define q1 _qa.x …). Provide the same vec4s from
    // the per-pixel q register array so statements swizzling _qb.xy etc. don't
    // drop.
    _qa: () =>
      shaderVec4(
        env.uniforms.perPixelQ[0],
        env.uniforms.perPixelQ[1],
        env.uniforms.perPixelQ[2],
        env.uniforms.perPixelQ[3],
      ),
    _qb: () =>
      shaderVec4(
        env.uniforms.perPixelQ[4],
        env.uniforms.perPixelQ[5],
        env.uniforms.perPixelQ[6],
        env.uniforms.perPixelQ[7],
      ),
    _qc: () =>
      shaderVec4(
        env.uniforms.perPixelQ[8],
        env.uniforms.perPixelQ[9],
        env.uniforms.perPixelQ[10],
        env.uniforms.perPixelQ[11],
      ),
    _qd: () =>
      shaderVec4(
        env.uniforms.perPixelQ[12],
        env.uniforms.perPixelQ[13],
        env.uniforms.perPixelQ[14],
        env.uniforms.perPixelQ[15],
      ),
    _qe: () =>
      shaderVec4(
        env.uniforms.perPixelQ[16],
        env.uniforms.perPixelQ[17],
        env.uniforms.perPixelQ[18],
        env.uniforms.perPixelQ[19],
      ),
    _qf: () =>
      shaderVec4(
        env.uniforms.perPixelQ[20],
        env.uniforms.perPixelQ[21],
        env.uniforms.perPixelQ[22],
        env.uniforms.perPixelQ[23],
      ),
    _qg: () =>
      shaderVec4(
        env.uniforms.perPixelQ[24],
        env.uniforms.perPixelQ[25],
        env.uniforms.perPixelQ[26],
        env.uniforms.perPixelQ[27],
      ),
    _qh: () =>
      shaderVec4(
        env.uniforms.perPixelQ[28],
        env.uniforms.perPixelQ[29],
        env.uniforms.perPixelQ[30],
        env.uniforms.perPixelQ[31],
      ),
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
  const resolved =
    registerUniforms && registerIndex >= 0
      ? shaderFloat(registerUniforms[registerIndex])
      : (uniformMap[normalized]?.() ?? null);
  if (resolved) {
    env.values.set(normalized, resolved);
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
      if (node.index?.type !== 'literal') {
        return null;
      }
      const index = Number(node.index.value);
      if (!Number.isInteger(index) || index < 0 || index > 1) {
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
        const resolvedBinding = resolveDirectShaderSamplerBinding(
          sourceName,
          explicitVolumeSample || inferredVolumeSample ? '3d' : '2d',
        );
        if (!resolvedBinding) {
          return null;
        }
        const sampleDimension =
          explicitVolumeSample || inferredVolumeSample ? float(1) : float(0);
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
          env.sampleAuxTextureNode(
            float(resolvedBinding.sourceId),
            sampleDimension,
            sampleUv,
            sampleZ,
          ).rgb,
        );
      }
      if (name === 'samplenoisevolume' && args.length >= 1) {
        // Native bodies rewrite texture(sampler_noisevol*, vec3) to the
        // sampleNoiseVolume helper; mirror the GLSL atlas-slice emulation by
        // routing through the simplex volume slot (source 2, dimension 1).
        const coordinate = args[0];
        const sampleUv =
          coordinate.kind === 'vec3'
            ? vec2(coordinate.node.x, coordinate.node.y)
            : coerceShaderValue(coordinate, 'vec2').node;
        const sampleZ =
          coordinate.kind === 'vec3' ? coordinate.node.z : float(0);
        return makeShaderValue(
          'vec3',
          env.sampleAuxTextureNode(float(2), float(1), sampleUv, sampleZ).rgb,
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
        const sampleUv = env.sampleUvNode(coordUv, env.uniforms.textureWrap);
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
  const baseValue = getShaderEnvValue(env, baseKey);
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
    const matrixValue = getShaderEnvValue(env, matrixName);
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

function runShaderProgram(
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
  statements.forEach((statement) => {
    const value = compileShaderExpressionNode(statement.expression, env);
    if (value) {
      setShaderEnvValue(env, statement.target, value);
    }
  });
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

function createCompositeAuxSampler(uniforms: CompositeUniformBag) {
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
    },
  );
}

/**
 * Builds this frame's internal image — the warped previous frame with fresh
 * geometry blended on top — which is what feeds the next frame's warp.
 * MilkDrop never feeds the comp stage's output back into the loop, so the
 * comp program, color adjustments, and post chain all live in the
 * display-only composite node instead.
 */
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
  const applyVideoEchoOrientationNode = Fn(
    ([sampleUv, orientation]: [any, any]) => {
      const flipX = step(
        0.5,
        orientation.sub(floor(orientation.div(2)).mul(2)),
      );
      const flipY = step(
        1.5,
        orientation.sub(floor(orientation.div(4)).mul(4)),
      );
      return vec2(
        mix(sampleUv.x, float(1).sub(sampleUv.x), flipX),
        mix(sampleUv.y, float(1).sub(sampleUv.y), flipY),
      );
    },
  );
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
    setShaderEnvValue(perPixelEnv, 'x', shaderFloat(baseUv.x));
    setShaderEnvValue(perPixelEnv, 'y', shaderFloat(baseUv.y));
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
    const rotatedUv = vec2(
      centeredUv.x.mul(rotationCos).sub(centeredUv.y.mul(rotationSin)),
      centeredUv.x.mul(rotationSin).add(centeredUv.y.mul(rotationCos)),
    );
    const transformedUv = rotatedUv
      .div(max(activeZoom, 0.0001))
      .add(vec2(activeOffsetX, activeOffsetY));

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
    const warpUv = currentUv
      .mul(uniforms.warpTextureScale)
      .add(uniforms.warpTextureOffset);
    const warpVector = sampleAuxTextureNode(
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
    previousUv.assign(
      applyVideoEchoOrientationNode(previousUv, uniforms.videoEchoOrientation),
    );

    const current = uniforms.currentTex.sample(
      sampleUvNode(currentUv, uniforms.textureWrap),
    );
    const previous = uniforms.previousTex.sample(
      sampleUvNode(previousUv, uniforms.textureWrap),
    );
    const previousColor = previous.rgb.mul(uniforms.decay);

    // Internal frame: warped decayed feedback under this frame's geometry —
    // additive when the preset warps via its own shader, legacy echo blend
    // otherwise.
    const color = mix(
      current.rgb,
      previousColor,
      clamp(uniforms.videoEchoAlpha, 0, 1),
    );

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

    const rawPreviousColor = uniforms.previousTex
      .sample(sampleUvNode(baseUv, uniforms.textureWrap))
      .rgb.toVar();
    const color = sampleMainNode(baseUv).toVar();

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
    const overlayUv = baseUv
      .mul(uniforms.overlayTextureScale)
      .add(uniforms.overlayTextureOffset);
    const overlaySample = sampleAuxTextureNode(
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

    // Brighten
    const brightenMask = max(
      step(0.01, uniforms.brighten),
      step(0.01, uniforms.brightenBoost),
    );
    const brightened = min(
      vec3(1),
      mix(
        color,
        color.mul(float(1.18).add(uniforms.brightenBoost.mul(0.35))),
        clamp(max(uniforms.brighten, uniforms.brightenBoost), 0, 1),
      ),
    );
    color.assign(mix(color, brightened, brightenMask));

    // Darken
    color.assign(mix(color, color.mul(0.82), step(0.5, uniforms.darken)));

    // Solarize
    color.assign(
      mix(
        color,
        abs(color.sub(0.5)).mul(2.0),
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
    const chromaR = uniforms.internalTex.sample(baseUv.add(chromaDir)).r;
    const chromaB = uniforms.internalTex.sample(baseUv.sub(chromaDir)).b;
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

    // Gamma correction (always applied last)
    const gammaAdjusted = pow(
      max(color, vec3(0)),
      vec3(float(1).div(max(uniforms.gammaAdj, 0.0001))),
    );
    color.assign(gammaAdjusted);

    // Post-processing pass (WebGPU full-path equivalents of WebGL passes)
    color.assign(applyPostBloomNode(uniforms)(color));
    color.assign(applyPostChromaticAberrationNode(uniforms)(color));
    color.assign(applyPostFilmGrainNode(uniforms)(color));
    color.assign(applyPostAfterimageNode(uniforms, rawPreviousColor)(color));

    return vec4(max(color, vec3(0)), 1);
  })();
}

function applyPostBloomNode(uniforms: CompositeUniformBag) {
  return Fn(([baseColor]: [any]) => {
    const sampleUv = uv();
    const strength = uniforms.postBloomStrength;
    const enabled = step(0.0001, strength);
    const outColor = baseColor.toVar();

    If(enabled, () => {
      const radius = max(uniforms.postBloomRadius, 0.0001);
      const texel = uniforms.texelSize.mul(radius);
      const threshold = uniforms.postBloomThreshold;

      const top = uniforms.internalTex.sample(
        clamp(sampleUv.add(vec2(0, texel.y)), vec2(0), vec2(1)),
      ).rgb;
      const bottom = uniforms.internalTex.sample(
        clamp(sampleUv.sub(vec2(0, texel.y)), vec2(0), vec2(1)),
      ).rgb;
      const left = uniforms.internalTex.sample(
        clamp(sampleUv.sub(vec2(texel.x, 0)), vec2(0), vec2(1)),
      ).rgb;
      const right = uniforms.internalTex.sample(
        clamp(sampleUv.add(vec2(texel.x, 0)), vec2(0), vec2(1)),
      ).rgb;

      const blurred = top.add(bottom).add(left).add(right).div(4);
      const lum = dot(blurred, vec3(0.299, 0.587, 0.114));
      const bloomMask = smoothstep(
        threshold.sub(0.05),
        threshold.add(0.05),
        lum,
      );
      const bloom = blurred.mul(strength).mul(bloomMask);
      outColor.assign(baseColor.add(bloom));
    });

    return outColor;
  });
}

function applyPostChromaticAberrationNode(uniforms: CompositeUniformBag) {
  return Fn(([baseColor]: [any]) => {
    const sampleUv = uv();
    const enabled = step(0.0001, uniforms.postChromaticAberration);
    const outColor = baseColor.toVar();

    If(enabled, () => {
      const centered = sampleUv.sub(0.5);
      const offset = centered
        .mul(uniforms.postChromaticAberration)
        .mul(vec2(uniforms.texsize.z, uniforms.texsize.w));
      const clampedPlus = clamp(sampleUv.add(offset), vec2(0), vec2(1));
      const clampedMinus = clamp(sampleUv.sub(offset), vec2(0), vec2(1));
      const red = uniforms.internalTex.sample(clampedPlus).r;
      const blue = uniforms.internalTex.sample(clampedMinus).b;
      outColor.assign(vec3(red, baseColor.g, blue));
    });

    return outColor;
  });
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
      const grain = hashed.mul(2).sub(1).mul(amount);
      outColor.assign(baseColor.add(grain));
    });

    return outColor;
  });
}

function applyPostAfterimageNode(
  uniforms: CompositeUniformBag,
  rawPreviousColor: any,
) {
  return Fn(([baseColor]: [any]) => {
    const damp = clamp(uniforms.postAfterimageDamp, 0, 1);
    return mix(baseColor, rawPreviousColor, damp);
  });
}

function buildCompositeStateKey(state: MilkdropFeedbackCompositeState) {
  return [
    state.shaderExecution,
    state.shaderPrograms.warp?.source ?? '',
    state.shaderPrograms.comp?.source ?? '',
    state.perPixelPrograms?.statements
      .map((statement) => statement.source)
      .join('\u001e') ?? '',
  ].join('\u001f');
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
  readonly displayTarget: RenderTarget;
  readonly blurTarget: RenderTarget;
  readonly blurScene = new Scene();
  readonly profile: FeedbackBackendProfile;
  readonly auxTextures: Record<string, Texture>;
  currentCompositeKey = '';
  currentOverlayTextureName: keyof typeof MILKDROP_TEXTURE_FILES | null = null;
  currentWarpTextureName: keyof typeof MILKDROP_TEXTURE_FILES | null = null;
  private savedFrameTarget: RenderTarget | null = null;
  private lastRenderer: FeedbackRendererLike | null = null;

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
    this.displayTarget = createFeedbackRenderTarget(
      width,
      height,
      this.feedbackResolutionScale,
    );
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
    uniforms.texsize.value.set(
      width,
      height,
      1 / Math.max(1, width),
      1 / Math.max(1, height),
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

    const presentUniforms = createPresentUniforms(this.displayTarget.texture);
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

  swap() {
    this.index = (this.index + 1) % 2;
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;
  }

  saveCurrentFrame(): void {
    if (!this.savedFrameTarget) {
      this.savedFrameTarget = createFeedbackRenderTarget(
        this.viewportWidth,
        this.viewportHeight,
        this.currentFeedbackResolutionScale,
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

  applyPostprocessingProfile(
    profile: MilkdropPostprocessingProfile | null | undefined,
  ) {
    const uniforms = this.compositeMaterial.uniforms;
    const enabled = Boolean(profile?.enabled);
    uniforms.postBloomStrength.value = enabled
      ? (profile?.bloomStrength ?? 0)
      : 0;
    uniforms.postBloomThreshold.value = profile?.bloomThreshold ?? 0.85;
    uniforms.postBloomRadius.value = profile?.bloomRadius ?? 0.5;
    uniforms.postFilmGrainAmount.value = enabled
      ? (profile?.filmNoise ?? 0)
      : 0;
    uniforms.postChromaticAberration.value = enabled
      ? (profile?.chromaOffset ?? 0)
      : 0;
    uniforms.postAfterimageDamp.value = enabled
      ? (profile?.afterimageDamp ?? 0)
      : 0;
  }

  applyCompositeState(state: MilkdropFeedbackCompositeState) {
    const blurShaderRanges = resolveMilkdropBlurShaderRanges(
      state.perPixelVariables,
    );
    const nextCompositeKey = buildCompositeStateKey(state);
    if (nextCompositeKey !== this.currentCompositeKey) {
      this.currentCompositeKey = nextCompositeKey;
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
      this.feedbackBlendMaterial.outputNode = createFeedbackBlendOutputNode(
        this.feedbackBlendMaterial.uniforms,
        state.shaderPrograms,
        state.perPixelPrograms,
      );
      this.feedbackBlendMaterial.needsUpdate = true;
      this.compositeMaterial.outputNode = createCompositeOutputNode(
        this.compositeMaterial.uniforms,
        state.shaderPrograms,
      );
      this.compositeMaterial.needsUpdate = true;
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
    const nextResolutionScale = needsSceneResolution
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
    for (let index = 0; index < 32; index += 1) {
      this.compositeMaterial.uniforms.perPixelQ[index].value =
        state.perPixelVariables?.[`q${index + 1}`] ?? 0;
      this.compositeMaterial.uniforms.perPixelT[index].value =
        state.perPixelVariables?.[`t${index + 1}`] ?? 0;
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

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    if (shouldBlur) {
      const blurTexelSize = this.blurMaterial.uniforms.texelSize.value;
      this.blurMaterial.uniforms.kernelSigma.value = Math.max(
        0.5,
        softness * 1.5,
      );
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
    // Never fed back — MilkDrop's comp output is display-only.
    this.compositeMaterial.uniforms.internalTex.value =
      this.writeTarget.texture;
    this.compositeMaterial.uniforms.warpTex.value = this.writeTarget.texture;
    renderer.setRenderTarget(this.displayTarget);
    renderer.render(this.compositeScene, this.camera);

    // The WebGL feedback path presents through toneMapped=false
    // ShaderMaterials, so its output is never ACES-tone-mapped. The WebGPU
    // common renderer tone-maps every output-target render regardless of the
    // material flag, so suspend the renderer's tone mapping around the present
    // to match WebGL's luminance (ACES would brighten the frame).
    const toneMappedRenderer = renderer as FeedbackRendererLike & {
      toneMapping?: number;
    };
    const savedToneMapping = toneMappedRenderer.toneMapping ?? 0;
    if (savedToneMapping !== 0) {
      toneMappedRenderer.toneMapping = 0;
    }
    renderer.setRenderTarget(null);
    renderer.render(this.presentScene, this.camera);
    if (savedToneMapping !== 0) {
      toneMappedRenderer.toneMapping = savedToneMapping;
    }
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
    this.displayTarget.setSize(feedbackWidth, feedbackHeight);
    this.blurTarget.setSize(feedbackWidth, feedbackHeight);
    this.compositeMaterial.uniforms.blur1Tex.value = this.blurTarget.texture;
    this.compositeMaterial.uniforms.blur2Tex.value = this.blurTarget.texture;
    this.compositeMaterial.uniforms.blur3Tex.value = this.blurTarget.texture;
    if (this.savedFrameTarget) {
      this.savedFrameTarget.setSize(feedbackWidth, feedbackHeight);
    }
    this.compositeMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
    this.blurMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
    this.compositeMaterial.uniforms.texsize.value.set(
      width,
      height,
      1 / Math.max(1, width),
      1 / Math.max(1, height),
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
    this.targets.forEach((target) => target.dispose());
    this.displayTarget.dispose();
    this.blurTarget.dispose();
    this.savedFrameTarget?.dispose();
    this.savedFrameTarget = null;
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
