import * as THREE from 'three';
import WebToy from '../core/web-toy';
import { getFrequencyData } from '../utils/audio-handler';
import { LightConfig, AmbientLightConfig } from '../lighting/lighting-setup';

interface ToyConfig {
  cameraOptions?: Record<string, unknown>;
  lightingOptions?: LightConfig;
  ambientLightOptions?: AmbientLightConfig;
}

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 20, z: 60 } },
  lightingOptions: {
    type: 'DirectionalLight',
    position: { x: 0, y: 40, z: 40 },
  },
  ambientLightOptions: { intensity: 0.5 },
} as ToyConfig);

const spheres: THREE.Mesh[] = [];
let analyser: THREE.AudioAnalyser | null;

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

async function startAudio() {
  try {
    await toy.initAudio({ fftSize: 128 });
    analyser = toy.analyser;
    toy.renderer.setAnimationLoop(animate);
  } catch (e) {
    console.error('Microphone access denied', e);
  }
}

function animate() {
  const data = analyser ? getFrequencyData(analyser) : new Uint8Array(0);
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
  toy.render();
}

init();
(window as any).startAudio = startAudio;
