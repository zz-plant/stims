// scene-setup.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.module.js';
export function initScene(config = { backgroundColor: 0x000000 }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.backgroundColor);
  return scene;
}
