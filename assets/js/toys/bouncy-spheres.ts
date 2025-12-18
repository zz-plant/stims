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
  cameraOptions: { position: { x: 0, y: 30, z: 70 } },
  lightingOptions: {
    type: 'DirectionalLight',
    position: { x: 0, y: 50, z: 40 },
    intensity: 1.5,
  },
  ambientLightOptions: { intensity: 0.6 },
} as ToyConfig);

interface SphereData {
  mesh: THREE.Mesh;
  baseY: number;
  baseScale: number;
  row: number;
  col: number;
}

const spheres: SphereData[] = [];
const ROWS = 3;
const COLS = 7;
const SPACING_X = 8;
const SPACING_Z = 10;

function init() {
  const { scene } = toy;

  // Add a reflective floor
  const floorGeometry = new THREE.PlaneGeometry(100, 60);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x111122,
    metalness: 0.9,
    roughness: 0.2,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -8;
  scene.add(floor);

  // Create sphere grid
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const size = 2 + Math.random() * 1.5;
      const geometry = new THREE.SphereGeometry(size, 32, 32);
      const hue = (col / COLS) * 0.3 + 0.8; // Pink to purple range
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue % 1, 0.7, 0.5),
        metalness: 0.4,
        roughness: 0.3,
        emissive: new THREE.Color().setHSL(hue % 1, 0.5, 0.1),
      });
      const sphere = new THREE.Mesh(geometry, material);

      const xPos = (col - (COLS - 1) / 2) * SPACING_X;
      const zPos = (row - (ROWS - 1) / 2) * SPACING_Z;
      sphere.position.set(xPos, 0, zPos);

      scene.add(sphere);
      spheres.push({
        mesh: sphere,
        baseY: 0,
        baseScale: 1,
        row,
        col,
      });
    }
  }

  // Add point lights for glow effect
  const colors = [0xff00ff, 0x00ffff, 0xffff00];
  colors.forEach((color, i) => {
    const light = new THREE.PointLight(color, 0.5, 50);
    light.position.set((i - 1) * 30, 20, 0);
    scene.add(light);
  });
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  const time = Date.now() / 1000;

  const binsPerSphere = Math.floor(data.length / spheres.length);

  spheres.forEach((sphereData, idx) => {
    const { mesh, row, col } = sphereData;
    const bin = Math.min(Math.floor(idx * binsPerSphere), data.length - 1);
    const value = data[bin] || 0;
    const normalizedValue = value / 255;

    // Wave-like bounce with audio reactivity
    const waveOffset = col * 0.3 + row * 0.5;
    const bounce = Math.sin(time * 3 + waveOffset) * 3;
    const audioBoost = normalizedValue * 15;
    mesh.position.y = bounce + audioBoost;

    // Dynamic scaling based on audio
    const scale = 1 + normalizedValue * 0.5;
    mesh.scale.set(scale, scale, scale);

    // Rotation
    mesh.rotation.x += 0.01 + normalizedValue * 0.05;
    mesh.rotation.y += 0.015 + normalizedValue * 0.03;

    const material = mesh.material as THREE.MeshStandardMaterial;
    const baseHue = (col / COLS) * 0.3 + 0.8;
    applyAudioColor(material, normalizedValue, {
      baseHue,
      hueRange: 0.2,
      baseSaturation: 0.7,
      saturationRange: 0.3,
      baseLuminance: 0.5,
      luminanceRange: 0.2,
      emissive: {
        baseHue,
        baseSaturation: 0.5,
        baseLuminance: 0,
        luminanceRange: 0.3,
      },
    });
  });

  // Camera sway
  toy.camera.position.x = Math.sin(time * 0.2) * 5;
  toy.camera.lookAt(0, 5, 0);

  ctx.toy.render();
}

async function startAudio() {
  try {
    await startAudioLoop(toy, animate, { fftSize: 256 });
    return true;
  } catch (e) {
    console.error('Microphone access denied', e);
    throw e;
  }
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
