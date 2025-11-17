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
  cameraOptions: { position: { x: 0, y: 0, z: 100 } },
  lightingOptions: { type: 'HemisphereLight' },
  ambientLightOptions: {},
} as ToyConfig);

const lines: THREE.Line[] = [];
let analyser: THREE.AudioAnalyser | null;

function init() {
  const { scene } = toy;
  for (let i = 0; i < 50; i++) {
    const geometry = new THREE.BufferGeometry();
    const points = [];
    for (let j = 0; j < 30; j++) {
      const angle = j * 0.2 + i * 0.1;
      const radius = j * 0.5 + i;
      points.push(
        new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, j)
      );
    }
    geometry.setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: Math.random() * 0xffffff,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    lines.push(line);
  }
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
  const binsPerLine = data.length / lines.length;
  lines.forEach((line, idx) => {
    const bin = Math.floor(idx * binsPerLine);
    const value = data[bin] || avg;
    line.rotation.z += 0.002 + value / 100000;
    line.rotation.x += 0.001 + idx / 10000;
    const scale = 1 + value / 256;
    line.scale.set(scale, scale, scale);
    const hue = (idx / lines.length + value / 512) % 1;
    line.material.color.setHSL(hue, 0.6, 0.5);
  });
  toy.render();
}

init();
(window as any).startAudio = startAudio;
