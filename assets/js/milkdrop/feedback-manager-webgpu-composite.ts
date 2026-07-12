// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import type { Camera, Scene, Texture } from 'three';
import {
  Color,
  Data3DTexture,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  Vector2,
  Vector4,
} from 'three';
// @ts-expect-error - 'three/webgpu' is available at runtime but not under the repo's current moduleResolution.
import { RenderTarget, TSL } from 'three/webgpu';
import { getSharedMilkdropCapturedVideoTexture } from '../core/services/captured-video-texture.ts';
import { WEBGPU_MILKDROP_BACKEND_BEHAVIOR } from './backend-behavior';
import {
  AUX_TEXTURE_ATLAS_GRID_SIZE,
  AUX_TEXTURE_ATLAS_SLICE_COUNT,
} from './feedback-volume-sampling.ts';
import type { MilkdropFeedbackCompositeState } from './types';

const {
  Fn,
  atan,
  clamp,
  cos,
  floor,
  float,
  fract,
  length,
  mix,
  select,
  sin,
  step,
  texture,
  texture3D,
  uniform,
  vec2,
  vec3,
  vec4,
} = TSL;

export type CompositeUniformBag = Record<string, any>;

export type FeedbackRendererLike = {
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget: (target: RenderTarget | null) => void;
};

export const MILKDROP_TEXTURE_FILES = {
  noise: 'seamless_perlin_noise.png',
  perlin: 'seamless_perlin_noise.png',
  simplex: 'simplex_noise_3d.png',
  voronoi: 'voronoi_cellular.png',
  aura: 'colorful_aura_gradient.png',
  caustics: 'water_caustics.png',
  pattern: 'circuit_board_pattern.png',
  fractal: 'crystal_fractal.png',
} as const;

const AUX_TEXTURE_SPECS = {
  noise: { fileName: MILKDROP_TEXTURE_FILES.noise, colorTexture: false },
  perlin: { fileName: MILKDROP_TEXTURE_FILES.perlin, colorTexture: false },
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
type SharedAuxTextureName = AuxTextureName | 'video';
export type MilkdropCustomSamplerTextureBinding = {
  name: string;
  textureFile: string;
  texture: Texture;
};

const sharedMilkdropTextureCache = new Map<string, Texture>();
const milkdropTextureLoader = new TextureLoader();
const sharedMilkdropTexturePlaceholder = (() => {
  const textureValue = new DataTexture(
    new Uint8Array([128, 128, 128, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  textureValue.needsUpdate = true;
  return configureMilkdropTexture(textureValue);
})();

export function resolveTextureUrl(fileName: string) {
  const baseUrl =
    typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : '/';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}textures/${fileName}`;
}

export function configureMilkdropTexture(
  textureValue: Texture,
  colorTexture = false,
) {
  textureValue.wrapS = RepeatWrapping;
  textureValue.wrapT = RepeatWrapping;
  if (colorTexture) {
    textureValue.colorSpace = SRGBColorSpace;
  }
  return textureValue;
}

export function loadMilkdropTexture(fileName: string, colorTexture = false) {
  const loaded = milkdropTextureLoader.load(resolveTextureUrl(fileName));
  return configureMilkdropTexture(loaded, colorTexture);
}

export function getSharedMilkdropTexture(
  fileName: string,
  colorTexture = false,
) {
  const cacheKey = `${fileName}:${colorTexture ? 'srgb' : 'linear'}`;
  let textureValue = sharedMilkdropTextureCache.get(cacheKey);
  if (!textureValue) {
    textureValue = loadMilkdropTexture(fileName, colorTexture);
    sharedMilkdropTextureCache.set(cacheKey, textureValue);
  }
  return textureValue;
}

export function getSharedMilkdropTexturePlaceholder() {
  return sharedMilkdropTexturePlaceholder;
}

const sharedSimplex3DPlaceholder = (() => {
  const tex = new Data3DTexture(new Uint8Array([128]), 1, 1, 1);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.needsUpdate = true;
  return tex;
})();

export const MILKDROP_NOISE_VOLUME_SIZE = AUX_TEXTURE_ATLAS_SLICE_COUNT;
export function bindCustomMilkdropSamplerTexture(
  name: string,
  textureFile: string | null,
): MilkdropCustomSamplerTextureBinding | null {
  if (!textureFile) return null;
  return {
    name,
    textureFile,
    texture: getSharedMilkdropTexture(textureFile, true),
  };
}

let sharedSimplex3dTexture: Data3DTexture | null = null;
let sharedSimplexLoading: Promise<Data3DTexture> | null = null;

function getSliceSize(tex: Texture): number {
  const grid = AUX_TEXTURE_ATLAS_GRID_SIZE;
  const img = tex.image as { width?: number; height?: number } | null;
  return Math.floor(Math.min(img?.width ?? 256, img?.height ?? 256) / grid);
}

function buildSimplexVolumeData(
  source: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(64 * 64 * 64);
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const grid = AUX_TEXTURE_ATLAS_GRID_SIZE;
  const sliceSize = Math.floor(width / grid);
  const volumeSize = sliceSize * sliceSize * AUX_TEXTURE_ATLAS_SLICE_COUNT;
  const volume = new Uint8Array(volumeSize);
  for (let z = 0; z < AUX_TEXTURE_ATLAS_SLICE_COUNT; z++) {
    const gridY = Math.floor(z / grid);
    const gridX = z % grid;
    for (let y = 0; y < sliceSize; y++) {
      for (let x = 0; x < sliceSize; x++) {
        const srcIdx =
          ((gridY * sliceSize + y) * width + (gridX * sliceSize + x)) * 4;
        const dstIdx = z * sliceSize * sliceSize + y * sliceSize + x;
        volume[dstIdx] = imageData.data[srcIdx];
      }
    }
  }
  return volume;
}

export async function getSharedSimplex3dTexture(): Promise<Data3DTexture> {
  if (sharedSimplex3dTexture) return sharedSimplex3dTexture;
  if (sharedSimplexLoading) return sharedSimplexLoading;

  sharedSimplexLoading = new Promise<Data3DTexture>((resolve) => {
    const loader = new TextureLoader();
    const tex = loader.load(
      resolveTextureUrl(MILKDROP_TEXTURE_FILES.simplex),
      () => {
        const img = tex.image as HTMLImageElement | HTMLCanvasElement | null;
        if (!img) {
          resolve(
            getSharedMilkdropTexturePlaceholder() as unknown as Data3DTexture,
          );
          return;
        }
        const sliceSize = getSliceSize(tex);
        const imgWidth = 'width' in img ? (img.width as number) : 256;
        const imgHeight = 'height' in img ? (img.height as number) : 256;
        const volumeData = buildSimplexVolumeData(img, imgWidth, imgHeight);
        const volumeTex = new Data3DTexture(
          volumeData,
          sliceSize,
          sliceSize,
          AUX_TEXTURE_ATLAS_SLICE_COUNT,
        );
        volumeTex.format = RedFormat;
        volumeTex.type = UnsignedByteType;
        volumeTex.wrapS = RepeatWrapping;
        volumeTex.wrapT = RepeatWrapping;
        volumeTex.wrapR = RepeatWrapping;
        volumeTex.minFilter = LinearFilter;
        volumeTex.magFilter = LinearFilter;
        volumeTex.needsUpdate = true;
        sharedSimplex3dTexture = volumeTex;
        resolve(volumeTex);
      },
    );
  });
  return sharedSimplexLoading;
}

export function getSharedMilkdropAuxTextures() {
  return {
    noise: getSharedMilkdropTexturePlaceholder(),
    perlin: getSharedMilkdropTexturePlaceholder(),
    simplex: getSharedMilkdropTexture(MILKDROP_TEXTURE_FILES.simplex, false),
    voronoi: getSharedMilkdropTexturePlaceholder(),
    aura: getSharedMilkdropTexturePlaceholder(),
    caustics: getSharedMilkdropTexturePlaceholder(),
    pattern: getSharedMilkdropTexturePlaceholder(),
    fractal: getSharedMilkdropTexturePlaceholder(),
    video: getSharedMilkdropCapturedVideoTexture(),
  } satisfies Record<SharedAuxTextureName, Texture>;
}

export function resolveAuxTextureName(source: number) {
  if (source < 0.5) {
    return null;
  }
  if (source < 1.5) {
    return 'noise';
  }
  if (source < 2.5) {
    return 'simplex';
  }
  if (source < 3.5) {
    return 'voronoi';
  }
  if (source < 4.5) {
    return 'aura';
  }
  if (source < 5.5) {
    return 'caustics';
  }
  if (source < 6.5) {
    return 'pattern';
  }
  if (source < 7.5) {
    return 'fractal';
  }
  if (source < 8.5) {
    return null;
  }
  if (source < 9.5) {
    return 'perlin';
  }
  return null;
}

export function createFeedbackRenderTarget(
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

export function hasOverlayReplaceFeedback(
  state: MilkdropFeedbackCompositeState,
) {
  return (
    state.overlayTextureSource > 0.5 &&
    state.overlayTextureMode > 0.5 &&
    state.overlayTextureMode < 1.5
  );
}

export function hasOverlayBlendFeedback(state: MilkdropFeedbackCompositeState) {
  return (
    state.overlayTextureSource > 0.5 &&
    state.overlayTextureMode >= 1.5 &&
    Math.abs(state.overlayTextureAmount) > 0.0001
  );
}

export function hasWarpTextureFeedback(state: MilkdropFeedbackCompositeState) {
  return (
    state.warpTextureSource > 0.5 && Math.abs(state.warpTextureAmount) > 0.0001
  );
}

export function createCompositeUniforms(
  sceneTexture: Texture,
  previousTexture: Texture,
  auxTextures: Record<string, Texture>,
) {
  return {
    currentTex: texture(sceneTexture),
    previousTex: texture(previousTexture),
    noiseTex: texture(auxTextures.noise),
    perlinTex: texture(auxTextures.perlin),
    simplexTex: texture(auxTextures.simplex),
    simplexTex3D: texture3D(
      sharedSimplex3dTexture ?? sharedSimplex3DPlaceholder,
    ),
    voronoiTex: texture(auxTextures.voronoi),
    auraTex: texture(auxTextures.aura),
    causticsTex: texture(auxTextures.caustics),
    patternTex: texture(auxTextures.pattern),
    fractalTex: texture(auxTextures.fractal),
    videoTex: texture(auxTextures.video),
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
    vignette: uniform(0),
    chromaticAberration: uniform(0),
    tint: uniform(new Color(1, 1, 1)),
    // Seed the WebGPU path from its backend profile so feedback blur and
    // current-frame weighting stay in the same lane as the WebGPU renderer.
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
    signalBeatPulse: uniform(0),
    signalEnergy: uniform(0),
    signalTime: uniform(0),
    decay: uniform(0.98),
    texelSize: uniform(new Vector2(1, 1)),
    texsize: uniform(new Vector4(1, 1, 1, 1)),
    texsizeNoiseLq: uniform(new Vector4(256, 256, 1 / 256, 1 / 256)),
    texsizeNoiseHq: uniform(new Vector4(256, 256, 1 / 256, 1 / 256)),
    texsizeNoisevolHq: uniform(
      new Vector4(
        MILKDROP_NOISE_VOLUME_SIZE,
        MILKDROP_NOISE_VOLUME_SIZE,
        1 / MILKDROP_NOISE_VOLUME_SIZE,
        1 / MILKDROP_NOISE_VOLUME_SIZE,
      ),
    ),
  } satisfies CompositeUniformBag;
}

export function createSampleUvNode() {
  return Fn(([rawUv, wrapMode]: [any, any]) => {
    const clampedUv = clamp(rawUv, vec2(0), vec2(1));
    const wrappedUv = fract(rawUv);
    return mix(clampedUv, wrappedUv, step(0.5, wrapMode));
  });
}

export function createApplyFeedbackWarpNode() {
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

export function createSampleAuxTextureNode(
  noiseTexNode: ReturnType<typeof texture>,
  perlinTexNode: ReturnType<typeof texture>,
  simplexTexNode: ReturnType<typeof texture>,
  voronoiTexNode: ReturnType<typeof texture>,
  auraTexNode: ReturnType<typeof texture>,
  causticsTexNode: ReturnType<typeof texture>,
  patternTexNode: ReturnType<typeof texture>,
  fractalTexNode: ReturnType<typeof texture>,
  videoTexNode: ReturnType<typeof texture>,
  simplex3DTexNode: ReturnType<typeof texture3D>,
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
                  select(
                    source.lessThan(7.5),
                    fractalTexNode.sample(sampleUv),
                    select(
                      source.lessThan(8.5),
                      videoTexNode.sample(sampleUv),
                      select(
                        source.lessThan(9.5),
                        perlinTexNode.sample(sampleUv),
                        flat,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  });

  const atlasSliceUvNode = Fn(([sampleUv, sliceIndex]: [any, any]) => {
    const tileScale = float(1 / AUX_TEXTURE_ATLAS_GRID_SIZE);
    const localUv = mix(vec2(0.01), vec2(0.99), fract(sampleUv));
    const column = sliceIndex.sub(
      floor(sliceIndex.div(AUX_TEXTURE_ATLAS_GRID_SIZE)).mul(
        AUX_TEXTURE_ATLAS_GRID_SIZE,
      ),
    );
    const row = floor(sliceIndex.div(AUX_TEXTURE_ATLAS_GRID_SIZE));
    return vec2(column, row).add(localUv).mul(tileScale);
  });

  return Fn(
    ([source, sampleDimension, sampleUv, sliceZ]: [any, any, any, any]) => {
      const wrappedUv = fract(sampleUv);
      return select(
        sampleDimension.lessThan(0.5),
        sampleAuxTexture2dNode(source, wrappedUv),
        select(
          source.greaterThanEqual(1.5).and(source.lessThan(2.5)),
          simplex3DTexNode.sample(vec3(wrappedUv, fract(sliceZ))),
          (() => {
            const sliceCount = float(AUX_TEXTURE_ATLAS_SLICE_COUNT);
            const wrappedSlice = fract(sliceZ);
            const scaledSlice = wrappedSlice.mul(sliceCount);
            const lowerSlice = floor(scaledSlice);
            const upperSlice = lowerSlice
              .add(1)
              .sub(floor(lowerSlice.add(1).div(sliceCount)).mul(sliceCount));
            const blend = fract(scaledSlice);
            const lowerSample = sampleAuxTexture2dNode(
              source,
              atlasSliceUvNode(wrappedUv, lowerSlice),
            );
            const upperSample = sampleAuxTexture2dNode(
              source,
              atlasSliceUvNode(wrappedUv, upperSlice),
            );
            return mix(lowerSample, upperSample, blend);
          })(),
        ),
      );
    },
  );
}
