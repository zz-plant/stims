// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import type { Camera, Scene, Texture } from 'three';
import {
  Color,
  HalfFloatType,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';
// @ts-expect-error - 'three/webgpu' is available at runtime but not under the repo's current moduleResolution.
import { RenderTarget, TSL } from 'three/webgpu';
import {
  WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from './backend-behavior';
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
  uniform,
  vec2,
  vec4,
} = TSL;

export type CompositeUniformBag = Record<string, any>;

export type FeedbackRendererLike = {
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget: (target: RenderTarget | null) => void;
};

export const MILKDROP_TEXTURE_FILES = {
  noise: 'seamless_perlin_noise.png',
  simplex: 'simplex_noise_3d.png',
  voronoi: 'voronoi_cellular.png',
  aura: 'colorful_aura_gradient.png',
  caustics: 'water_caustics.png',
  pattern: 'circuit_board_pattern.png',
  fractal: 'crystal_fractal.png',
} as const;

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
  const loaded = new TextureLoader().load(resolveTextureUrl(fileName));
  return configureMilkdropTexture(loaded, colorTexture);
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
    // Keep the feedback blur/boost seed aligned with the compatibility renderer.
    // Frame state does not overwrite these uniforms, so a backend-specific seed
    // would create a persistent visual drift even when both paths otherwise
    // receive the same composite state.
    feedbackSoftness: uniform(
      WEBGL_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile.feedbackSoftness,
    ),
    currentFrameBoost: uniform(
      WEBGL_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile.currentFrameBoost,
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
    const tileScale = float(1 / AUX_TEXTURE_ATLAS_GRID_SIZE);
    const column = sliceIndex.sub(
      floor(sliceIndex.div(AUX_TEXTURE_ATLAS_GRID_SIZE)).mul(
        AUX_TEXTURE_ATLAS_GRID_SIZE,
      ),
    );
    const row = floor(sliceIndex.div(AUX_TEXTURE_ATLAS_GRID_SIZE));
    return vec2(column, row).mul(tileScale).add(sampleUv.mul(tileScale));
  });

  return Fn(
    ([source, sampleDimension, sampleUv, sliceZ]: [any, any, any, any]) =>
      select(
        sampleDimension.lessThan(0.5),
        sampleAuxTexture2dNode(source, sampleUv),
        (() => {
          const clampedSlice = clamp(sliceZ, 0, 0.999999).mul(
            AUX_TEXTURE_ATLAS_SLICE_COUNT - 1,
          );
          const lowerSlice = floor(clampedSlice);
          const upperSlice = clamp(
            lowerSlice.add(1),
            0,
            AUX_TEXTURE_ATLAS_SLICE_COUNT - 1,
          );
          const blend = clampedSlice.sub(lowerSlice);
          const lowerSample = sampleAuxTexture2dNode(
            source,
            atlasSliceUvNode(sampleUv, lowerSlice),
          );
          const upperSample = sampleAuxTexture2dNode(
            source,
            atlasSliceUvNode(sampleUv, upperSlice),
          );
          return mix(lowerSample, upperSample, blend);
        })(),
      ),
  );
}
