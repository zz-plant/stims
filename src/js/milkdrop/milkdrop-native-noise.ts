import {
  DataTexture,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

export const MILKDROP_NOISE_2D_SIZE = 256;
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

export function buildMilkdropNoise2dData(size = MILKDROP_NOISE_2D_SIZE) {
  const data = new Uint8Array(size * size * 4);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = toNoiseByte(y + x * 57);
      data[offset++] = value;
      data[offset++] = value;
      data[offset++] = value;
      data[offset++] = 255;
    }
  }
  return data;
}

export function buildMilkdropNoiseVolumeAtlasData(
  sliceSize = MILKDROP_NOISE_VOLUME_ATLAS_SLICE_SIZE,
) {
  const gridSize = MILKDROP_NOISE_VOLUME_ATLAS_GRID_SIZE;
  const size = gridSize * sliceSize;
  const data = new Uint8Array(size * size * 4);
  for (let z = 0; z < gridSize * gridSize; z++) {
    const tileX = z % gridSize;
    const tileY = Math.floor(z / gridSize);
    for (let y = 0; y < sliceSize; y++) {
      for (let x = 0; x < sliceSize; x++) {
        const value = toNoiseByte(z + y * 57 + x * 141);
        const offset =
          ((tileY * sliceSize + y) * size + tileX * sliceSize + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
      }
    }
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
