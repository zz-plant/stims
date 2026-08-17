// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import type { Camera, Scene, Texture } from 'three';
import {
  ClampToEdgeWrapping,
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
import {
  buildMilkdropNoiseVolumeAtlasData,
  createMilkdropNoiseTexture,
  createMilkdropNoiseVolumeAtlasTexture,
  MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE,
} from './milkdrop-native-noise.ts';
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

export { CUSTOM_TEXTURE_FILES, MILKDROP_TEXTURE_FILES } from './texture-files';

import {
  AUX_TEXTURE_SPECS,
  type AuxTextureName,
  configureMilkdropTexture,
  DEFAULT_TEXTURE_SAMPLE_MODE,
  getSharedMilkdropTexture,
  type MilkdropTextureSampleMode,
  resolveTextureUrl,
} from './feedback-texture-utils.ts';
import { CUSTOM_TEXTURE_FILES, MILKDROP_TEXTURE_FILES } from './texture-files';

export {
  configureMilkdropTexture,
  DEFAULT_TEXTURE_SAMPLE_MODE,
  getSharedMilkdropTexture,
  loadMilkdropTexture,
  type MilkdropTextureSampleMode,
  resolveAuxTextureName,
  resolveTextureUrl,
} from './feedback-texture-utils.ts';

export type MilkdropCustomSamplerTextureBinding = {
  name: string;
  textureFile: string;
  texture: Texture;
};

const sharedMilkdropNativeNoiseTexture = configureMilkdropTexture(
  createMilkdropNoiseTexture(),
);
const sharedMilkdropNativeNoiseVolumeAtlasTexture = configureMilkdropTexture(
  createMilkdropNoiseVolumeAtlasTexture(),
);
const sharedMilkdropTexturePlaceholder = sharedMilkdropNativeNoiseTexture;

export function getSharedMilkdropTexturePlaceholder() {
  return sharedMilkdropTexturePlaceholder;
}

const shared3DPlaceholderRed = (() => {
  const atlasData = buildMilkdropNoiseVolumeAtlasData();
  const sliceSize = MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE;
  const sliceCount = AUX_TEXTURE_ATLAS_SLICE_COUNT;
  const gridSize = AUX_TEXTURE_ATLAS_GRID_SIZE;
  const atlasSize = gridSize * sliceSize;
  const volumeData = new Uint8Array(sliceSize * sliceSize * sliceCount);

  for (let z = 0; z < sliceCount; z++) {
    const tileX = z % gridSize;
    const tileY = Math.floor(z / gridSize);
    for (let y = 0; y < sliceSize; y++) {
      for (let x = 0; x < sliceSize; x++) {
        const srcIdx =
          ((tileY * sliceSize + y) * atlasSize + tileX * sliceSize + x) * 4;
        const dstIdx = z * sliceSize * sliceSize + y * sliceSize + x;
        volumeData[dstIdx] = atlasData[srcIdx];
      }
    }
  }

  const tex = new Data3DTexture(volumeData, sliceSize, sliceSize, sliceCount);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.wrapR = RepeatWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
})();

const shared3DPlaceholderRGBA = (() => {
  const atlasData = buildMilkdropNoiseVolumeAtlasData();
  const sliceSize = MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE;
  const sliceCount = AUX_TEXTURE_ATLAS_SLICE_COUNT;
  const gridSize = AUX_TEXTURE_ATLAS_GRID_SIZE;
  const atlasSize = gridSize * sliceSize;
  const volumeData = new Uint8Array(sliceSize * sliceSize * sliceCount * 4);

  for (let z = 0; z < sliceCount; z++) {
    const tileX = z % gridSize;
    const tileY = Math.floor(z / gridSize);
    for (let y = 0; y < sliceSize; y++) {
      for (let x = 0; x < sliceSize; x++) {
        const srcIdx =
          ((tileY * sliceSize + y) * atlasSize + tileX * sliceSize + x) * 4;
        const dstIdx = (z * sliceSize * sliceSize + y * sliceSize + x) * 4;
        volumeData[dstIdx] = atlasData[srcIdx];
        volumeData[dstIdx + 1] = atlasData[srcIdx + 1];
        volumeData[dstIdx + 2] = atlasData[srcIdx + 2];
        volumeData[dstIdx + 3] = atlasData[srcIdx + 3];
      }
    }
  }

  const tex = new Data3DTexture(volumeData, sliceSize, sliceSize, sliceCount);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.wrapR = RepeatWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
})();

const shared2DPlaceholderRGBA = (() => {
  const data = new Uint8Array(4);
  const tex = new DataTexture(data, 1, 1, RGBAFormat, UnsignedByteType);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
})();

export const MILKDROP_NOISE_VOLUME_SIZE = AUX_TEXTURE_ATLAS_SLICE_COUNT;
export function bindCustomMilkdropSamplerTexture(
  name: string,
  textureFile: string | null,
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
): MilkdropCustomSamplerTextureBinding | null {
  if (!textureFile) return null;
  return {
    name,
    textureFile,
    texture: getSharedMilkdropTexture(textureFile, true, sampleMode),
  };
}

function getSliceSize(tex: Texture): number {
  const grid = AUX_TEXTURE_ATLAS_GRID_SIZE;
  const img = tex.image as { width?: number; height?: number } | null;
  return Math.floor(Math.min(img?.width ?? 256, img?.height ?? 256) / grid);
}

const shared3dTextureCache = new Map<string, Data3DTexture>();
const shared3dLoadingCache = new Map<string, Promise<Data3DTexture>>();

function buildAtlasVolumeData(
  source: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
  useRedChannel: boolean,
): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const grid = AUX_TEXTURE_ATLAS_GRID_SIZE;
  const sliceSize = Math.floor(width / grid);
  const voxelCount = sliceSize * sliceSize * AUX_TEXTURE_ATLAS_SLICE_COUNT;
  const channelCount = useRedChannel ? 1 : 4;
  const volume = new Uint8Array(voxelCount * channelCount);
  if (!ctx) return volume;
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  for (let z = 0; z < AUX_TEXTURE_ATLAS_SLICE_COUNT; z++) {
    const gridY = Math.floor(z / grid);
    const gridX = z % grid;
    for (let y = 0; y < sliceSize; y++) {
      for (let x = 0; x < sliceSize; x++) {
        const srcIdx =
          ((gridY * sliceSize + y) * width + (gridX * sliceSize + x)) * 4;
        const dstIdx =
          (z * sliceSize * sliceSize + y * sliceSize + x) * channelCount;
        if (useRedChannel) {
          volume[dstIdx] = imageData.data[srcIdx];
        } else {
          volume[dstIdx] = imageData.data[srcIdx];
          volume[dstIdx + 1] = imageData.data[srcIdx + 1];
          volume[dstIdx + 2] = imageData.data[srcIdx + 2];
          volume[dstIdx + 3] = imageData.data[srcIdx + 3];
        }
      }
    }
  }
  return volume;
}

export async function getShared3dTexture(
  fileName: string,
  useRedChannel: boolean,
  colorTexture: boolean,
): Promise<Data3DTexture> {
  const cacheKey = `${fileName}:${useRedChannel ? 'r' : 'rgba'}`;
  const existing = shared3dTextureCache.get(cacheKey);
  if (existing) return existing;
  const loading = shared3dLoadingCache.get(cacheKey);
  if (loading) return loading;

  const promise = new Promise<Data3DTexture>((resolve) => {
    const loader = new TextureLoader();
    const tex = loader.load(resolveTextureUrl(fileName), () => {
      const img = tex.image as HTMLImageElement | HTMLCanvasElement | null;
      if (!img) {
        resolve(
          (useRedChannel
            ? shared3DPlaceholderRed
            : shared3DPlaceholderRGBA) as Data3DTexture,
        );
        return;
      }
      const sliceSize = getSliceSize(tex);
      const imgWidth = 'width' in img ? (img.width as number) : 256;
      const imgHeight = 'height' in img ? (img.height as number) : 256;
      const volumeData = buildAtlasVolumeData(
        img,
        imgWidth,
        imgHeight,
        useRedChannel,
      );
      const volumeTex = new Data3DTexture(
        volumeData,
        sliceSize,
        sliceSize,
        AUX_TEXTURE_ATLAS_SLICE_COUNT,
      );
      volumeTex.format = useRedChannel ? RedFormat : RGBAFormat;
      volumeTex.type = UnsignedByteType;
      volumeTex.wrapS = RepeatWrapping;
      volumeTex.wrapT = RepeatWrapping;
      volumeTex.wrapR = RepeatWrapping;
      volumeTex.minFilter = LinearFilter;
      volumeTex.magFilter = LinearFilter;
      if (colorTexture) {
        volumeTex.colorSpace = SRGBColorSpace;
      }
      volumeTex.needsUpdate = true;
      shared3dTextureCache.set(cacheKey, volumeTex);
      resolve(volumeTex);
    });
  });
  shared3dLoadingCache.set(cacheKey, promise);
  return promise;
}

export async function getSharedSimplex3dTexture(): Promise<Data3DTexture> {
  return getShared3dTexture(MILKDROP_TEXTURE_FILES.simplex, false, false);
}

export function getShared3dAuxTexture(
  name: AuxTextureName,
): Promise<Data3DTexture> {
  if (name === 'simplex') {
    return getSharedSimplex3dTexture();
  }
  const spec = AUX_TEXTURE_SPECS[name];
  return getShared3dTexture(spec.fileName, false, spec.colorTexture);
}

export function getSharedMilkdropAuxTextures() {
  return {
    noise: sharedMilkdropNativeNoiseTexture,
    perlin: sharedMilkdropNativeNoiseTexture,
    simplex: sharedMilkdropNativeNoiseVolumeAtlasTexture,
    voronoi: getSharedMilkdropTexturePlaceholder(),
    aura: getSharedMilkdropTexturePlaceholder(),
    caustics: getSharedMilkdropTexturePlaceholder(),
    pattern: getSharedMilkdropTexturePlaceholder(),
    fractal: getSharedMilkdropTexturePlaceholder(),
    video: getSharedMilkdropCapturedVideoTexture(),
  } satisfies Record<AuxTextureName | 'video', Texture>;
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
    // This frame's internal image written by the feedback-blend pass; the
    // display-only composite pass reads it (rebound per frame by the manager).
    internalTex: texture(previousTexture),
    // MilkDrop's sampler_fc_main reads the warp output. The WebGPU pipeline
    // produces that image inside the feedback-blend pass, so warpTex aliases
    // the internal/warped frame (rebound per frame in render()).
    warpTex: texture(shared2DPlaceholderRGBA),
    noiseTex: texture(auxTextures.noise),
    perlinTex: texture(auxTextures.perlin),
    simplexTex: texture(auxTextures.simplex),
    voronoiTex: texture(auxTextures.voronoi),
    auraTex: texture(auxTextures.aura),
    causticsTex: texture(auxTextures.caustics),
    patternTex: texture(auxTextures.pattern),
    fractalTex: texture(auxTextures.fractal),
    videoTex: texture(auxTextures.video),
    glyphTex: texture(getSharedMilkdropTexture(CUSTOM_TEXTURE_FILES.glyph)),
    organicTex: texture(getSharedMilkdropTexture(CUSTOM_TEXTURE_FILES.organic)),
    // The WebGPU feedback pipeline runs a single gaussian blur pass; the
    // three blur samplers all read its output (rebound by the manager).
    // MilkDrop's progressive blur1→blur2→blur3 chain is not reproduced on
    // this backend, but the samplers resolve to a real texture instead of
    // the neutral fallback.
    blur1Tex: texture(shared2DPlaceholderRGBA),
    blur2Tex: texture(shared2DPlaceholderRGBA),
    blur3Tex: texture(shared2DPlaceholderRGBA),
    audioTex: texture(shared2DPlaceholderRGBA),
    noiseTex3D: texture3D(shared3DPlaceholderRGBA),
    perlinTex3D: texture3D(shared3DPlaceholderRGBA),
    simplexTex3D: texture3D(shared3DPlaceholderRed),
    voronoiTex3D: texture3D(shared3DPlaceholderRGBA),
    auraTex3D: texture3D(shared3DPlaceholderRGBA),
    causticsTex3D: texture3D(shared3DPlaceholderRGBA),
    patternTex3D: texture3D(shared3DPlaceholderRGBA),
    fractalTex3D: texture3D(shared3DPlaceholderRGBA),
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
    signalBassAtt: uniform(0),
    signalMid: uniform(0),
    signalMidAtt: uniform(0),
    signalTreb: uniform(0),
    signalTrebAtt: uniform(0),
    // Neutral defaults mirror the CPU VM (vm/shared.ts).
    signalPercussive: uniform(1),
    signalHarmonic: uniform(1),
    signalPercussiveLow: uniform(1),
    signalPercussiveMid: uniform(1),
    signalPercussiveHigh: uniform(1),
    signalPercussiveRatio: uniform(0.5),
    signalBeat: uniform(0),
    signalBeatPulse: uniform(0),
    signalEnergy: uniform(0),
    signalTime: uniform(0),
    signalFrame: uniform(0),
    signalFps: uniform(60),
    perPixelQ: Array.from({ length: 32 }, () => uniform(0)),
    perPixelT: Array.from({ length: 32 }, () => uniform(0)),
    aspect: uniform(new Vector4(1, 1, 1, 1)),
    decay: uniform(0.98),
    postBloomStrength: uniform(0),
    postBloomThreshold: uniform(0.85),
    postBloomRadius: uniform(0.5),
    postFilmGrainAmount: uniform(0),
    postChromaticAberration: uniform(0),
    postAfterimageDamp: uniform(0),
    texelSize: uniform(new Vector2(1, 1)),
    texsize: uniform(new Vector4(1, 1, 1, 1)),
    // Butterchurn bodies reference per-preset random constants as
    // rand_preset; the WebGL path rolls fresh values once per preset load.
    rand_preset: uniform(new Vector4(0, 0, 0, 0)),
    // Butterchurn shader bodies multiply blur samplers by scaleN/biasN
    // (derived from the preset's blur1_min/blur1_max … ranges). The WebGL
    // templates expose them as uniforms; mirror that so warp/comp statements
    // that reference them don't drop.
    scale1: uniform(1),
    bias1: uniform(0),
    scale2: uniform(1),
    bias2: uniform(0),
    scale3: uniform(1),
    bias3: uniform(0),
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
  glyphTexNode: ReturnType<typeof texture>,
  organicTexNode: ReturnType<typeof texture>,
  blur1TexNode: ReturnType<typeof texture>,
  blur2TexNode: ReturnType<typeof texture>,
  blur3TexNode: ReturnType<typeof texture>,
  tex3DNodes: {
    noise: ReturnType<typeof texture3D>;
    simplex: ReturnType<typeof texture3D>;
    voronoi: ReturnType<typeof texture3D>;
    aura: ReturnType<typeof texture3D>;
    caustics: ReturnType<typeof texture3D>;
    pattern: ReturnType<typeof texture3D>;
    fractal: ReturnType<typeof texture3D>;
    perlin: ReturnType<typeof texture3D>;
  },
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
                        select(
                          source.lessThan(12.5),
                          glyphTexNode.sample(sampleUv),
                          select(
                            source.lessThan(13.5),
                            organicTexNode.sample(sampleUv),
                            select(
                              source.lessThan(14.5),
                              blur1TexNode.sample(sampleUv),
                              select(
                                source.lessThan(15.5),
                                blur2TexNode.sample(sampleUv),
                                select(
                                  source.lessThan(16.5),
                                  blur3TexNode.sample(sampleUv),
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

  const atlasTrilinearSample = Fn(
    ([source, sampleUv, sliceZ]: [any, any, any]) => {
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
        atlasSliceUvNode(sampleUv, lowerSlice),
      );
      const upperSample = sampleAuxTexture2dNode(
        source,
        atlasSliceUvNode(sampleUv, upperSlice),
      );
      // Match the WebGL atlas path: snap to the pure slice inside the blend
      // margins so cross-slice color never bleeds near atlas seams.
      const edgeMargin = 0.02;
      const blended = mix(lowerSample, upperSample, blend);
      const snapLow = select(
        step(edgeMargin, blend),
        blended,
        lowerSample,
      );
      const snapHigh = select(
        step(float(1).sub(edgeMargin), blend),
        upperSample,
        snapLow,
      );
      return snapHigh;
    },
  );

  return Fn(
    ([source, sampleDimension, sampleUv, sliceZ]: [any, any, any, any]) => {
      const wrappedUv = fract(sampleUv);
      const wrappedZ = fract(sliceZ);
      const flat = vec4(0.5, 0.5, 0.5, 1);
      const native3dSample = select(
        source.lessThan(0.5),
        flat,
        select(
          source.lessThan(1.5),
          tex3DNodes.noise.sample(vec3(wrappedUv, wrappedZ)),
          select(
            source.lessThan(2.5),
            tex3DNodes.simplex.sample(vec3(wrappedUv, wrappedZ)),
            select(
              source.lessThan(3.5),
              tex3DNodes.voronoi.sample(vec3(wrappedUv, wrappedZ)),
              select(
                source.lessThan(4.5),
                tex3DNodes.aura.sample(vec3(wrappedUv, wrappedZ)),
                select(
                  source.lessThan(5.5),
                  tex3DNodes.caustics.sample(vec3(wrappedUv, wrappedZ)),
                  select(
                    source.lessThan(6.5),
                    tex3DNodes.pattern.sample(vec3(wrappedUv, wrappedZ)),
                    select(
                      source.lessThan(7.5),
                      tex3DNodes.fractal.sample(vec3(wrappedUv, wrappedZ)),
                      select(
                        source.lessThan(8.5),
                        flat,
                        select(
                          source.lessThan(9.5),
                          tex3DNodes.perlin.sample(vec3(wrappedUv, wrappedZ)),
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
      const isVideo = source.greaterThanEqual(7.5).and(source.lessThan(8.5));
      const isSimplex = source.greaterThanEqual(1.5).and(source.lessThan(2.5));
      return select(
        sampleDimension.lessThan(0.5),
        sampleAuxTexture2dNode(source, wrappedUv),
        select(
          isVideo.or(isSimplex),
          atlasTrilinearSample(source, wrappedUv, sliceZ),
          native3dSample,
        ),
      );
    },
  );
}
