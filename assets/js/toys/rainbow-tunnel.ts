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
  cameraOptions: { position: { x: 0, y: 0, z: 80 } },
  lightingOptions: { type: 'HemisphereLight' },
  ambientLightOptions: {},
} as ToyConfig);

const rings: THREE.Mesh[] = [];
let analyser: THREE.AudioAnalyser | null;

function init() {
  const geometry = new THREE.TorusGeometry(10, 3, 16, 100);
  for (let i = 0; i < 6; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: Math.random() * 0xffffff,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.position.z = -i * 20;
    toy.scene.add(ring);
    rings.push(ring);
  }
}

async function startAudio() {
  try {
    await toy.initAudio();
    analyser = toy.analyser;
    animate();
  } catch (e) {
    console.error('Microphone access denied', e);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const data = analyser ? getFrequencyData(analyser) : new Uint8Array(0);
  const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
  rings.forEach((ring, idx) => {
    ring.rotation.x += 0.01 + avg / 100000;
    ring.material.color.setHSL((idx / rings.length + avg / 512) % 1, 0.7, 0.5);
  });
  toy.camera.position.z -= 0.5 + avg / 50;
  if (toy.camera.position.z < -100) toy.camera.position.z = 80;
  toy.render();
}

init();
startAudio();
