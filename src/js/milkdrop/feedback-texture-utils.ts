import type { Texture } from 'three';
import {
  ClampToEdgeWrapping,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
} from 'three';
import { MILKDROP_TEXTURE_FILES } from './texture-files';

/**
 * Shared texture loading/configuration used by both the WebGL
 * (feedback-manager-shared.ts) and WebGPU (feedback-manager-webgpu-composite.ts)
 * feedback managers. The per-manager placeholder/noise textures stay local to
 * each manager; only the byte-identical spec table, sample-mode contract,
 * URL resolution and loader cache live here so the two paths cannot drift.
 */

export const AUX_TEXTURE_SPECS = {
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

export type AuxTextureName = keyof typeof AUX_TEXTURE_SPECS;

export type MilkdropTextureSampleMode = {
  filter: 'linear' | 'nearest';
  wrap: 'repeat' | 'clamp';
};

// Must be initialized before any placeholder-texture IIFE reads it as a
// default parameter at module load.
export const DEFAULT_TEXTURE_SAMPLE_MODE: MilkdropTextureSampleMode = {
  filter: 'linear',
  wrap: 'repeat',
};

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
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
) {
  const wrapMode =
    sampleMode.wrap === 'clamp' ? ClampToEdgeWrapping : RepeatWrapping;
  textureValue.wrapS = wrapMode;
  textureValue.wrapT = wrapMode;
  if (sampleMode.filter === 'nearest') {
    textureValue.minFilter = NearestFilter;
    textureValue.magFilter = NearestFilter;
  }
  if (colorTexture) {
    textureValue.colorSpace = SRGBColorSpace;
  }
  return textureValue;
}

const sharedMilkdropTextureCache = new Map<string, Texture>();
const milkdropTextureLoader = new TextureLoader();

export function loadMilkdropTexture(
  fileName: string,
  colorTexture = false,
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
) {
  const loaded = milkdropTextureLoader.load(resolveTextureUrl(fileName));
  return configureMilkdropTexture(loaded, colorTexture, sampleMode);
}

export function getSharedMilkdropTexture(
  fileName: string,
  colorTexture = false,
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
) {
  const cacheKey = `${fileName}:${colorTexture ? 'srgb' : 'linear'}:${sampleMode.filter}:${sampleMode.wrap}`;
  let textureValue = sharedMilkdropTextureCache.get(cacheKey);
  if (!textureValue) {
    textureValue = loadMilkdropTexture(fileName, colorTexture, sampleMode);
    sharedMilkdropTextureCache.set(cacheKey, textureValue);
  }
  return textureValue;
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
