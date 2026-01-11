import { beforeAll, describe, expect, test } from 'bun:test';

let initLighting;
let stubLighting;
let Scene;

beforeAll(async () => {
  ({ initLighting } = await import('../assets/js/lighting/lighting-setup.ts'));
  ({ Scene, ...stubLighting } = await import('./three-stub.ts'));
});

describe('initLighting', () => {
  test('uses default position values when position is omitted', () => {
    const scene = new Scene();

    initLighting(scene, { type: 'DirectionalLight' }, stubLighting);

    expect(scene.children).toHaveLength(1);
    const light = scene.children[0];
    expect(light).toBeInstanceOf(stubLighting.DirectionalLight);
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(10);
    expect(light.position.z).toBe(10);
  });

  test('merges partial position values with defaults', () => {
    const scene = new Scene();

    initLighting(
      scene,
      { type: 'DirectionalLight', position: { y: 5 } },
      stubLighting,
    );

    const light = scene.children[0];
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(5);
    expect(light.position.z).toBe(10);
  });

  test('does not require a position for non-positional lights', () => {
    const scene = new Scene();

    expect(() =>
      initLighting(scene, { type: 'HemisphereLight' }, stubLighting),
    ).not.toThrow();
    expect(scene.children[0]).toBeInstanceOf(stubLighting.HemisphereLight);
  });
});
