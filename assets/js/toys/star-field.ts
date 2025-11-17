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
  cameraOptions: { position: { x: 0, y: 0, z: 50 } },
  lightingOptions: { type: 'PointLight', position: { x: 10, y: 20, z: 10 } },
  ambientLightOptions: {},
} as ToyConfig);

let stars: THREE.Points;
let starMaterial: THREE.PointsMaterial;
let analyser: THREE.AudioAnalyser | null;

function init() {
  const geometry = new THREE.BufferGeometry();
  const count = 1500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 400;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1 });
  stars = new THREE.Points(geometry, starMaterial);
  toy.scene.add(stars);
}

async function startAudio() {
  try {
    await toy.initAudio();
    analyser = toy.analyser;
    toy.renderer.setAnimationLoop(animate);
    return true;
  } catch (e) {
    console.error('Microphone access denied', e);
    throw e;
  }
}

function animate() {
  const data = analyser ? getFrequencyData(analyser) : new Uint8Array(0);
  const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
  stars.rotation.y += 0.001 + avg / 50000;
  const hue = (avg / 256) % 1;
  starMaterial.color.setHSL(hue, 0.8, 0.9);
  toy.render();
}

init();
(window as any).startAudio = startAudio;
