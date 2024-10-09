// scene-setup.js
export function initScene(config = { backgroundColor: 0x000000 }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.backgroundColor);
  return scene;
}
