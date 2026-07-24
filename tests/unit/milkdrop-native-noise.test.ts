import { describe, expect, test } from 'bun:test';
import {
  buildMilkdropNoise2dData,
  buildMilkdropNoiseVolumeAtlasData,
  MILKDROP_NOISE_2D_SIZE,
  MILKDROP_NOISE_VOLUME_ATLAS_SIZE,
} from '../../assets/js/milkdrop/milkdrop-native-noise.ts';

describe('MilkDrop native noise textures', () => {
  test('builds the native 2D RGBA noise contract', () => {
    const data = buildMilkdropNoise2dData();

    expect(data.length).toBe(MILKDROP_NOISE_2D_SIZE ** 2 * 4);
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    expect(data[3]).toBe(255);
    expect(
      new Set(data.filter((_, index) => index % 4 === 0)).size,
    ).toBeGreaterThan(2);
    // projectM fills a C array declared as [x][y][rgba] and uploads its
    // contiguous storage directly. OpenGL therefore observes Y as the
    // fastest-changing texture coordinate.
    expect(data[4]).toBe(101);
  });

  test('packs native volume slices into a repeatable RGBA atlas', () => {
    const data = buildMilkdropNoiseVolumeAtlasData();

    expect(data.length).toBe(MILKDROP_NOISE_VOLUME_ATLAS_SIZE ** 2 * 4);
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    expect(data[3]).toBe(255);
    expect(data[0]).not.toBe(data[64 * 4]);
    // The source volume is [x][y][z][rgba], so its Z coordinate becomes the
    // fastest-changing X coordinate in the uploaded 3D texture.
    expect(data[4]).toBe(159);
  });
});
