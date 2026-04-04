import { afterEach, describe, expect, mock, test } from 'bun:test';
import { TextureLoader } from 'three';
import {
  createMilkdropWebGPUFeedbackManager,
  resolveDirectShaderConstructorPattern,
  resolveDirectShaderSamplerBinding,
  resolveDirectShaderSwizzle,
} from '../assets/js/milkdrop/feedback-manager-webgpu.ts';
import { getSharedMilkdropAuxTextures } from '../assets/js/milkdrop/feedback-manager-webgpu-composite.ts';

afterEach(() => {
  mock.restore();
});

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
    expect(resolveDirectShaderSamplerBinding('sampler_video', '2d')).toEqual({
      canonicalSource: 'video',
      sourceId: 8,
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

  test('prefers explicit direct vector constructor arity over scalar splat fallbacks', () => {
    expect(
      resolveDirectShaderConstructorPattern('vec2', ['scalar', 'scalar']),
    ).toBe('vec2-pair');
    expect(
      resolveDirectShaderConstructorPattern('float2', ['scalar', 'scalar']),
    ).toBe('vec2-pair');
    expect(resolveDirectShaderConstructorPattern('vec2', ['scalar'])).toBe(
      'vec2-splat',
    );
    expect(
      resolveDirectShaderConstructorPattern('vec3', [
        'scalar',
        'scalar',
        'scalar',
      ]),
    ).toBe('vec3-triple');
    expect(
      resolveDirectShaderConstructorPattern('float3', [
        'scalar',
        'scalar',
        'scalar',
      ]),
    ).toBe('vec3-triple');
    expect(
      resolveDirectShaderConstructorPattern('vec3', ['vec2', 'scalar']),
    ).toBe('vec3-vec2-scalar');
    expect(
      resolveDirectShaderConstructorPattern('vec3', ['scalar', 'vec2']),
    ).toBe('vec3-scalar-vec2');
    expect(resolveDirectShaderConstructorPattern('vec3', ['scalar'])).toBe(
      'vec3-splat',
    );
  });

  test('reuses shared aux textures across WebGPU feedback manager instances', () => {
    const first = createMilkdropWebGPUFeedbackManager(640, 360) as unknown as {
      auxTextures: Record<string, unknown>;
      dispose: () => void;
    };
    const second = createMilkdropWebGPUFeedbackManager(640, 360) as unknown as {
      auxTextures: Record<string, unknown>;
      dispose: () => void;
    };

    expect(first.auxTextures.noise).toBe(second.auxTextures.noise);
    expect(first.auxTextures.aura).toBe(second.auxTextures.aura);
    expect(first.auxTextures.video).toBe(second.auxTextures.video);

    first.dispose();
    second.dispose();
  });

  test('does not eagerly load aux textures when a feedback manager is created', () => {
    const loadSpy = mock(TextureLoader.prototype.load);
    const manager = createMilkdropWebGPUFeedbackManager(640, 360) as {
      dispose: () => void;
    };

    try {
      expect(loadSpy).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
    }
  });

  test('does not dispose shared aux textures when a WebGPU feedback manager is torn down', () => {
    const sharedTextures = getSharedMilkdropAuxTextures();
    const originalDispose = sharedTextures.noise.dispose.bind(
      sharedTextures.noise,
    );
    let disposeCalls = 0;
    sharedTextures.noise.dispose = () => {
      disposeCalls += 1;
    };

    const manager = createMilkdropWebGPUFeedbackManager(640, 360) as {
      dispose: () => void;
    };

    try {
      manager.dispose();
      expect(disposeCalls).toBe(0);
    } finally {
      sharedTextures.noise.dispose = originalDispose;
    }
  });
});
