import { describe, expect, test } from 'bun:test';
import { initLighting } from '../../src/js/lighting/lighting-setup.ts';

class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class BaseLight {
  position = new Vector3();
  set castShadow(_value: boolean) {}
}

class DirectionalLight extends BaseLight {}
class SpotLight extends BaseLight {}
class HemisphereLight extends BaseLight {}
class PointLight extends BaseLight {}

class Scene {
  children: BaseLight[] = [];

  add(light: BaseLight) {
    this.children.push(light);
    return this;
  }
}

const lightingConstructors = {
  DirectionalLight:
    DirectionalLight as unknown as typeof import('three').DirectionalLight,
  SpotLight: SpotLight as unknown as typeof import('three').SpotLight,
  HemisphereLight:
    HemisphereLight as unknown as typeof import('three').HemisphereLight,
  PointLight: PointLight as unknown as typeof import('three').PointLight,
};

describe('initLighting', () => {
  test('uses default position values when position is omitted', () => {
    const scene = new Scene();

    initLighting(
      scene as unknown as Parameters<typeof initLighting>[0],
      { type: 'DirectionalLight' },
      lightingConstructors,
    );

    expect(scene.children).toHaveLength(1);
    const light = scene.children[0];
    expect(light).toBeInstanceOf(DirectionalLight);
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(10);
    expect(light.position.z).toBe(10);
  });

  test('merges partial position values with defaults', () => {
    const scene = new Scene();

    initLighting(
      scene as unknown as Parameters<typeof initLighting>[0],
      {
        type: 'DirectionalLight',
        position: { y: 5 } as unknown as { x: number; y: number; z: number },
      },
      lightingConstructors,
    );

    const light = scene.children[0];
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(5);
    expect(light.position.z).toBe(10);
  });

  test('does not require a position for non-positional lights', () => {
    const scene = new Scene();

    expect(() =>
      initLighting(
        scene as unknown as Parameters<typeof initLighting>[0],
        { type: 'HemisphereLight' },
        lightingConstructors,
      ),
    ).not.toThrow();
    expect(scene.children[0]).toBeInstanceOf(HemisphereLight);
  });
});
