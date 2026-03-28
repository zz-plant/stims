import { describe, expect, test } from 'bun:test';
import { initLighting } from '../assets/js/lighting/lighting-setup.ts';

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class BaseLight {
  position = new Vector3();
  set castShadow(_value) {}
}

class DirectionalLight extends BaseLight {}
class SpotLight extends BaseLight {}
class HemisphereLight extends BaseLight {}
class PointLight extends BaseLight {}

class Scene {
  children = [];

  add(light) {
    this.children.push(light);
  }
}

const lightingConstructors = {
  DirectionalLight,
  SpotLight,
  HemisphereLight,
  PointLight,
};

describe('initLighting', () => {
  test('uses default position values when position is omitted', () => {
    const scene = new Scene();

    initLighting(scene, { type: 'DirectionalLight' }, lightingConstructors);

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
      scene,
      { type: 'DirectionalLight', position: { y: 5 } },
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
      initLighting(scene, { type: 'HemisphereLight' }, lightingConstructors),
    ).not.toThrow();
    expect(scene.children[0]).toBeInstanceOf(HemisphereLight);
  });
});
