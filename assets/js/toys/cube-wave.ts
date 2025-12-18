import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  startAudioLoop,
  getContextFrequencyData,
  AnimationContext,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { applyAudioColor } from '../utils/color-audio';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 30, z: 80 } },
  lightingOptions: {
    type: 'DirectionalLight',
    position: { x: 0, y: 50, z: 50 },
  },
  ambientLightOptions: {},
} as ToyConfig);

const cubes: THREE.Mesh[] = [];

function init() {
  const { scene } = toy;
  const gridSize = 10;
  const spacing = 5;
  const geometry = new THREE.BoxGeometry(4, 4, 4);
  const material = new THREE.MeshStandardMaterial({ color: 0x66ccff });

  for (let x = -gridSize / 2; x < gridSize / 2; x++) {
    for (let z = -gridSize / 2; z < gridSize / 2; z++) {
      const cube = new THREE.Mesh(geometry, material.clone());
      cube.position.set(x * spacing, 0, z * spacing);
      scene.add(cube);
      cubes.push(cube);
    }
  }
}

function animate(ctx: AnimationContext) {
  const dataArray = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(dataArray);

  const binsPerCube = dataArray.length / cubes.length;
  cubes.forEach((cube, i) => {
    const bin = Math.floor(i * binsPerCube);
    const value = dataArray[bin] || avg;
    const normalizedValue = value / 255;
    const scale = 1 + value / 128;
    cube.scale.y = scale;
    applyAudioColor(cube.material, normalizedValue, {
      baseHue: 0.6,
      hueRange: -0.5,
      baseSaturation: 0.8,
      baseLuminance: 0.5,
    });
    cube.rotation.y += value / 100000;
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
