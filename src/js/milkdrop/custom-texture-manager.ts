/**
 * Manages runtime texture overrides and custom user-uploaded textures for
 * preset sampler slots.
 *
 * Allows preset authors in the editor's Textures pane to remap any sampler
 * slot to another bundled texture or drag-and-drop a custom image file (PNG/JPEG)
 * directly onto a slot card, binding it to the sampler uniform on the running
 * stage without modifying static repository files.
 */

import { Texture } from 'three';
import {
  configureMilkdropTexture,
  DEFAULT_TEXTURE_SAMPLE_MODE,
  getSharedMilkdropTexture,
  type MilkdropTextureSampleMode,
  resolveTextureUrl,
} from './feedback-texture-utils.ts';

export type TextureSlotOverrideSource = 'bundled' | 'custom';

export interface TextureSlotOverride {
  source: TextureSlotOverrideSource;
  samplerName: string;
  fileName: string;
  texture: Texture;
  dimensions: { width: number; height: number };
  format: string;
  previewUrl: string;
}

export const BUNDLED_TEXTURE_OPTIONS = [
  { file: 'seamless_perlin_noise.png', label: 'Perlin noise' },
  { file: 'simplex_noise_3d.png', label: 'Simplex noise' },
  { file: 'voronoi_cellular.png', label: 'Voronoi cellular' },
  { file: 'colorful_aura_gradient.png', label: 'Colorful aura' },
  { file: 'water_caustics.png', label: 'Water caustics' },
  { file: 'circuit_board_pattern.png', label: 'Circuit board' },
  { file: 'crystal_fractal.png', label: 'Crystal fractal' },
  { file: 'glyph_matrix_tile.png', label: 'Glyph matrix' },
  { file: 'organic_mottle.png', label: 'Organic mottle' },
  { file: 'radial_rainbow_gradient.png', label: 'Radial rainbow' },
] as const;

export function normalizeSamplerSlotKey(samplerName: string): string {
  return samplerName.toLowerCase().replace(/^sampler_/u, '');
}

const slotOverrides = new Map<string, TextureSlotOverride>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('[stims] Error in texture override listener', error);
    }
  }
}

export function subscribeTextureOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTextureSlotOverride(
  samplerName: string,
): TextureSlotOverride | null {
  const key = normalizeSamplerSlotKey(samplerName);
  return slotOverrides.get(key) ?? null;
}

export function getAllTextureSlotOverrides(): ReadonlyMap<
  string,
  TextureSlotOverride
> {
  return slotOverrides;
}

export function setBundledSlotOverride(
  samplerName: string,
  bundledFileName: string,
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
): TextureSlotOverride {
  const key = normalizeSamplerSlotKey(samplerName);
  const texture = getSharedMilkdropTexture(bundledFileName, true, sampleMode);
  const matched = BUNDLED_TEXTURE_OPTIONS.find(
    (b) => b.file === bundledFileName,
  );
  const label = matched?.label ?? bundledFileName;

  const override: TextureSlotOverride = {
    source: 'bundled',
    samplerName: key,
    fileName: bundledFileName,
    texture,
    dimensions: { width: 512, height: 512 },
    format: `${label} (bundled PNG)`,
    previewUrl: resolveTextureUrl(bundledFileName),
  };

  slotOverrides.set(key, override);
  notifyListeners();
  return override;
}

export function createTextureFromImage(
  image: HTMLImageElement | ImageBitmap,
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
): Texture {
  const texture = new Texture(image);
  configureMilkdropTexture(texture, true, sampleMode);
  texture.needsUpdate = true;
  return texture;
}

export function setCustomImageSlotOverride(
  samplerName: string,
  image: HTMLImageElement | ImageBitmap,
  fileName: string,
  formatDescription = 'PNG (RGBA8)',
  previewUrl = '',
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
): TextureSlotOverride {
  const key = normalizeSamplerSlotKey(samplerName);
  const texture = createTextureFromImage(image, sampleMode);
  const width =
    'naturalWidth' in image && image.naturalWidth > 0
      ? image.naturalWidth
      : image.width;
  const height =
    'naturalHeight' in image && image.naturalHeight > 0
      ? image.naturalHeight
      : image.height;

  const override: TextureSlotOverride = {
    source: 'custom',
    samplerName: key,
    fileName,
    texture,
    dimensions: { width, height },
    format: formatDescription,
    previewUrl:
      previewUrl ||
      (typeof image === 'object' && 'src' in image
        ? (image.src as string)
        : ''),
  };

  slotOverrides.set(key, override);
  notifyListeners();
  return override;
}

export async function loadCustomImageFromFile(file: File | Blob): Promise<{
  image: HTMLImageElement;
  width: number;
  height: number;
  format: string;
  previewUrl: string;
}> {
  let dataUrl: string;
  if (typeof FileReader !== 'undefined') {
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    } catch {
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      dataUrl = `data:${file.type || 'image/png'};base64,${base64}`;
    }
  } else {
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    dataUrl = `data:${file.type || 'image/png'};base64,${base64}`;
  }

  return new Promise((resolve, reject) => {
    const ImageCtor =
      typeof Image !== 'undefined'
        ? Image
        : (globalThis as unknown as { Image: typeof Image }).Image;
    const img = new ImageCtor();
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.onload = () => {
      const formatName =
        file.type === 'image/jpeg'
          ? 'JPEG'
          : file.type === 'image/png'
            ? 'PNG'
            : file.type || 'Custom';
      resolve({
        image: img,
        width: img.naturalWidth || img.width || 512,
        height: img.naturalHeight || img.height || 512,
        format: `${formatName} (RGBA8)`,
        previewUrl: dataUrl,
      });
    };
    img.src = dataUrl;
  });
}

export function resetTextureSlotOverride(samplerName: string): boolean {
  const key = normalizeSamplerSlotKey(samplerName);
  const existed = slotOverrides.delete(key);
  if (existed) {
    notifyListeners();
  }
  return existed;
}

export function resetAllTextureSlotOverrides(): void {
  if (slotOverrides.size === 0) return;
  slotOverrides.clear();
  notifyListeners();
}

export function resolveEffectiveTexture(
  samplerName: string,
  fallbackFileName: string | null,
  colorTexture = true,
  sampleMode: MilkdropTextureSampleMode = DEFAULT_TEXTURE_SAMPLE_MODE,
): Texture | null {
  const override = getTextureSlotOverride(samplerName);
  if (override) {
    return override.texture;
  }
  if (!fallbackFileName) {
    return null;
  }
  return getSharedMilkdropTexture(fallbackFileName, colorTexture, sampleMode);
}
