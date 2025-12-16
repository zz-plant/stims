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
  cameraOptions: { position: { x: 0, y: 0, z: 80 } },
  lightingOptions: { type: 'HemisphereLight' },
  ambientLightOptions: {},
} as ToyConfig);

const rings: THREE.Mesh[] = [];

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

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  rings.forEach((ring, idx) => {
    ring.rotation.x += 0.01 + avg / 100000;
    (ring.material as THREE.MeshStandardMaterial).color.setHSL(
      (idx / rings.length + avg / 512) % 1,
      0.7,
      0.5
    );
  });
  ctx.toy.camera.position.z -= 0.5 + avg / 50;
  if (ctx.toy.camera.position.z < -100) ctx.toy.camera.position.z = 80;
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
