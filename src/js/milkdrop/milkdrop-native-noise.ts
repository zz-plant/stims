import {
  DataTexture,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

export const MILKDROP_NOISE_2D_SIZE = 512;
export const MILKDROP_NOISE_VOLUME_ATLAS_GRID_SIZE = 8;
export const MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE = 64;
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
      const valR = toNoiseByte(y + x * 57);
      const valG = toNoiseByte(y * 131 + x * 59 + 17);
      const valB = toNoiseByte(y * 97 + x * 173 + 31);
      const valA = toNoiseByte(y * 233 + x * 109 + 47);
      data[offset++] = valR;
      data[offset++] = valG;
      data[offset++] = valB;
      data[offset++] = valA;
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
        const valR = toNoiseByte(z + y * 57 + x * 141);
        const valG = toNoiseByte(z + y * 131 + x * 59 + 17);
        const valB = toNoiseByte(z + y * 97 + x * 173 + 31);
        const offset =
          ((tileY * sliceSize + y) * size + tileX * sliceSize + x) * 4;
        data[offset] = valR;
        data[offset + 1] = valG;
        data[offset + 2] = valB;
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
  texture.needsUpdate = true;
  return texture;
}
