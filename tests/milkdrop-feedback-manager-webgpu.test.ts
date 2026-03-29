import { describe, expect, test } from 'bun:test';
import {
  resolveDirectShaderSamplerBinding,
  resolveDirectShaderSwizzle,
} from '../assets/js/milkdrop/feedback-manager-webgpu.ts';

describe('milkdrop webgpu feedback manager helpers', () => {
  test('normalizes direct shader sampler aliases onto canonical runtime bindings', () => {
    expect(
      resolveDirectShaderSamplerBinding('sampler_fw_noise_lq', '2d'),
    ).toEqual({
      canonicalSource: 'noise',
      sourceId: 1,
    });
    expect(
      resolveDirectShaderSamplerBinding('sampler_fw_noisevol_lq', '3d'),
    ).toEqual({
      canonicalSource: 'simplex',
      sourceId: 2,
    });
    expect(resolveDirectShaderSamplerBinding('sampler_perlin', '2d')).toEqual({
      canonicalSource: 'perlin',
      sourceId: 1,
    });
    expect(resolveDirectShaderSamplerBinding('sampler_main', '2d')).toEqual({
      canonicalSource: 'main',
      sourceId: 0,
    });
    expect(
      resolveDirectShaderSamplerBinding('sampler_fw_noisevol_lq', '2d'),
    ).toEqual({
      canonicalSource: 'simplex',
      sourceId: 2,
    });
    expect(resolveDirectShaderSamplerBinding('sampler_noise', '3d')).toBeNull();
    expect(resolveDirectShaderSamplerBinding('sampler_main', '3d')).toBeNull();
  });

  test('supports broader direct shader swizzles for vec2 and vec3 values', () => {
    expect(resolveDirectShaderSwizzle('vec2', 'yx')).toEqual({
      kind: 'vec2',
      components: ['y', 'x'],
    });
    expect(resolveDirectShaderSwizzle('vec2', 'rr')).toEqual({
      kind: 'vec2',
      components: ['x', 'x'],
    });
    expect(resolveDirectShaderSwizzle('vec3', 'bgr')).toEqual({
      kind: 'vec3',
      components: ['z', 'y', 'x'],
    });
    expect(resolveDirectShaderSwizzle('vec3', 'xz')).toEqual({
      kind: 'vec2',
      components: ['x', 'z'],
    });
    expect(resolveDirectShaderSwizzle('vec3', 'g')).toEqual({
      kind: 'scalar',
      components: ['y'],
    });
    expect(resolveDirectShaderSwizzle('vec2', 'z')).toBeNull();
    expect(resolveDirectShaderSwizzle('vec3', 'xyzw')).toBeNull();
  });

  test('keeps only unique direct shader swizzles valid for assignment targets', () => {
    const xy = resolveDirectShaderSwizzle('vec2', 'yx');
    expect(xy).toEqual({
      kind: 'vec2',
      components: ['y', 'x'],
    });
    expect(new Set(xy?.components ?? []).size).toBe(xy?.components.length ?? 0);

    const rgb = resolveDirectShaderSwizzle('vec3', 'bgr');
    expect(rgb).toEqual({
      kind: 'vec3',
      components: ['z', 'y', 'x'],
    });
    expect(new Set(rgb?.components ?? []).size).toBe(
      rgb?.components.length ?? 0,
    );

    const duplicate = resolveDirectShaderSwizzle('vec3', 'rr');
    expect(duplicate).toEqual({
      kind: 'vec2',
      components: ['x', 'x'],
    });
    expect(new Set(duplicate?.components ?? []).size).toBeLessThan(
      duplicate?.components.length ?? 0,
    );
  });
});
