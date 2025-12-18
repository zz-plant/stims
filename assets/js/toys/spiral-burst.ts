import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  getContextFrequencyData,
  AnimationContext,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { startToyAudio } from '../utils/start-audio';
import { mapFrequencyToItems } from '../utils/audio-mapper';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 100 } },
  lightingOptions: { type: 'HemisphereLight' },
  ambientLightOptions: {},
} as ToyConfig);

const lines: THREE.Line[] = [];

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

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  mapFrequencyToItems(
    data,
    lines,
    (line, idx, value) => {
      line.rotation.z += 0.002 + value / 100000;
      line.rotation.x += 0.001 + idx / 10000;
      const scale = 1 + value / 256;
      line.scale.set(scale, scale, scale);
      const hue = (idx / lines.length + value / 512) % 1;
      (line.material as THREE.LineBasicMaterial).color.setHSL(hue, 0.6, 0.5);
    },
    { fallbackValue: avg }
  );
  ctx.toy.render();
}

async function startAudio() {
  return startToyAudio(toy, animate);
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
