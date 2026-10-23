import { describe, expect, test } from 'bun:test';
import { type Color, Texture, type Vector2, type Vector4 } from 'three';
import {
  COMPOSITE_DETERMINISTIC_SHARED_NAMES,
  COMPOSITE_SHARED_UNIFORM_DEFAULTS,
  COMPOSITE_UNIFORM_BINDINGS,
  compositeSharedUniformDefaultsBag,
} from '../../src/js/milkdrop/feedback-composite-contract.ts';
import { applyCompositeUniformState } from '../../src/js/milkdrop/feedback-manager-shared.ts';
import { createCompositeUniforms } from '../../src/js/milkdrop/feedback-manager-webgpu-composite.ts';
import type { MilkdropFeedbackCompositeState } from '../../src/js/milkdrop/renderer-types.ts';

/**
 * Differential contract between the WebGL ShaderMaterial composite bag and
 * the WebGPU TSL composite bag. Both bags now read their shared deterministic
 * defaults from feedback-composite-contract.ts; this test proves the real
 * WebGPU bag (constructed through createCompositeUniforms) still binds every
 * shared uniform at the contract default, and that backend-only uniforms stay
 * on their own backend. A uniform added to one bag but not the other used to
 * read its neutral default silently; this test makes that a failure.
 */
describe('milkdrop composite uniform contract', () => {
  test('the contract table only declares known backends', () => {
    for (const [name, binding] of Object.entries(COMPOSITE_UNIFORM_BINDINGS)) {
      expect(['shared', 'webgl', 'webgpu'], name).toContain(binding);
    }
  });

  test('every deterministic shared default has a shared binding', () => {
    for (const name of COMPOSITE_DETERMINISTIC_SHARED_NAMES) {
      expect(
        COMPOSITE_UNIFORM_BINDINGS[name],
        `${name} has a deterministic default but is not shared`,
      ).toBe('shared');
    }
  });

  test('the shared defaults bag is stable and deterministic', () => {
    const bag = compositeSharedUniformDefaultsBag();
    expect(Object.keys(bag).sort()).toEqual(
      [...COMPOSITE_DETERMINISTIC_SHARED_NAMES].sort(),
    );
    // Two constructions agree: no per-call random, no shared mutable state.
    expect(compositeSharedUniformDefaultsBag()).toEqual(bag);
  });

  test('WebGPU bag binds every shared and webgpu uniform', () => {
    const aux = {
      noise: new Texture(),
      perlin: new Texture(),
      simplex: new Texture(),
      voronoi: new Texture(),
      aura: new Texture(),
      caustics: new Texture(),
      pattern: new Texture(),
      fractal: new Texture(),
      video: new Texture(),
    };
    const uniforms = createCompositeUniforms(new Texture(), new Texture(), aux);
    const bound = new Set(Object.keys(uniforms));

    for (const [name, binding] of Object.entries(COMPOSITE_UNIFORM_BINDINGS)) {
      if (binding === 'webgpu' || binding === 'shared') {
        expect(bound.has(name), `WebGPU bag is missing ${name}`).toBe(true);
      } else {
        expect(bound.has(name), `WebGL-only ${name} leaked into WebGPU`).toBe(
          false,
        );
      }
    }
  });

  test('WebGPU bag holds the shared deterministic defaults', () => {
    const aux = {
      noise: new Texture(),
      perlin: new Texture(),
      simplex: new Texture(),
      voronoi: new Texture(),
      aura: new Texture(),
      caustics: new Texture(),
      pattern: new Texture(),
      fractal: new Texture(),
      video: new Texture(),
    };
    const uniforms = createCompositeUniforms(
      new Texture(),
      new Texture(),
      aux,
    ) as unknown as Record<string, { value: unknown }>;

    for (const [name, expected] of Object.entries(
      COMPOSITE_SHARED_UNIFORM_DEFAULTS,
    )) {
      const node = uniforms[name];
      expect(node, `WebGPU bag has no ${name} node`).toBeDefined();
      const value = (node as { value: unknown }).value;
      if (typeof expected === 'number') {
        expect(value, name).toBe(expected);
      } else if (expected.length === 2) {
        const vector = value as Vector2;
        expect([vector.x, vector.y], name).toEqual([expected[0], expected[1]]);
      } else if (expected.length === 3) {
        const color = value as Color;
        expect([color.r, color.g, color.b], name).toEqual([
          expected[0],
          expected[1],
          expected[2],
        ]);
      } else {
        const vector = value as Vector4;
        expect([vector.x, vector.y, vector.z, vector.w], name).toEqual([
          expected[0],
          expected[1],
          expected[2],
          expected[3],
        ]);
      }
    }
  });

  test('the shared write path touches only shared names', () => {
    const bag = compositeSharedUniformDefaultsBag() as Record<
      string,
      { value: unknown }
    > & {
      videoEchoZoom?: { value: unknown };
      videoEchoOrientation?: { value: unknown };
    };
    // Run the shared per-frame write path over the contract bag and confirm
    // nothing it accesses is a backend-only uniform. Creation-time defaults
    // (aspect, texelSize, rand_preset, feedbackSoftness…) are not written per
    // frame, so they are expected to be absent from the access set.
    const accessed: string[] = [];
    const watched = new Proxy(bag, {
      get(target, prop: string) {
        if (typeof prop === 'string' && prop in target) accessed.push(prop);
        return Reflect.get(target, prop);
      },
    });
    applyCompositeUniformState(watched, minimalState(), blurRanges());
    for (const name of accessed) {
      expect(
        COMPOSITE_UNIFORM_BINDINGS[name],
        `write path touches non-shared ${name}`,
      ).toBe('shared');
    }
    // The per-frame controls are updated every frame, so they must be in the
    // access set; otherwise the bag is missing a uniform the state pushes.
    for (const name of [
      'scale1',
      'bias1',
      'videoEchoAlpha',
      'brighten',
      'darken',
      'gammaAdj',
      'textureWrap',
      'decay',
      'warpScale',
      'offsetX',
      'zoomMul',
      'saturation',
      'contrast',
      'colorScale',
      'hueShift',
      'tint',
      'overlayTextureSource',
      'warpTextureSource',
      'signalBass',
      'signalMid',
      'signalTreb',
      'signalBeat',
      'signalEnergy',
      'signalTime',
    ]) {
      expect(accessed.includes(name), `write path misses ${name}`).toBe(true);
    }
  });
});

function blurRanges(): readonly { scale: number; bias: number }[] {
  return [
    { scale: 1, bias: 0 },
    { scale: 1, bias: 0 },
    { scale: 1, bias: 0 },
  ];
}

function minimalState(): MilkdropFeedbackCompositeState {
  return {
    shaderExecution: 'controls',
    shaderPrograms: { warp: null, comp: null },
    mixAlpha: 0.18,
    videoEchoAlpha: 0,
    videoEchoZoom: 1,
    zoom: 1.02,
    videoEchoOrientation: 0,
    brighten: 0,
    darken: 0,
    darkenCenter: 0,
    solarize: 0,
    invert: 0,
    gammaAdj: 1,
    textureWrap: 0,
    feedbackTexture: 0,
    warpScale: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    zoomMul: 1,
    saturation: 1,
    contrast: 1,
    colorScale: { r: 1, g: 1, b: 1 },
    hueShift: 0,
    brightenBoost: 0,
    invertBoost: 0,
    solarizeBoost: 0,
    vignette: 0,
    chromaticAberration: 0,
    tint: { r: 1, g: 1, b: 1 },
    overlayTextureSource: 0,
    overlayTextureMode: 0,
    overlayTextureSampleDimension: 0,
    overlayTextureInvert: 0,
    overlayTextureAmount: 0,
    overlayTextureScale: { x: 1, y: 1 },
    overlayTextureOffset: { x: 0, y: 0 },
    overlayTextureVolumeSliceZ: 0,
    warpTextureSource: 0,
    warpTextureSampleDimension: 0,
    warpTextureAmount: 0,
    warpTextureScale: { x: 1, y: 1 },
    warpTextureOffset: { x: 0, y: 0 },
    warpTextureVolumeSliceZ: 0,
    signalBass: 0,
    signalMid: 0,
    signalTreb: 0,
    signalBeat: 0,
    signalBeatPulse: 0,
    signalEnergy: 0,
    signalTime: 0,
    aspect: 1,
    decay: 0.98,
    feedbackSoftness: 0,
  };
}
