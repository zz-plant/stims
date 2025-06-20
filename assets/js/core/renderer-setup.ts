import * as THREE from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';

export function initRenderer(canvas, config = { antialias: true }) {
  let renderer;
  if (navigator.gpu) {
    renderer = new WebGPURenderer({ canvas, antialias: config.antialias });
  } else {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: config.antialias,
    });
  }
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}
