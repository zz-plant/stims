import { describe, expect, it } from '@jest/globals';
import * as THREE from 'three';
import { initLighting } from '../assets/js/lighting/lighting-setup';

const { DirectionalLight, HemisphereLight, Scene } = THREE;

describe('initLighting', () => {
  it('uses default position values when position is omitted', () => {
    const scene = new Scene();

    initLighting(scene, { type: 'DirectionalLight' });

    expect(scene.children).toHaveLength(1);
    const light = scene.children[0];
    expect(light).toBeInstanceOf(DirectionalLight);
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(10);
    expect(light.position.z).toBe(10);
  });

  it('merges partial position values with defaults', () => {
    const scene = new Scene();

    initLighting(scene, { type: 'DirectionalLight', position: { y: 5 } });

    const light = scene.children[0];
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(5);
    expect(light.position.z).toBe(10);
  });

  it('does not require a position for non-positional lights', () => {
    const scene = new Scene();

    expect(() =>
      initLighting(scene, { type: 'HemisphereLight' })
    ).not.toThrow();
    expect(scene.children[0]).toBeInstanceOf(HemisphereLight);
  });
});
