import * as THREE from 'three';

export type SceneConfig = {
  backgroundColor?: number;
};

export function initScene(config: SceneConfig = { backgroundColor: 0x000000 }) {
  const scene = new THREE.Scene();
  const backgroundColor = config.backgroundColor ?? 0x000000;
  scene.background = new THREE.Color(backgroundColor);
  return scene;
}
