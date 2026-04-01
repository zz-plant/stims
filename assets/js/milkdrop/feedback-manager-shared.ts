import {
  type Camera,
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  type RenderTarget,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { disposeMaterial } from '../utils/three-dispose';
import type {
  FeedbackBackendProfile,
  MilkdropBackendBehavior,
} from './backend-behavior';
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
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
} from './types';

export type MilkdropCompositeShaderConfig = {
  enhancedFeedbackBlur?: boolean;
  currentFrameBoostCap?: number;
};

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
const AUX_TEXTURE_SPECS = {
  noise: { fileName: MILKDROP_TEXTURE_FILES.noise, colorTexture: false },
  simplex: { fileName: MILKDROP_TEXTURE_FILES.simplex, colorTexture: false },
  voronoi: { fileName: MILKDROP_TEXTURE_FILES.voronoi, colorTexture: false },
  aura: { fileName: MILKDROP_TEXTURE_FILES.aura, colorTexture: true },
  caustics: { fileName: MILKDROP_TEXTURE_FILES.caustics, colorTexture: false },
  pattern: { fileName: MILKDROP_TEXTURE_FILES.pattern, colorTexture: false },
  fractal: { fileName: MILKDROP_TEXTURE_FILES.fractal, colorTexture: false },
} as const satisfies Record<
  keyof typeof MILKDROP_TEXTURE_FILES,
  { fileName: string; colorTexture: boolean }
>;

type AuxTextureName = keyof typeof AUX_TEXTURE_SPECS;

type SharedAuxTextureMap = Record<AuxTextureName, Texture>;

const milkdropTextureLoader = new TextureLoader();
const sharedMilkdropTextureCache = new Map<string, Texture>();

function resolveTextureUrl(fileName: string) {
  const baseUrl =
    typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : '/';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}textures/${fileName}`;
}

function configureMilkdropTexture(texture: Texture, colorTexture = false) {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  if (colorTexture) {
    texture.colorSpace = SRGBColorSpace;
  }
  return texture;
}

function getSharedMilkdropTexture(fileName: string, colorTexture = false) {
  const cacheKey = `${fileName}:${colorTexture ? 'srgb' : 'linear'}`;
  let texture = sharedMilkdropTextureCache.get(cacheKey);
  if (!texture) {
    texture = configureMilkdropTexture(
      milkdropTextureLoader.load(resolveTextureUrl(fileName)),
      colorTexture,
    );
    sharedMilkdropTextureCache.set(cacheKey, texture);
  }
  return texture;
}

function getSharedAuxTextures(): SharedAuxTextureMap {
  return {
    noise: getSharedMilkdropTexture(
      AUX_TEXTURE_SPECS.noise.fileName,
      AUX_TEXTURE_SPECS.noise.colorTexture,
    ),
    simplex: getSharedMilkdropTexture(
      AUX_TEXTURE_SPECS.simplex.fileName,
      AUX_TEXTURE_SPECS.simplex.colorTexture,
    ),
    voronoi: getSharedMilkdropTexture(
      AUX_TEXTURE_SPECS.voronoi.fileName,
      AUX_TEXTURE_SPECS.voronoi.colorTexture,
    ),
    aura: getSharedMilkdropTexture(
      AUX_TEXTURE_SPECS.aura.fileName,
      AUX_TEXTURE_SPECS.aura.colorTexture,
    ),
    caustics: getSharedMilkdropTexture(
      AUX_TEXTURE_SPECS.caustics.fileName,
      AUX_TEXTURE_SPECS.caustics.colorTexture,
    ),
    pattern: getSharedMilkdropTexture(
      AUX_TEXTURE_SPECS.pattern.fileName,
      AUX_TEXTURE_SPECS.pattern.colorTexture,
    ),
    fractal: getSharedMilkdropTexture(
      AUX_TEXTURE_SPECS.fractal.fileName,
      AUX_TEXTURE_SPECS.fractal.colorTexture,
    ),
  };
}

function createFeedbackRenderTarget(
  width: number,
  height: number,
  {
    resolutionScale,
    useHalfFloatFeedback,
    samples,
  }: {
    resolutionScale: number;
    useHalfFloatFeedback: boolean;
    samples: number;
  },
) {
  const scaledWidth = Math.max(1, Math.round(width * resolutionScale));
  const scaledHeight = Math.max(1, Math.round(height * resolutionScale));
  const target = new WebGLRenderTarget(scaledWidth, scaledHeight, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    ...(useHalfFloatFeedback
      ? {
          type: HalfFloatType,
        }
      : {}),
  });
  target.samples = samples;
  return target;
}

export function createCompositeFragmentShaderVariant(
  source: string,
  {
    enhancedFeedbackBlur = false,
    currentFrameBoostCap = MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
  }: MilkdropCompositeShaderConfig = {},
) {
  const blurBlock = enhancedFeedbackBlur
    ? `if (feedbackSoftness > ${MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD.toFixed(2)}) {
            vec2 sampleOffset = texelSize * (0.65 + feedbackSoftness * 0.6);
            vec3 softened = (
              previous.rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(0.0, sampleOffset.y), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(0.0, sampleOffset.y), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv + sampleOffset, textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - sampleOffset, textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(sampleOffset.x, -sampleOffset.y), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(-sampleOffset.x, sampleOffset.y), textureWrap)).rgb
            ) / 9.0;
            previousColor = mix(
              previousColor,
              softened,
              clamp(feedbackSoftness * 0.6, 0.0, 0.65)
            );
          }`
    : `if (feedbackSoftness > ${MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD.toFixed(2)}) {
            vec2 sampleOffset = texelSize * (${MILKDROP_FEEDBACK_BLUR_OFFSET_BASE.toFixed(2)} + feedbackSoftness * ${MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE.toFixed(1)});
            vec3 softened = (
              previous.rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(0.0, sampleOffset.y), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(0.0, sampleOffset.y), textureWrap)).rgb
            ) / 5.0;
            previousColor = mix(
              previousColor,
              softened,
              clamp(feedbackSoftness * ${MILKDROP_FEEDBACK_BLUR_BLEND_SCALE.toFixed(2)}, 0.0, ${MILKDROP_FEEDBACK_BLUR_BLEND_CAP.toFixed(1)})
            );
          }`;

  return source
    .replace(
      /if \(feedbackSoftness > 0\.01\) \{[\s\S]*?clamp\(feedbackSoftness \* 0\.45, 0\.0, 0\.5\)\s*\);\s*\}/,
      blurBlock,
    )
    .replace(
      /color = mix\(\s*current\.rgb,\s*previousColor,\s*clamp\(mixAlpha \+ feedbackTexture \* 0\.2, 0\.0, 1\.0\)\s*\);/,
      `color = mix(current.rgb, previousColor, clamp(videoEchoAlpha + feedbackTexture * 0.2, 0.0, 1.0));
          color = mix(color, previousColor, clamp(mixAlpha, 0.0, 1.0));`,
    )
    .replace(
      /color = mix\(color, current\.rgb, clamp\(currentFrameBoost, 0\.0, 0\.3\)\);/,
      `color = mix(color, current.rgb, clamp(currentFrameBoost, 0.0, ${currentFrameBoostCap.toFixed(1)}));`,
    );
}

class SharedMilkdropFeedbackManager implements MilkdropFeedbackManager {
  readonly compositeScene = new Scene();
  readonly presentScene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  readonly compositeMaterial: ShaderMaterial;
  readonly presentMaterial: MeshBasicMaterial;
  readonly sceneTarget: WebGLRenderTarget;
  readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  readonly sceneResolutionScale: number;
  readonly feedbackResolutionScale: number;
  readonly profile: FeedbackBackendProfile;
  readonly auxTextures: SharedAuxTextureMap;
  private index = 0;

  constructor(
    width: number,
    height: number,
    behavior: MilkdropBackendBehavior,
  ) {
    this.camera.position.z = 1;
    this.profile = behavior.feedbackProfile;
    this.sceneResolutionScale = this.profile.sceneResolutionScale;
    this.feedbackResolutionScale = this.profile.feedbackResolutionScale;
    this.auxTextures = getSharedAuxTextures();
    this.sceneTarget = createFeedbackRenderTarget(width, height, {
      resolutionScale: this.sceneResolutionScale,
      useHalfFloatFeedback: behavior.useHalfFloatFeedback,
      samples: this.profile.samples,
    });
    this.targets = [
      createFeedbackRenderTarget(width, height, {
        resolutionScale: this.feedbackResolutionScale,
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: this.profile.samples,
      }),
      createFeedbackRenderTarget(width, height, {
        resolutionScale: this.feedbackResolutionScale,
        useHalfFloatFeedback: behavior.useHalfFloatFeedback,
        samples: this.profile.samples,
      }),
    ];
    this.compositeMaterial = new ShaderMaterial({
      uniforms: {
        currentTex: { value: this.sceneTarget.texture },
        previousTex: { value: this.targets[0].texture },
        noiseTex: { value: this.auxTextures.noise },
        simplexTex: { value: this.auxTextures.simplex },
        voronoiTex: { value: this.auxTextures.voronoi },
        auraTex: { value: this.auxTextures.aura },
        causticsTex: { value: this.auxTextures.caustics },
        patternTex: { value: this.auxTextures.pattern },
        fractalTex: { value: this.auxTextures.fractal },
        mixAlpha: { value: 0.18 },
        videoEchoAlpha: { value: 0 },
        zoom: { value: 1.02 },
        videoEchoOrientation: { value: 0 },
        brighten: { value: 0 },
        darken: { value: 0 },
        darkenCenter: { value: 0 },
        solarize: { value: 0 },
        invert: { value: 0 },
        redBlueStereo: { value: 0 },
        gammaAdj: { value: 1 },
        textureWrap: { value: 0 },
        feedbackTexture: { value: 0 },
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
        signalBass: { value: 0 },
        signalMid: { value: 0 },
        signalTreb: { value: 0 },
        signalBeat: { value: 0 },
        signalEnergy: { value: 0 },
        signalTime: { value: 0 },
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
      fragmentShader: `
        uniform sampler2D currentTex;
        uniform sampler2D previousTex;
        uniform sampler2D noiseTex;
        uniform sampler2D simplexTex;
        uniform sampler2D voronoiTex;
        uniform sampler2D auraTex;
        uniform sampler2D causticsTex;
        uniform sampler2D patternTex;
        uniform sampler2D fractalTex;
        uniform float mixAlpha;
        uniform float videoEchoAlpha;
        uniform float zoom;
        uniform float videoEchoOrientation;
        uniform float brighten;
        uniform float darken;
        uniform float darkenCenter;
        uniform float solarize;
        uniform float invert;
        uniform float redBlueStereo;
        uniform float gammaAdj;
        uniform float textureWrap;
        uniform float feedbackTexture;
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
        uniform float signalBeat;
        uniform float signalEnergy;
        uniform float signalTime;
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
          return texture2D(fractalTex, uv);
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
          // Keep tex3D phases fully periodic so modulo-equivalent values stay aligned while the
          // last atlas segment blends the final slice back to slice 0.
          float wrappedSliceZ = fract(sliceZ);
          float scaledSlice = wrappedSliceZ * sliceCount;
          float sliceIndexA = mod(floor(scaledSlice), sliceCount);
          float sliceIndexB = mod(sliceIndexA + 1.0, sliceCount);
          float sliceBlend = fract(scaledSlice);
          vec4 sliceA = sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexA));
          vec4 sliceB = sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexB));
          return mix(sliceA, sliceB, sliceBlend);
        }

        vec2 applyFeedbackWarp(vec2 uv, float amount, float rotationAmount) {
          vec2 centered = uv - 0.5;
          float radius = length(centered);
          float angle = atan(centered.y, centered.x);
          float spiral = sin(radius * 18.0 - angle * 4.0) * amount * 0.08;
          angle += spiral + rotationAmount * 0.22;
          radius *= 1.0 + cos(angle * 3.0 + radius * 10.0) * amount * 0.05;
          return vec2(cos(angle), sin(angle)) * radius + 0.5;
        }

        vec2 applyVideoEchoOrientationTransform(vec2 uv, float orientation) {
          float flipU = step(0.5, mod(orientation, 2.0));
          float flipV = step(1.5, mod(orientation, 4.0));
          return vec2(
            mix(uv.x, 1.0 - uv.x, flipU),
            mix(uv.y, 1.0 - uv.y, flipV)
          );
        }

        void main() {
          vec2 centeredUv = vUv - 0.5;
          float rotSin = sin(rotation);
          float rotCos = cos(rotation);
          vec2 rotatedUv = vec2(
            centeredUv.x * rotCos - centeredUv.y * rotSin,
            centeredUv.x * rotSin + centeredUv.y * rotCos
          );
          vec2 transformedUv = rotatedUv / max(zoomMul, 0.0001) + vec2(offsetX, offsetY);
          vec2 currentUv = applyFeedbackWarp(
            transformedUv + 0.5,
            warpScale,
            rotation
          );
          vec2 prevUv = applyFeedbackWarp(
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
            currentUv += warpVector * warpTextureAmount * 0.12;
            prevUv += warpVector * warpTextureAmount * 0.08;
          }
          prevUv = applyVideoEchoOrientationTransform(
            prevUv,
            videoEchoOrientation
          );
          vec4 current = texture2D(currentTex, sampleUv(currentUv, textureWrap));
          vec4 previous = texture2D(previousTex, sampleUv(prevUv, textureWrap));
          vec3 previousColor = previous.rgb;
          if (feedbackSoftness > ${MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD.toFixed(2)}) {
            vec2 sampleOffset = texelSize * (${MILKDROP_FEEDBACK_BLUR_OFFSET_BASE.toFixed(2)} + feedbackSoftness * ${MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE.toFixed(1)});
            vec3 softened = (
              previous.rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(0.0, sampleOffset.y), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(0.0, sampleOffset.y), textureWrap)).rgb
            ) / 5.0;
            previousColor = mix(
              previousColor,
              softened,
              clamp(feedbackSoftness * ${MILKDROP_FEEDBACK_BLUR_BLEND_SCALE.toFixed(2)}, 0.0, ${MILKDROP_FEEDBACK_BLUR_BLEND_CAP.toFixed(1)})
            );
          }
          vec3 color = mix(
            current.rgb,
            previousColor,
            clamp(videoEchoAlpha + feedbackTexture * 0.2, 0.0, 1.0)
          );
          color = mix(color, previousColor, clamp(mixAlpha, 0.0, 1.0));
          color = mix(color, current.rgb, clamp(currentFrameBoost, 0.0, ${MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP.toFixed(1)}));
          if (brighten > 0.01 || brightenBoost > 0.01) {
            color = min(vec3(1.0), color * (1.0 + 0.18 + brightenBoost * 0.35));
          }
          if (darken > 0.5) {
            color = color * 0.82;
          }
          if (darkenCenter > 0.5) {
            float centerMask = clamp(length(vUv - vec2(0.5)) * 400.0, 0.0, 1.0);
            color *= 0.97 + 0.03 * centerMask;
          }
          if (solarize > 0.01 || solarizeBoost > 0.01) {
            color = mix(color, abs(color - 0.5) * 1.5, clamp(max(solarize, solarizeBoost), 0.0, 1.0));
          }
          if (invert > 0.01 || invertBoost > 0.01) {
            color = mix(color, 1.0 - color, clamp(max(invert, invertBoost), 0.0, 1.0));
          }
          if (redBlueStereo > 0.5) {
            float stereoOffset = 0.003 + signalEnergy * 0.003;
            vec2 stereoShift = vec2(stereoOffset, 0.0);
            vec3 leftColor = texture2D(previousTex, sampleUv(prevUv - stereoShift, textureWrap)).rgb;
            vec3 rightColor = texture2D(previousTex, sampleUv(prevUv + stereoShift, textureWrap)).rgb;
            color = mix(color, vec3(leftColor.r, rightColor.g, rightColor.b), 0.85);
          }
          color = hueRotate(color, hueShift);
          color = applySaturation(color, saturation);
          color = applyContrast(color, contrast);
          color *= colorScale;
          color *= tint;
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
            } else {
              color *= mix(vec3(1.0), overlayColor, clamp(amount, 0.0, 1.0));
            }
          }
          color = pow(max(color, vec3(0.0)), vec3(1.0 / max(gammaAdj, 0.0001)));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.presentMaterial = new MeshBasicMaterial({
      map: this.targets[0].texture,
    });
    const quad = new Mesh(FULLSCREEN_QUAD_GEOMETRY, this.compositeMaterial);
    const presentQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.presentMaterial,
    );
    this.compositeScene.add(quad);
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
    const uniforms = this.compositeMaterial.uniforms;
    uniforms.currentTex.value = this.sceneTarget.texture;
    uniforms.previousTex.value = this.readTarget.texture;
    uniforms.mixAlpha.value = state.mixAlpha;
    uniforms.videoEchoAlpha.value = state.videoEchoAlpha;
    uniforms.zoom.value = state.zoom;
    uniforms.videoEchoOrientation.value = state.videoEchoOrientation;
    uniforms.brighten.value = state.brighten;
    uniforms.darken.value = state.darken;
    uniforms.darkenCenter.value = state.darkenCenter;
    uniforms.solarize.value = state.solarize;
    uniforms.invert.value = state.invert;
    uniforms.redBlueStereo.value = state.redBlueStereo ?? 0;
    uniforms.gammaAdj.value = state.gammaAdj;
    uniforms.textureWrap.value = state.textureWrap;
    uniforms.feedbackTexture.value = state.feedbackTexture;
    uniforms.warpScale.value = state.warpScale;
    uniforms.offsetX.value = state.offsetX;
    uniforms.offsetY.value = state.offsetY;
    uniforms.rotation.value = state.rotation;
    uniforms.zoomMul.value = state.zoomMul;
    uniforms.saturation.value = state.saturation;
    uniforms.contrast.value = state.contrast;
    uniforms.colorScale.value.setRGB(
      state.colorScale.r,
      state.colorScale.g,
      state.colorScale.b,
    );
    uniforms.hueShift.value = state.hueShift;
    uniforms.brightenBoost.value = state.brightenBoost;
    uniforms.invertBoost.value = state.invertBoost;
    uniforms.solarizeBoost.value = state.solarizeBoost;
    uniforms.tint.value.setRGB(state.tint.r, state.tint.g, state.tint.b);
    uniforms.overlayTextureSource.value = state.overlayTextureSource;
    uniforms.overlayTextureMode.value = state.overlayTextureMode;
    uniforms.overlayTextureSampleDimension.value =
      state.overlayTextureSampleDimension;
    uniforms.overlayTextureInvert.value = state.overlayTextureInvert;
    uniforms.overlayTextureAmount.value = state.overlayTextureAmount;
    uniforms.overlayTextureScale.value.set(
      state.overlayTextureScale.x,
      state.overlayTextureScale.y,
    );
    uniforms.overlayTextureOffset.value.set(
      state.overlayTextureOffset.x,
      state.overlayTextureOffset.y,
    );
    uniforms.overlayTextureVolumeSliceZ.value =
      state.overlayTextureVolumeSliceZ;
    uniforms.warpTextureSource.value = state.warpTextureSource;
    uniforms.warpTextureSampleDimension.value =
      state.warpTextureSampleDimension;
    uniforms.warpTextureAmount.value = state.warpTextureAmount;
    uniforms.warpTextureScale.value.set(
      state.warpTextureScale.x,
      state.warpTextureScale.y,
    );
    uniforms.warpTextureOffset.value.set(
      state.warpTextureOffset.x,
      state.warpTextureOffset.y,
    );
    uniforms.warpTextureVolumeSliceZ.value = state.warpTextureVolumeSliceZ;
    uniforms.signalBass.value = state.signalBass;
    uniforms.signalMid.value = state.signalMid;
    uniforms.signalTreb.value = state.signalTreb;
    uniforms.signalBeat.value = state.signalBeat;
    uniforms.signalEnergy.value = state.signalEnergy;
    uniforms.signalTime.value = state.signalTime;
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

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(sourceScene, sourceCamera);
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.compositeScene, this.camera);
    renderer.setRenderTarget(null);
    renderer.render(this.presentScene, this.camera);
    this.swap();
    return true;
  }

  resize(width: number, height: number) {
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
      Math.round(width * this.feedbackResolutionScale),
    );
    const feedbackHeight = Math.max(
      1,
      Math.round(height * this.feedbackResolutionScale),
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
    // Auxiliary textures are shared for the lifetime of the app.
    disposeMaterial(this.compositeMaterial);
    disposeMaterial(this.presentMaterial);
    this.compositeScene.clear();
    this.presentScene.clear();
  }
}

export function createSharedMilkdropFeedbackManager(
  width: number,
  height: number,
  behavior: MilkdropBackendBehavior,
) {
  return new SharedMilkdropFeedbackManager(width, height, behavior);
}
