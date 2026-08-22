import {
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

/**
 * projectM's own dimensions and data, not approximations of them.
 * PerlinNoise.hpp declares `noise_lq[256][256][3]` and `noise_lq_vol[32][32][32][3]`,
 * and PerlinNoise.cpp writes ONE scalar per texel and replicates it into all
 * three channels — the noise is grayscale. Ours was 512x512 with three
 * independent channels, which is why 260-compshader-noise_lq rendered smooth
 * coloured marbling where the reference is fine grey static.
 */
export const MILKDROP_NOISE_2D_SIZE = 256;
export const MILKDROP_NOISE_VOLUME_ATLAS_GRID_SIZE = 8;
export const MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE = 32;
export const MILKDROP_NOISE_VOLUME_ATLAS_SIZE =
  MILKDROP_NOISE_VOLUME_ATLAS_GRID_SIZE *
  MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE;

function milkdropNoiseHash(value: number) {
  const x = (Math.imul(value, 1) << 13) ^ value;
  const squared = Math.imul(x, x);
  const polynomial = Math.imul(squared, 15731) + 789221;
  return (Math.imul(x, polynomial) + 1376312589) & 0x7fffffff;
}

function toNoiseByte(value: number) {
  return Math.round((milkdropNoiseHash(value) / 2147483648) * 255);
}

let cachedNoise2dData: Uint8Array | null = null;
let cachedNoiseVolumeAtlasData: Uint8Array | null = null;

export function buildMilkdropNoise2dData(size = MILKDROP_NOISE_2D_SIZE) {
  if (size === MILKDROP_NOISE_2D_SIZE && cachedNoise2dData) {
    return cachedNoise2dData;
  }
  const data = new Uint8Array(size * size * 4);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // One scalar, replicated: PerlinNoise.cpp:13-20 writes noise[x][y][0]
      // and copies it into [1] and [2].
      const value = toNoiseByte(y + x * 57);
      data[offset++] = value;
      data[offset++] = value;
      data[offset++] = value;
      data[offset++] = 255;
    }
  }
  if (size === MILKDROP_NOISE_2D_SIZE) {
    cachedNoise2dData = data;
  }
  return data;
}

export function buildMilkdropNoiseVolumeAtlasData(
  sliceSize = MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE,
) {
  if (
    sliceSize === MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE &&
    cachedNoiseVolumeAtlasData
  ) {
    return cachedNoiseVolumeAtlasData;
  }
  const gridSize = MILKDROP_NOISE_VOLUME_ATLAS_GRID_SIZE;
  const size = gridSize * sliceSize;
  const data = new Uint8Array(size * size * 4);
  for (let z = 0; z < gridSize * gridSize; z++) {
    const tileX = z % gridSize;
    const tileY = Math.floor(z / gridSize);
    for (let y = 0; y < sliceSize; y++) {
      for (let x = 0; x < sliceSize; x++) {
        // Rows are laid out bottom-up within a tile: the atlas texture keeps
        // flipY off (flipping it would also reverse the tile bands the shader
        // indexes with floor(slice / grid)), so the inversion happens here.
        const sourceY = (sliceSize - 1 - y) & (sliceSize - 1);
        const value = toNoiseByte(z + sourceY * 57 + x * 141);
        const offset =
          ((tileY * sliceSize + y) * size + tileX * sliceSize + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
      }
    }
  }
  if (sliceSize === MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE) {
    cachedNoiseVolumeAtlasData = data;
  }
  return data;
}

export function createMilkdropNoiseTexture() {
  const texture = new DataTexture(
    buildMilkdropNoise2dData(),
    MILKDROP_NOISE_2D_SIZE,
    MILKDROP_NOISE_2D_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  // DataTexture defaults flipY to false while every PNG aux texture arrives
  // through TextureLoader with flipY true, and the comp shader samples both
  // through the same uv. Without this the noise is upside down relative to
  // every other aux texture — measured on the 260 reference: 81% mismatch
  // without, 0.0% with.
  texture.flipY = true;
  // The bytes are the values projectM stores, not a colour photograph, but
  // they travel the same path as every sRGB aux PNG and the renderer encodes
  // its output back to sRGB. Left as linear data, a mid-grey 127 comes out at
  // ~187 — measured on 260-compshader-noise_lq: mean 176.6 against a
  // reference mean of 127.7, with the contrast flattened (stdev 33.3 vs
  // 49.4). Tagging the texture sRGB makes the round trip an identity.
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createMilkdropNoiseVolumeAtlasTexture() {
  const texture = new DataTexture(
    buildMilkdropNoiseVolumeAtlasData(),
    MILKDROP_NOISE_VOLUME_ATLAS_SIZE,
    MILKDROP_NOISE_VOLUME_ATLAS_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
