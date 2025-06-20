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
  cameraOptions: { position: { x: 0, y: 0, z: 60 } },
  lightingOptions: {
    type: 'PointLight',
    position: { x: 20, y: 20, z: 20 },
  },
  ambientLightOptions: {},
} as ToyConfig);

let particles: THREE.Points;
let particlesMaterial: THREE.PointsMaterial;
let analyser: AnalyserNode | null;

function init() {
  const scene = toy.scene;
  const particlesGeometry = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 80;
  }
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particlesMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5 });
  particles = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particles);
}

async function startAudio() {
  try {
    await toy.initAudio({ fftSize: 256 });
    analyser = toy.analyser;
    toy.renderer.setAnimationLoop(animate);
  } catch (e) {
    console.error('Microphone access denied', e);
  }
}

function animate() {
  const data = analyser ? getFrequencyData(analyser) : new Uint8Array(0);
  const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
  const rotationSpeed = 0.001 + avg / 100000;
  particles.rotation.y += rotationSpeed;
  particles.rotation.x += rotationSpeed / 2;

  particlesMaterial.size = 1.5 + avg / 50;
  const hue = (avg / 256) % 1;
  particlesMaterial.color.setHSL(hue, 0.7, 0.6);

  toy.render();
}

init();
startAudio();
