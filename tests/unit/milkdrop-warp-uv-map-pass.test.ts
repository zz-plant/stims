import { describe, expect, test } from 'bun:test';
import { PerspectiveCamera, Scene } from 'three';
import { parseURLParams } from '../../src/js/core/url-params.ts';
import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from '../../src/js/milkdrop/backend-behavior.ts';
import { createSharedMilkdropFeedbackManager } from '../../src/js/milkdrop/feedback-manager-shared.ts';

/**
 * Which passes a WebGL per-pixel warp takes. The UV map has to be drawn before
 * the warp reads it, and the warp has to read it: a warp drawn from the scatter
 * mesh covers only the screen its vertices land on, and on
 * krash-rovastar-cerebral-demons-stars that is about 4%.
 */
type Manager = {
  setWarpField: (field: unknown) => void;
  render: (renderer: unknown, scene: Scene, camera: unknown) => boolean;
  dispose: () => void;
  warpScene: Scene;
  warpMeshScene: Scene;
  warpUvScene: Scene;
  warpUvSampleScene: Scene;
  warpUvTarget: unknown;
  warpTarget: unknown;
  warpMaterial: { uniforms: { hasDirectWarp: { value: number } } };
};

const field = {
  density: 2,
  positions: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
  sampleUvs: new Float32Array([0.1, 0, 1, 0, 0, 1, 1, 1]),
  indices: new Uint32Array([0, 2, 1, 1, 2, 3]),
};

function renderOneFrame(
  extensions: string[],
  { warpShader = false, withField = true } = {},
) {
  const manager = createSharedMilkdropFeedbackManager(
    64,
    36,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as unknown as Manager;
  if (withField) manager.setWarpField(field);
  manager.warpMaterial.uniforms.hasDirectWarp.value = warpShader ? 1 : 0;
  const passes: Array<{ scene: unknown; target: unknown }> = [];
  let target: unknown = null;
  manager.render(
    {
      extensions: { has: (name: string) => extensions.includes(name) },
      setRenderTarget: (next: unknown) => {
        target = next;
      },
      getRenderTarget: () => target,
      render: (scene: unknown) => passes.push({ scene, target }),
      clear: () => {},
    },
    new Scene(),
    new PerspectiveCamera(),
  );
  const drew = (scene: unknown) =>
    passes.findIndex((pass) => pass.scene === scene);
  const result = {
    uvMap: drew(manager.warpUvScene),
    sample: drew(manager.warpUvSampleScene),
    mesh: drew(manager.warpMeshScene),
    uniform: drew(manager.warpScene),
    uvMapTarget: passes[drew(manager.warpUvScene)]?.target,
    sampleTarget: passes[drew(manager.warpUvSampleScene)]?.target,
    warpUvTarget: manager.warpUvTarget,
    warpTarget: manager.warpTarget,
  };
  manager.dispose();
  return result;
}

const FLOAT = ['EXT_color_buffer_float'];

describe('WebGL per-pixel warp passes', () => {
  test('draws the UV map, then reads the previous frame through it', () => {
    const passes = renderOneFrame(FLOAT);
    expect(passes.uvMap).toBeGreaterThanOrEqual(0);
    expect(passes.sample).toBeGreaterThan(passes.uvMap);
    expect(passes.uvMapTarget).toBe(passes.warpUvTarget);
    expect(passes.sampleTarget).toBe(passes.warpTarget);
    expect(passes.mesh).toBe(-1);
    expect(passes.uniform).toBe(-1);
  });

  test('falls back to the scatter mesh without a renderable float target', () => {
    const passes = renderOneFrame([]);
    expect(passes.mesh).toBeGreaterThanOrEqual(0);
    expect(passes.uvMap).toBe(-1);
    expect(passes.sample).toBe(-1);
  });

  test('a half-float-only device can still draw the map', () => {
    const passes = renderOneFrame(['EXT_color_buffer_half_float']);
    expect(passes.sample).toBeGreaterThanOrEqual(0);
  });

  test('a warp shader reads the map itself', () => {
    const passes = renderOneFrame(FLOAT, { warpShader: true });
    expect(passes.uvMap).toBeGreaterThanOrEqual(0);
    expect(passes.uniform).toBeGreaterThan(passes.uvMap);
    expect(passes.sample).toBe(-1);
  });

  test('a preset with no field keeps the uniform warp', () => {
    const passes = renderOneFrame(FLOAT, { withField: false });
    expect(passes.uniform).toBeGreaterThanOrEqual(0);
    expect(passes.uvMap).toBe(-1);
    expect(passes.sample).toBe(-1);
  });
});

describe('?warpUvMap', () => {
  test.each([
    ['', true],
    ['?warpUvMap=1', true],
    ['?warpUvMap=0', false],
  ])('%s reads as %s', (search, expected) => {
    expect(
      parseURLParams(new URLSearchParams(search)).performance.warpUvMap,
    ).toBe(expected);
  });
});
