import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  startAudioLoop,
  getContextFrequencyData,
  AnimationContext,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 50 } },
  lightingOptions: { type: 'PointLight', position: { x: 10, y: 20, z: 10 } },
  ambientLightOptions: {},
} as ToyConfig);

let stars: THREE.Points;
let starMaterial: THREE.PointsMaterial;

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

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  stars.rotation.y += 0.001 + avg / 50000;
  const hue = (avg / 256) % 1;
  starMaterial.color.setHSL(hue, 0.8, 0.9);
  ctx.toy.render();
}

async function startAudio() {
  try {
    await startAudioLoop(toy, animate);
    return true;
  } catch (e) {
    console.error('Microphone access denied', e);
    throw e;
  }
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
