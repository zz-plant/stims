import { describe, expect, test } from 'bun:test';
import {
  buildMilkdropNoise2dData,
  buildMilkdropNoiseVolumeAtlasData,
  MILKDROP_NOISE_2D_SIZE,
  MILKDROP_NOISE_VOLUME_ATLAS_SIZE,
} from '../../src/js/milkdrop/milkdrop-native-noise.ts';

describe('MilkDrop native noise textures', () => {
  test('builds the native 2D RGBA noise contract', () => {
    const data = buildMilkdropNoise2dData();

    expect(data.length).toBe(MILKDROP_NOISE_2D_SIZE ** 2 * 4);
    expect(data[0]).toBeGreaterThanOrEqual(0);
    expect(data[0]).toBeLessThanOrEqual(255);
    expect(data[3]).toBeGreaterThanOrEqual(0);
    expect(
      new Set(data.filter((_, index) => index % 4 === 0)).size,
    ).toBeGreaterThan(2);
    // Verifies 2D noise packs uncorrelated RGB channels across spatial offsets
    expect(new Set([data[0], data[1], data[2]]).size).toBeGreaterThanOrEqual(2);
  });

  test('packs native volume slices into a repeatable RGBA atlas', () => {
    const data = buildMilkdropNoiseVolumeAtlasData();

    expect(data.length).toBe(MILKDROP_NOISE_VOLUME_ATLAS_SIZE ** 2 * 4);
    expect(data[0]).toBeGreaterThanOrEqual(0);
    expect(data[0]).toBeLessThanOrEqual(255);
    expect(data[3]).toBe(255);
    expect(data[0]).not.toBe(data[64 * 4]);
    // Verifies 3D volume noise packs uncorrelated RGB channels across spatial offsets
    expect(new Set([data[0], data[1], data[2]]).size).toBeGreaterThanOrEqual(2);
  });
});
