import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  startAudioLoop,
  getContextFrequencyData,
  AnimationContext,
} from '../core/animation-loop';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 20, z: 60 } },
  lightingOptions: {
    type: 'DirectionalLight',
    position: { x: 0, y: 40, z: 40 },
  },
  ambientLightOptions: { intensity: 0.5 },
} as ToyConfig);

const spheres: THREE.Mesh[] = [];

function init() {
  const { scene } = toy;
  const geometry = new THREE.SphereGeometry(3, 32, 32);
  for (let i = -4; i <= 4; i++) {
    const material = new THREE.MeshStandardMaterial({ color: 0xff6699 });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.x = i * 6;
    sphere.position.y = 0;
    scene.add(sphere);
    spheres.push(sphere);
  }
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const binsPerSphere = data.length / spheres.length;
  spheres.forEach((sphere, idx) => {
    const bin = Math.floor(idx * binsPerSphere);
    const value = data[bin] || 0;
    sphere.position.y = Math.sin(Date.now() / 300 + idx) * 2 + value / 64;
    (sphere.material as THREE.MeshStandardMaterial).color.setHSL(
      0.9 - value / 512,
      0.6,
      0.6
    );
  });
  ctx.toy.render();
}

async function startAudio() {
  try {
    await startAudioLoop(toy, animate, { fftSize: 128 });
    return true;
  } catch (e) {
    console.error('Microphone access denied', e);
    throw e;
  }
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
