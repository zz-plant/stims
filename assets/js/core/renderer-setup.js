// renderer-setup.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.module.js';
export function initRenderer(canvas, config = { antialias: true }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: config.antialias,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}
