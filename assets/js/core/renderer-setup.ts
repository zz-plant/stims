import * as THREE from 'three';
import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';
import { ensureWebGL } from '../utils/webgl-check.ts';

export function initRenderer(
  canvas,
  config: { antialias?: boolean; exposure?: number } = {
    antialias: true,
    exposure: 1,
  }
) {
  if (!ensureWebGL()) {
    return null;
  }

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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.exposure ?? 1;
  return renderer;
}
