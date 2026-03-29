// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import type { Camera, Texture } from 'three';
import {
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';
// @ts-expect-error - 'three/tsl' requires moduleResolution: "bundler" or "nodenext", but project uses "node".
import { NodeMaterial, RenderTarget, TSL } from 'three/webgpu';
import { disposeMaterial } from '../utils/three-dispose';
import {
  MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  MILKDROP_FEEDBACK_BLUR_BLEND_SCALE,
  MILKDROP_FEEDBACK_BLUR_OFFSET_BASE,
  MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE,
  MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
  MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD,
} from './feedback-composite-profile.ts';
import {
  AUX_TEXTURE_ATLAS_GRID_SIZE,
  AUX_TEXTURE_ATLAS_SLICE_COUNT,
} from './feedback-volume-sampling.ts';
import { WEBGPU_MILKDROP_BACKEND_BEHAVIOR } from './renderer-adapter.ts';
import {
  isMilkdropVolumeShaderSamplerName,
  normalizeMilkdropShaderSamplerName,
} from './shader-samplers.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropShaderExpressionNode,
  MilkdropShaderProgramPayload,
  MilkdropShaderStatement,
  MilkdropShaderTextureSampler,
} from './types';

const {
  abs,
  atan,
  clamp,
  cos,
  dot,
  Fn,
  floor,
  float,
  fract,
  If,
  length,
  mat3,
  max,
  min,
  mix,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

const FULLSCREEN_QUAD_GEOMETRY = new PlaneGeometry(2, 2);
const MILKDROP_TEXTURE_FILES = {
  noise: 'seamless_perlin_noise.png',
  simplex: 'simplex_noise_3d.png',
  voronoi: 'voronoi_cellular.png',
  aura: 'colorful_aura_gradient.png',
  caustics: 'water_caustics.png',
  pattern: 'circuit_board_pattern.png',
  fractal: 'crystal_fractal.png',
} as const;
type FeedbackRendererLike = {
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget: (target: RenderTarget | null) => void;
};

type CompositeUniformBag = Record<string, any>;

function resolveTextureUrl(fileName: string) {
  const baseUrl =
    typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : '/';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}textures/${fileName}`;
}

function configureMilkdropTexture(textureValue: Texture, colorTexture = false) {
  textureValue.wrapS = RepeatWrapping;
  textureValue.wrapT = RepeatWrapping;
  if (colorTexture) {
    textureValue.colorSpace = SRGBColorSpace;
  }
  return textureValue;
}

function loadMilkdropTexture(fileName: string, colorTexture = false) {
  const loaded = new TextureLoader().load(resolveTextureUrl(fileName));
  return configureMilkdropTexture(loaded, colorTexture);
}

function createFeedbackRenderTarget(
  width: number,
  height: number,
  resolutionScale: number,
) {
  const profile = WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile;
  const scaledWidth = Math.max(1, Math.round(width * resolutionScale));
  const scaledHeight = Math.max(1, Math.round(height * resolutionScale));
  const target = new RenderTarget(scaledWidth, scaledHeight, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    type: WEBGPU_MILKDROP_BACKEND_BEHAVIOR.useHalfFloatFeedback
      ? HalfFloatType
      : undefined,
  });
  target.samples = profile.samples;
  return target;
}

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

function createSampleUvNode() {
  return Fn(([rawUv, wrapMode]: [any, any]) => {
    const clampedUv = clamp(rawUv, vec2(0), vec2(1));
    const wrappedUv = fract(rawUv);
    return mix(clampedUv, wrappedUv, step(0.5, wrapMode));
  });
}

function createApplyFeedbackWarpNode() {
  return Fn(([sampleUv, amount, rotationAmount]: [any, any, any]) => {
    const centered = sampleUv.sub(0.5);
    const radius = length(centered);
    const angle = atan(centered.y, centered.x);
    const spiral = sin(radius.mul(18).sub(angle.mul(4)))
      .mul(amount)
      .mul(0.08);
    const warpedAngle = angle.add(spiral).add(rotationAmount.mul(0.22));
    const warpedRadius = radius.mul(
      float(1).add(
        cos(warpedAngle.mul(3).add(radius.mul(10)))
          .mul(amount)
          .mul(0.05),
      ),
    );
    return vec2(cos(warpedAngle), sin(warpedAngle)).mul(warpedRadius).add(0.5);
  });
}

function createSampleAuxTextureNode(
  _uniforms: CompositeUniformBag,
  noiseTexNode: ReturnType<typeof texture>,
  simplexTexNode: ReturnType<typeof texture>,
  voronoiTexNode: ReturnType<typeof texture>,
  auraTexNode: ReturnType<typeof texture>,
  causticsTexNode: ReturnType<typeof texture>,
  patternTexNode: ReturnType<typeof texture>,
  fractalTexNode: ReturnType<typeof texture>,
) {
  const sampleAuxTexture2dNode = Fn(([source, sampleUv]: [any, any]) => {
    const flat = vec4(0.5, 0.5, 0.5, 1);
    return select(
      source.lessThan(0.5),
      flat,
      select(
        source.lessThan(1.5),
        noiseTexNode.sample(sampleUv),
        select(
          source.lessThan(2.5),
          simplexTexNode.sample(sampleUv),
          select(
            source.lessThan(3.5),
            voronoiTexNode.sample(sampleUv),
            select(
              source.lessThan(4.5),
              auraTexNode.sample(sampleUv),
              select(
                source.lessThan(5.5),
                causticsTexNode.sample(sampleUv),
                select(
                  source.lessThan(6.5),
                  patternTexNode.sample(sampleUv),
                  fractalTexNode.sample(sampleUv),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  });

  const atlasSliceUvNode = Fn(([sampleUv, sliceIndex]: [any, any]) => {
    const localUv = mix(vec2(0.01), vec2(0.99), fract(sampleUv));
    const gridSize = float(AUX_TEXTURE_ATLAS_GRID_SIZE);
    const tileSize = vec2(float(1).div(gridSize));
    const row = floor(sliceIndex.div(gridSize));
    const column = sliceIndex.sub(row.mul(gridSize));
    return vec2(column, row).add(localUv).mul(tileSize);
  });

  return Fn(
    ([source, sampleDimension, sampleUv, sliceZ]: [any, any, any, any]) => {
      const wrappedUv = fract(sampleUv);
      const sliceCount = float(AUX_TEXTURE_ATLAS_SLICE_COUNT);
      // Keep tex3D phases fully periodic so modulo-equivalent values stay aligned while the
      // last atlas segment blends the final slice back to slice 0.
      const wrappedSliceZ = fract(sliceZ);
      const scaledSlice = wrappedSliceZ.mul(sliceCount);
      const sliceIndexA = fract(floor(scaledSlice).div(sliceCount)).mul(
        sliceCount,
      );
      const sliceIndexB = fract(sliceIndexA.add(1).div(sliceCount)).mul(
        sliceCount,
      );
      const sliceBlend = fract(scaledSlice);
      const planarSample = sampleAuxTexture2dNode(source, wrappedUv);
      const sliceA = sampleAuxTexture2dNode(
        source,
        atlasSliceUvNode(wrappedUv, sliceIndexA),
      );
      const sliceB = sampleAuxTexture2dNode(
        source,
        atlasSliceUvNode(wrappedUv, sliceIndexB),
      );
      return mix(
        planarSample,
        mix(sliceA, sliceB, sliceBlend),
        step(0.5, sampleDimension),
      );
    },
  );
}

function createCompositeUniforms(
  sceneTexture: Texture,
  previousTexture: Texture,
  auxTextures: Record<string, Texture>,
) {
  return {
    currentTex: texture(sceneTexture),
    previousTex: texture(previousTexture),
    noiseTex: texture(auxTextures.noise),
    simplexTex: texture(auxTextures.simplex),
    voronoiTex: texture(auxTextures.voronoi),
    auraTex: texture(auxTextures.aura),
    causticsTex: texture(auxTextures.caustics),
    patternTex: texture(auxTextures.pattern),
    fractalTex: texture(auxTextures.fractal),
    mixAlpha: uniform(0.18),
    videoEchoAlpha: uniform(0),
    zoom: uniform(1.02),
    videoEchoOrientation: uniform(0),
    brighten: uniform(0),
    darken: uniform(0),
    darkenCenter: uniform(0),
    solarize: uniform(0),
    invert: uniform(0),
    redBlueStereo: uniform(0),
    gammaAdj: uniform(1),
    textureWrap: uniform(0),
    feedbackTexture: uniform(0),
    warpScale: uniform(0),
    offsetX: uniform(0),
    offsetY: uniform(0),
    rotation: uniform(0),
    zoomMul: uniform(1),
    saturation: uniform(1),
    contrast: uniform(1),
    colorScale: uniform(new Color(1, 1, 1)),
    hueShift: uniform(0),
    brightenBoost: uniform(0),
    invertBoost: uniform(0),
    solarizeBoost: uniform(0),
    tint: uniform(new Color(1, 1, 1)),
    feedbackSoftness: uniform(
      WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile.feedbackSoftness,
    ),
    currentFrameBoost: uniform(
      WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile.currentFrameBoost,
    ),
    overlayTextureSource: uniform(0),
    overlayTextureMode: uniform(0),
    overlayTextureSampleDimension: uniform(0),
    overlayTextureInvert: uniform(0),
    overlayTextureAmount: uniform(0),
    overlayTextureScale: uniform(new Vector2(1, 1)),
    overlayTextureOffset: uniform(new Vector2(0, 0)),
    overlayTextureVolumeSliceZ: uniform(0),
    warpTextureSource: uniform(0),
    warpTextureSampleDimension: uniform(0),
    warpTextureAmount: uniform(0),
    warpTextureScale: uniform(new Vector2(1, 1)),
    warpTextureOffset: uniform(new Vector2(0, 0)),
    warpTextureVolumeSliceZ: uniform(0),
    signalBass: uniform(0),
    signalMid: uniform(0),
    signalTreb: uniform(0),
    signalBeat: uniform(0),
    signalEnergy: uniform(0),
    signalTime: uniform(0),
    texelSize: uniform(new Vector2(1, 1)),
  } satisfies CompositeUniformBag;
}

type ShaderNodeValue = {
  kind: 'scalar' | 'vec2' | 'vec3';
  node: any;
};

type ShaderBinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||';

type ShaderNodeEnv = {
  values: Map<string, ShaderNodeValue>;
  uniforms: CompositeUniformBag;
  sampleUvNode: ReturnType<typeof createSampleUvNode>;
  sampleAuxTextureNode: ReturnType<typeof createSampleAuxTextureNode>;
};

type DirectShaderSwizzleComponent = 'x' | 'y' | 'z';

export type DirectShaderSwizzleSpec = {
  kind: ShaderNodeValue['kind'];
  components: DirectShaderSwizzleComponent[];
};

export type DirectShaderSamplerBinding = {
  canonicalSource: MilkdropShaderTextureSampler | 'main';
  sourceId: number;
};

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

function shaderValueFromNode(node: any, kind: ShaderNodeValue['kind']) {
  if (kind === 'scalar') {
    return shaderFloat(node);
  }
  if (kind === 'vec2') {
    return makeShaderValue('vec2', node);
  }
  return makeShaderValue('vec3', node);
}

function getDirectShaderSamplerSourceId(
  canonicalSource: MilkdropShaderTextureSampler | 'main',
) {
  switch (canonicalSource) {
    case 'main':
      return 0;
    case 'noise':
    case 'perlin':
      return 1;
    case 'simplex':
      return 2;
    case 'voronoi':
      return 3;
    case 'aura':
      return 4;
    case 'caustics':
      return 5;
    case 'pattern':
      return 6;
    case 'fractal':
      return 7;
    default:
      return 0;
  }
}

export function resolveDirectShaderSamplerBinding(
  sourceName: string,
  sampleDimension: '2d' | '3d',
): DirectShaderSamplerBinding | null {
  const canonicalSource = normalizeMilkdropShaderSamplerName(sourceName);
  if (!canonicalSource) {
    return null;
  }
  if (
    sampleDimension === '3d' &&
    (canonicalSource === 'main' ||
      !isMilkdropVolumeShaderSamplerName(canonicalSource))
  ) {
    return null;
  }
  return {
    canonicalSource,
    sourceId: getDirectShaderSamplerSourceId(canonicalSource),
  };
}

export function resolveDirectShaderSwizzle(
  kind: Exclude<ShaderNodeValue['kind'], 'scalar'>,
  property: string,
): DirectShaderSwizzleSpec | null {
  const normalized = property.toLowerCase();
  const componentMap =
    kind === 'vec2'
      ? ({
          x: 'x',
          y: 'y',
          r: 'x',
          g: 'y',
        } satisfies Record<string, DirectShaderSwizzleComponent>)
      : ({
          x: 'x',
          y: 'y',
          z: 'z',
          r: 'x',
          g: 'y',
          b: 'z',
        } satisfies Record<string, DirectShaderSwizzleComponent>);
  if (
    normalized.length < 1 ||
    normalized.length > 3 ||
    [...normalized].some((entry) => !(entry in componentMap))
  ) {
    return null;
  }
  const components = [...normalized].map(
    (entry) => componentMap[entry] as DirectShaderSwizzleComponent,
  );
  return {
    kind:
      components.length === 1
        ? 'scalar'
        : components.length === 2
          ? 'vec2'
          : 'vec3',
    components,
  };
}

function getDirectShaderSwizzleComponentNode(
  value: ShaderNodeValue,
  component: DirectShaderSwizzleComponent,
) {
  if (value.kind === 'scalar') {
    return value.node;
  }
  if (component === 'x') {
    return value.node.x;
  }
  if (component === 'y') {
    return value.node.y;
  }
  return value.node.z;
}

function buildDirectShaderSwizzleValue(
  value: ShaderNodeValue,
  property: string,
): ShaderNodeValue | null {
  if (value.kind === 'scalar') {
    return null;
  }
  const swizzle = resolveDirectShaderSwizzle(value.kind, property);
  if (!swizzle) {
    return null;
  }
  const componentNodes = swizzle.components.map((component) => {
    if (component === 'x') {
      return value.node.x;
    }
    if (component === 'y') {
      return value.node.y;
    }
    return value.node.z;
  });
  if (swizzle.kind === 'scalar') {
    return shaderFloat(componentNodes[0]);
  }
  if (swizzle.kind === 'vec2') {
    return shaderVec2(componentNodes[0], componentNodes[1]);
  }
  return shaderVec3(componentNodes[0], componentNodes[1], componentNodes[2]);
}

function coerceShaderValue(
  value: ShaderNodeValue,
  target: ShaderNodeValue['kind'],
): ShaderNodeValue {
  if (value.kind === target) {
    return value;
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
  if (value.kind === 'scalar') {
    return makeShaderValue('vec3', vec3(value.node, value.node, value.node));
  }
  return makeShaderValue('vec3', vec3(value.node.x, value.node.y, 0));
}

function getShaderResultKind(
  left: ShaderNodeValue,
  right: ShaderNodeValue,
): ShaderNodeValue['kind'] {
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
    bass: () => shaderFloat(env.uniforms.signalBass),
    bass_att: () => shaderFloat(env.uniforms.signalBass),
    mid: () => shaderFloat(env.uniforms.signalMid),
    mids: () => shaderFloat(env.uniforms.signalMid),
    mid_att: () => shaderFloat(env.uniforms.signalMid),
    mids_att: () => shaderFloat(env.uniforms.signalMid),
    treb: () => shaderFloat(env.uniforms.signalTreb),
    treb_att: () => shaderFloat(env.uniforms.signalTreb),
    treble: () => shaderFloat(env.uniforms.signalTreb),
    treble_att: () => shaderFloat(env.uniforms.signalTreb),
    beat: () => shaderFloat(env.uniforms.signalBeat),
    beat_pulse: () => shaderFloat(env.uniforms.signalBeat),
    progress: () => shaderFloat(env.uniforms.signalTime),
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
    tint_r: () => shaderFloat(env.uniforms.tint.x),
    tint_g: () => shaderFloat(env.uniforms.tint.y),
    tint_b: () => shaderFloat(env.uniforms.tint.z),
  };

  const resolved = uniformMap[normalized]?.() ?? null;
  if (resolved) {
    env.values.set(normalized, resolved);
  }
  return resolved;
}

function compileShaderExpressionNode(
  node: MilkdropShaderExpressionNode,
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
    case 'call': {
      const name = node.name.toLowerCase();
      const args = node.args
        .map((arg) => compileShaderExpressionNode(arg, env))
        .filter((value): value is ShaderNodeValue => value !== null);
      if (args.length !== node.args.length) {
        return null;
      }
      if (name === 'vec2' && args.length >= 2) {
        return shaderVec2(
          coerceShaderValue(args[0], 'scalar').node,
          coerceShaderValue(args[1], 'scalar').node,
        );
      }
      if ((name === 'vec2' || name === 'float2') && args.length >= 1) {
        const scalar = coerceShaderValue(args[0], 'scalar').node;
        return shaderVec2(scalar, scalar);
      }
      if (name === 'float2' && args.length >= 2) {
        return shaderVec2(
          coerceShaderValue(args[0], 'scalar').node,
          coerceShaderValue(args[1], 'scalar').node,
        );
      }
      if (name === 'vec3' || name === 'float3') {
        if (args.length >= 1 && args[0]?.kind === 'scalar') {
          const scalar = coerceShaderValue(args[0], 'scalar').node;
          return shaderVec3(scalar, scalar, scalar);
        }
        if (args.length >= 3) {
          return shaderVec3(
            coerceShaderValue(args[0], 'scalar').node,
            coerceShaderValue(args[1], 'scalar').node,
            coerceShaderValue(args[2], 'scalar').node,
          );
        }
        if (args.length >= 2 && args[0]?.kind === 'vec2') {
          return shaderVec3(
            args[0].node.x,
            args[0].node.y,
            coerceShaderValue(args[1], 'scalar').node,
          );
        }
        if (args.length >= 2 && args[1]?.kind === 'vec2') {
          return shaderVec3(
            coerceShaderValue(args[0], 'scalar').node,
            args[1].node.x,
            args[1].node.y,
          );
        }
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
        const sourceName =
          samplerArg?.type === 'identifier'
            ? samplerArg.name.toLowerCase()
            : 'sampler_main';
        const coordinate = args[1];
        if (!coordinate) {
          return null;
        }
        const resolvedBinding = resolveDirectShaderSamplerBinding(
          sourceName,
          name === 'tex3d' || name === 'texture3d' ? '3d' : '2d',
        );
        if (!resolvedBinding) {
          return null;
        }
        const sampleDimension =
          name === 'tex3d' || name === 'texture3d' ? float(1) : float(0);
        const sampleUv =
          coordinate.kind === 'vec3'
            ? vec2(coordinate.node.x, coordinate.node.y)
            : coerceShaderValue(coordinate, 'vec2').node;
        const sampleZ =
          coordinate.kind === 'vec3' ? coordinate.node.z : float(0);
        if (resolvedBinding.canonicalSource === 'main') {
          return makeShaderValue(
            'vec3',
            env.uniforms.currentTex.sample(
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

  if (segments.length === 1) {
    setShaderEnvValue(env, baseKey, nextValue);
    return;
  }

  if (!baseValue) {
    return;
  }

  const property = segments[1]?.toLowerCase();
  if (!property) {
    return;
  }

  const swizzle = resolveDirectShaderSwizzle(baseValue.kind, property);
  if (!swizzle) {
    return;
  }
  if (new Set(swizzle.components).size !== swizzle.components.length) {
    return;
  }
  const parent =
    baseValue.kind === 'vec3'
      ? coerceShaderValue(baseValue, 'vec3').node.toVar()
      : coerceShaderValue(baseValue, 'vec2').node.toVar();
  const assignedValue = coerceShaderValue(nextValue, swizzle.kind);
  swizzle.components.forEach((component, index) => {
    const targetNode =
      component === 'x' ? parent.x : component === 'y' ? parent.y : parent.z;
    const sourceNode =
      swizzle.kind === 'scalar'
        ? assignedValue.node
        : getDirectShaderSwizzleComponentNode(
            assignedValue,
            (['x', 'y', 'z'][index] ?? 'x') as DirectShaderSwizzleComponent,
          );
    targetNode.assign(sourceNode);
  });
  setShaderEnvValue(env, baseKey, shaderValueFromNode(parent, baseValue.kind));
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

function applyDirectWarpProgram(
  program: MilkdropShaderProgramPayload | null,
  env: ShaderNodeEnv,
  currentUv: any,
) {
  if (!program) {
    return currentUv;
  }
  const stageEnv: ShaderNodeEnv = {
    ...env,
    values: new Map(env.values),
  };
  setShaderEnvValue(stageEnv, 'uv', makeShaderValue('vec2', currentUv.toVar()));
  runShaderProgram(program.statements, stageEnv);
  return coerceShaderValue(
    getShaderEnvValue(stageEnv, 'uv') ?? makeShaderValue('vec2', currentUv),
    'vec2',
  ).node;
}

function applyDirectCompProgram(
  program: MilkdropShaderProgramPayload | null,
  env: ShaderNodeEnv,
  currentUv: any,
  currentColor: any,
) {
  if (!program) {
    return currentColor;
  }
  const stageEnv: ShaderNodeEnv = {
    ...env,
    values: new Map(env.values),
  };
  setShaderEnvValue(stageEnv, 'uv', makeShaderValue('vec2', currentUv));
  setShaderEnvValue(
    stageEnv,
    'ret',
    makeShaderValue('vec3', currentColor.toVar()),
  );
  runShaderProgram(program.statements, stageEnv);
  return coerceShaderValue(
    getShaderEnvValue(stageEnv, 'ret') ?? makeShaderValue('vec3', currentColor),
    'vec3',
  ).node;
}

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
  const sampleAuxTextureNode = createSampleAuxTextureNode(
    uniforms,
    uniforms.noiseTex,
    uniforms.simplexTex,
    uniforms.voronoiTex,
    uniforms.auraTex,
    uniforms.causticsTex,
    uniforms.patternTex,
    uniforms.fractalTex,
  );

  return Fn(() => {
    const shaderEnv: ShaderNodeEnv = {
      values: new Map<string, ShaderNodeValue>(),
      uniforms,
      sampleUvNode,
      sampleAuxTextureNode,
    };
    const baseUv = uv();
    const centeredUv = baseUv.sub(0.5);
    const rotationSin = sin(uniforms.rotation);
    const rotationCos = cos(uniforms.rotation);
    const rotatedUv = vec2(
      centeredUv.x.mul(rotationCos).sub(centeredUv.y.mul(rotationSin)),
      centeredUv.x.mul(rotationSin).add(centeredUv.y.mul(rotationCos)),
    );
    const transformedUv = rotatedUv
      .div(max(uniforms.zoomMul, 0.0001))
      .add(vec2(uniforms.offsetX, uniforms.offsetY));

    const programWarpUv = applyDirectWarpProgram(
      shaderPrograms.warp,
      shaderEnv,
      transformedUv.add(0.5),
    );
    const currentUv = applyFeedbackWarpNode(
      programWarpUv,
      uniforms.warpScale,
      uniforms.rotation,
    ).toVar();
    const previousUv = applyFeedbackWarpNode(
      currentUv.sub(0.5).div(max(uniforms.zoom, 0.0001)).add(0.5),
      uniforms.warpScale.mul(0.8),
      uniforms.rotation.mul(0.6),
    ).toVar();
    const warpTextureBaseUv = currentUv.toVar();

    const warpTextureMask = step(0.5, uniforms.warpTextureSource).mul(
      step(0.0001, uniforms.warpTextureAmount),
    );
    const warpUv = warpTextureBaseUv
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
    const previousColor = previous.rgb.toVar();

    If(
      uniforms.feedbackSoftness.greaterThan(
        float(MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD),
      ),
      () => {
        const sampleOffset = uniforms.texelSize.mul(
          float(MILKDROP_FEEDBACK_BLUR_OFFSET_BASE).add(
            uniforms.feedbackSoftness.mul(MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE),
          ),
        );
        const softened = previous.rgb
          .add(
            uniforms.previousTex.sample(
              sampleUvNode(
                previousUv.add(vec2(sampleOffset.x, 0)),
                uniforms.textureWrap,
              ),
            ).rgb,
          )
          .add(
            uniforms.previousTex.sample(
              sampleUvNode(
                previousUv.sub(vec2(sampleOffset.x, 0)),
                uniforms.textureWrap,
              ),
            ).rgb,
          )
          .add(
            uniforms.previousTex.sample(
              sampleUvNode(
                previousUv.add(vec2(0, sampleOffset.y)),
                uniforms.textureWrap,
              ),
            ).rgb,
          )
          .add(
            uniforms.previousTex.sample(
              sampleUvNode(
                previousUv.sub(vec2(0, sampleOffset.y)),
                uniforms.textureWrap,
              ),
            ).rgb,
          )
          .div(5);
        previousColor.assign(
          mix(
            previousColor,
            softened,
            clamp(
              uniforms.feedbackSoftness.mul(MILKDROP_FEEDBACK_BLUR_BLEND_SCALE),
              0,
              MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
            ),
          ),
        );
      },
    );

    let color = mix(
      current.rgb,
      previousColor,
      clamp(
        uniforms.videoEchoAlpha.add(uniforms.feedbackTexture.mul(0.2)),
        0,
        1,
      ),
    ).toVar();
    color.assign(mix(color, previousColor, clamp(uniforms.mixAlpha, 0, 1)));
    color.assign(
      mix(
        color,
        current.rgb,
        clamp(
          uniforms.currentFrameBoost,
          0,
          MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
        ),
      ),
    );
    color = applyDirectCompProgram(
      shaderPrograms.comp,
      shaderEnv,
      currentUv,
      color,
    ).toVar();

    const brightenMask = max(
      step(0.01, uniforms.brighten),
      step(0.01, uniforms.brightenBoost),
    );
    const brightened = min(
      vec3(1),
      color.mul(float(1.18).add(uniforms.brightenBoost.mul(0.35))),
    );
    color.assign(mix(color, brightened, brightenMask));
    color.assign(mix(color, color.mul(0.82), step(0.5, uniforms.darken)));
    const centerMask = clamp(baseUv.sub(0.5).length().mul(400), 0, 1);
    color.assign(
      color.mul(
        mix(
          float(1),
          float(0.97).add(centerMask.mul(0.03)),
          step(0.5, uniforms.darkenCenter),
        ),
      ),
    );
    color.assign(
      mix(
        color,
        abs(color.sub(0.5)).mul(1.5),
        clamp(max(uniforms.solarize, uniforms.solarizeBoost), 0, 1),
      ),
    );
    color.assign(
      mix(
        color,
        vec3(1).sub(color),
        clamp(max(uniforms.invert, uniforms.invertBoost), 0, 1),
      ),
    );
    const stereoEnabled = step(0.5, uniforms.redBlueStereo);
    const stereoOffset = float(0.003).add(uniforms.signalEnergy.mul(0.003));
    const leftStereo = uniforms.previousTex.sample(
      sampleUvNode(previousUv.sub(vec2(stereoOffset, 0)), uniforms.textureWrap),
    ).rgb;
    const rightStereo = uniforms.previousTex.sample(
      sampleUvNode(previousUv.add(vec2(stereoOffset, 0)), uniforms.textureWrap),
    ).rgb;
    const stereoColor = vec3(leftStereo.r, rightStereo.g, rightStereo.b);
    color.assign(mix(color, stereoColor, stereoEnabled.mul(0.85)));
    color.assign(hueRotateNode(color, uniforms.hueShift));
    color.assign(applySaturationNode(color, uniforms.saturation));
    color.assign(applyContrastNode(color, uniforms.contrast));
    color.assign(color.mul(uniforms.colorScale));
    color.assign(color.mul(uniforms.tint));

    const overlayMask = step(0.5, uniforms.overlayTextureSource)
      .mul(step(0.5, uniforms.overlayTextureMode))
      .mul(step(0.0001, uniforms.overlayTextureAmount));
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
    const overlayResult = select(
      uniforms.overlayTextureMode.lessThan(1.5),
      overlayReplace,
      select(
        uniforms.overlayTextureMode.lessThan(2.5),
        overlayMix,
        select(
          uniforms.overlayTextureMode.lessThan(3.5),
          overlayAdd,
          overlayMultiply,
        ),
      ),
    );
    color.assign(mix(color, overlayResult, overlayMask));

    const spectralUvA = baseUv
      .mul(
        vec2(
          float(1.4).add(uniforms.signalBass.mul(0.8)),
          float(1.1).add(uniforms.signalMid.mul(0.6)),
        ),
      )
      .add(
        vec2(uniforms.signalTime.mul(0.035), uniforms.signalTime.mul(-0.02)),
      );
    const spectralUvB = baseUv
      .mul(
        vec2(
          float(2).add(uniforms.signalTreb.mul(0.9)),
          float(1.7).add(uniforms.signalBass.mul(0.5)),
        ),
      )
      .sub(
        vec2(uniforms.signalTime.mul(0.018), uniforms.signalTime.mul(-0.026)),
      );
    const spectralA = sampleAuxTextureNode(
      float(2),
      float(0),
      spectralUvA,
      0,
    ).rgb;
    const spectralB = sampleAuxTextureNode(
      float(5),
      float(0),
      spectralUvB,
      0,
    ).rgb;
    const spectralPulse = sin(
      baseUv.x
        .add(baseUv.y)
        .mul(18)
        .add(uniforms.signalTime.mul(2.4))
        .add(uniforms.signalBeat.mul(Math.PI)),
    ).mul(0.15);
    const spectralField = smoothstep(
      0.38,
      0.92,
      dot(mix(spectralA, spectralB, 0.5), vec3(0.3333333)).add(spectralPulse),
    );
    const spectralTint = vec3(
      float(0.35).add(uniforms.signalBass.mul(0.9)),
      float(0.25).add(uniforms.signalMid.mul(0.8)),
      float(0.45).add(uniforms.signalTreb.mul(1.1)),
    );
    color.addAssign(
      spectralTint
        .mul(spectralField)
        .mul(
          float(0.06)
            .add(uniforms.signalEnergy.mul(0.18))
            .add(uniforms.signalBeat.mul(0.08)),
        ),
    );

    const gammaAdjusted = pow(
      max(color, vec3(0)),
      vec3(float(1).div(max(uniforms.gammaAdj, 0.0001))),
    );
    return vec4(gammaAdjusted, 1);
  })();
}

class WebGPUMilkdropFeedbackManager {
  readonly compositeScene = new Scene();
  readonly presentScene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  readonly compositeMaterial: NodeMaterial & { uniforms: CompositeUniformBag };
  readonly presentMaterial: MeshBasicMaterial;
  readonly sceneTarget: RenderTarget;
  readonly targets: [RenderTarget, RenderTarget];
  readonly profile = WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile;
  readonly sceneResolutionScale = this.profile.sceneResolutionScale;
  readonly feedbackResolutionScale = this.profile.feedbackResolutionScale;
  readonly auxTextures: Record<string, Texture>;
  adaptiveFeedbackResolutionMultiplier = 1;
  currentCompositeKey = '';
  currentFeedbackResolutionScale = this.feedbackResolutionScale;
  viewportWidth: number;
  viewportHeight: number;
  private index = 0;

  constructor(width: number, height: number) {
    this.camera.position.z = 1;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.auxTextures = {
      noise: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.noise),
      simplex: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.simplex),
      voronoi: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.voronoi),
      aura: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.aura, true),
      caustics: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.caustics),
      pattern: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.pattern),
      fractal: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.fractal),
    };
    this.sceneTarget = createFeedbackRenderTarget(
      width,
      height,
      this.sceneResolutionScale,
    );
    this.targets = [
      createFeedbackRenderTarget(width, height, this.feedbackResolutionScale),
      createFeedbackRenderTarget(width, height, this.feedbackResolutionScale),
    ];

    const uniforms = createCompositeUniforms(
      this.sceneTarget.texture,
      this.targets[0].texture,
      this.auxTextures,
    );
    uniforms.texelSize.value.set(
      1 / Math.max(1, this.targets[0].width),
      1 / Math.max(1, this.targets[0].height),
    );

    const compositeMaterial = new NodeMaterial();
    compositeMaterial.outputNode = createCompositeOutputNode(uniforms);
    compositeMaterial.needsUpdate = true;
    this.compositeMaterial = Object.assign(compositeMaterial, {
      uniforms,
    });

    this.presentMaterial = new MeshBasicMaterial({
      map: this.targets[0].texture,
    });

    const compositeQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.compositeMaterial,
    );
    const presentQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.presentMaterial,
    );
    this.compositeScene.add(compositeQuad);
    this.presentScene.add(presentQuad);
  }

  get readTarget() {
    return this.targets[this.index];
  }

  get writeTarget() {
    return this.targets[(this.index + 1) % 2];
  }

  getShapeTexture() {
    return this.readTarget.texture;
  }

  swap() {
    this.index = (this.index + 1) % 2;
    this.presentMaterial.map = this.readTarget.texture;
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;
  }

  applyCompositeState(state: MilkdropFeedbackCompositeState) {
    const nextCompositeKey = JSON.stringify({
      shaderExecution: state.shaderExecution,
      warp: state.shaderPrograms.warp?.source ?? null,
      comp: state.shaderPrograms.comp?.source ?? null,
    });
    if (nextCompositeKey !== this.currentCompositeKey) {
      this.currentCompositeKey = nextCompositeKey;
      this.compositeMaterial.outputNode = createCompositeOutputNode(
        this.compositeMaterial.uniforms,
        state.shaderExecution === 'direct'
          ? state.shaderPrograms
          : { warp: null, comp: null },
      );
      this.compositeMaterial.needsUpdate = true;
    }

    const needsSceneResolution =
      state.shaderExecution === 'direct' ||
      Math.abs(state.zoom - 1) > 0.0001 ||
      state.videoEchoOrientation !== 0 ||
      state.feedbackTexture > 0.5 ||
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

    this.compositeMaterial.uniforms.mixAlpha.value = state.mixAlpha;
    this.compositeMaterial.uniforms.videoEchoAlpha.value = state.videoEchoAlpha;
    this.compositeMaterial.uniforms.zoom.value = state.zoom;
    this.compositeMaterial.uniforms.videoEchoOrientation.value =
      state.videoEchoOrientation;
    this.compositeMaterial.uniforms.brighten.value = state.brighten;
    this.compositeMaterial.uniforms.darken.value = state.darken;
    this.compositeMaterial.uniforms.darkenCenter.value = state.darkenCenter;
    this.compositeMaterial.uniforms.solarize.value = state.solarize;
    this.compositeMaterial.uniforms.invert.value = state.invert;
    this.compositeMaterial.uniforms.redBlueStereo.value =
      state.redBlueStereo ?? 0;
    this.compositeMaterial.uniforms.gammaAdj.value = state.gammaAdj;
    this.compositeMaterial.uniforms.textureWrap.value = state.textureWrap;
    this.compositeMaterial.uniforms.feedbackTexture.value =
      state.feedbackTexture;
    this.compositeMaterial.uniforms.warpScale.value = state.warpScale;
    this.compositeMaterial.uniforms.offsetX.value = state.offsetX;
    this.compositeMaterial.uniforms.offsetY.value = state.offsetY;
    this.compositeMaterial.uniforms.rotation.value = state.rotation;
    this.compositeMaterial.uniforms.zoomMul.value = state.zoomMul;
    this.compositeMaterial.uniforms.saturation.value = state.saturation;
    this.compositeMaterial.uniforms.contrast.value = state.contrast;
    this.compositeMaterial.uniforms.colorScale.value.setRGB(
      state.colorScale.r,
      state.colorScale.g,
      state.colorScale.b,
    );
    this.compositeMaterial.uniforms.hueShift.value = state.hueShift;
    this.compositeMaterial.uniforms.brightenBoost.value = state.brightenBoost;
    this.compositeMaterial.uniforms.invertBoost.value = state.invertBoost;
    this.compositeMaterial.uniforms.solarizeBoost.value = state.solarizeBoost;
    this.compositeMaterial.uniforms.tint.value.setRGB(
      state.tint.r,
      state.tint.g,
      state.tint.b,
    );
    this.compositeMaterial.uniforms.overlayTextureSource.value =
      state.overlayTextureSource;
    this.compositeMaterial.uniforms.overlayTextureMode.value =
      state.overlayTextureMode;
    this.compositeMaterial.uniforms.overlayTextureSampleDimension.value =
      state.overlayTextureSampleDimension;
    this.compositeMaterial.uniforms.overlayTextureInvert.value =
      state.overlayTextureInvert;
    this.compositeMaterial.uniforms.overlayTextureAmount.value =
      state.overlayTextureAmount;
    this.compositeMaterial.uniforms.overlayTextureScale.value.set(
      state.overlayTextureScale.x,
      state.overlayTextureScale.y,
    );
    this.compositeMaterial.uniforms.overlayTextureOffset.value.set(
      state.overlayTextureOffset.x,
      state.overlayTextureOffset.y,
    );
    this.compositeMaterial.uniforms.overlayTextureVolumeSliceZ.value =
      state.overlayTextureVolumeSliceZ;
    this.compositeMaterial.uniforms.warpTextureSource.value =
      state.warpTextureSource;
    this.compositeMaterial.uniforms.warpTextureSampleDimension.value =
      state.warpTextureSampleDimension;
    this.compositeMaterial.uniforms.warpTextureAmount.value =
      state.warpTextureAmount;
    this.compositeMaterial.uniforms.warpTextureScale.value.set(
      state.warpTextureScale.x,
      state.warpTextureScale.y,
    );
    this.compositeMaterial.uniforms.warpTextureOffset.value.set(
      state.warpTextureOffset.x,
      state.warpTextureOffset.y,
    );
    this.compositeMaterial.uniforms.warpTextureVolumeSliceZ.value =
      state.warpTextureVolumeSliceZ;
    this.compositeMaterial.uniforms.signalBass.value = state.signalBass;
    this.compositeMaterial.uniforms.signalMid.value = state.signalMid;
    this.compositeMaterial.uniforms.signalTreb.value = state.signalTreb;
    this.compositeMaterial.uniforms.signalBeat.value = state.signalBeat;
    this.compositeMaterial.uniforms.signalEnergy.value = state.signalEnergy;
    this.compositeMaterial.uniforms.signalTime.value = state.signalTime;
  }

  setAdaptiveQuality({
    feedbackResolutionMultiplier,
  }: Partial<{
    feedbackResolutionMultiplier: number;
  }>) {
    const nextMultiplier = Math.min(
      1,
      Math.max(0.45, feedbackResolutionMultiplier ?? 1),
    );
    if (
      Math.abs(nextMultiplier - this.adaptiveFeedbackResolutionMultiplier) <
      0.0001
    ) {
      return;
    }
    this.adaptiveFeedbackResolutionMultiplier = nextMultiplier;
    this.currentFeedbackResolutionScale = Math.min(
      this.currentFeedbackResolutionScale,
      this.feedbackResolutionScale * this.adaptiveFeedbackResolutionMultiplier,
    );
    this.resize(this.viewportWidth, this.viewportHeight);
  }

  render(renderer: FeedbackRendererLike, scene: Scene, camera: Camera) {
    this.compositeMaterial.uniforms.currentTex.value = this.sceneTarget.texture;
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.compositeScene, this.camera);
    this.swap();
    renderer.setRenderTarget(null);
    renderer.render(this.presentScene, this.camera);
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
    this.compositeMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, feedbackWidth),
      1 / Math.max(1, feedbackHeight),
    );
  }

  dispose() {
    this.sceneTarget.dispose();
    this.targets.forEach((target) => target.dispose());
    Object.values(this.auxTextures).forEach((textureValue) => {
      textureValue.dispose();
    });
    disposeMaterial(this.compositeMaterial);
    disposeMaterial(this.presentMaterial);
    this.compositeScene.clear();
    this.presentScene.clear();
  }
}

export function createMilkdropWebGPUFeedbackManager(
  width: number,
  height: number,
) {
  return new WebGPUMilkdropFeedbackManager(
    width,
    height,
  ) as MilkdropFeedbackManager;
}
