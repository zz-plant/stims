import * as THREE from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { ensureWebGL } from '../utils/webgl-check.ts';

export function initRenderer(
  canvas,
  config: {
    antialias?: boolean;
    exposure?: number;
    maxPixelRatio?: number;
    alpha?: boolean;
  } = {
    antialias: true,
    exposure: 1,
    maxPixelRatio: 2,
    alpha: false,
  }
) {
  if (!ensureWebGL()) {
    return null;
  }

  const {
    antialias = true,
    exposure = 1,
    maxPixelRatio = 2,
    alpha = false,
  } = config;

  let renderer;
  if (navigator.gpu) {
    renderer = new WebGPURenderer({ canvas, antialias, alpha });
  } else {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias,
      alpha,
    });
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  return renderer;
}
