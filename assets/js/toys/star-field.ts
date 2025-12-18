import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  getContextFrequencyData,
  AnimationContext,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { startToyAudio } from '../utils/start-audio';
import { applyAudioColor } from '../utils/color-audio';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 100 } },
  lightingOptions: { type: 'PointLight', position: { x: 10, y: 20, z: 50 } },
  ambientLightOptions: { intensity: 0.3 },
} as ToyConfig);

let stars: THREE.Points;
let starMaterial: THREE.PointsMaterial;
let starPositions: Float32Array;
let starSizes: Float32Array;
let starColors: Float32Array;
let nebulaParticles: THREE.Points;
let nebulaPositions: Float32Array;

const STAR_COUNT = 4000;
const NEBULA_COUNT = 200;

function init() {
  const { scene } = toy;

  // Create stars with varying sizes and colors
  const geometry = new THREE.BufferGeometry();
  starPositions = new Float32Array(STAR_COUNT * 3);
  starSizes = new Float32Array(STAR_COUNT);
  starColors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    const i3 = i * 3;
    // Spread stars in a larger space with more depth
    starPositions[i3] = (Math.random() - 0.5) * 400;
    starPositions[i3 + 1] = (Math.random() - 0.5) * 400;
    starPositions[i3 + 2] = (Math.random() - 0.5) * 800 - 200;

    // Varying star sizes
    starSizes[i] = Math.random() * 2 + 0.5;

    // Star colors - mostly white with some blue and yellow tints
    const colorChoice = Math.random();
    if (colorChoice < 0.7) {
      // White stars
      starColors[i3] = 1;
      starColors[i3 + 1] = 1;
      starColors[i3 + 2] = 1;
    } else if (colorChoice < 0.85) {
      // Blue stars
      starColors[i3] = 0.6;
      starColors[i3 + 1] = 0.8;
      starColors[i3 + 2] = 1;
    } else {
      // Yellow/orange stars
      starColors[i3] = 1;
      starColors[i3 + 1] = 0.9;
      starColors[i3 + 2] = 0.6;
    }
  }

  const positionAttribute = new THREE.BufferAttribute(starPositions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);

  const sizeAttribute = new THREE.BufferAttribute(starSizes, 1);
  sizeAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('size', sizeAttribute);
  geometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

  starMaterial = new THREE.PointsMaterial({
    size: 1.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
  });

  stars = new THREE.Points(geometry, starMaterial);
  scene.add(stars);

  // Create nebula-like particle clusters
  const nebulaGeometry = new THREE.BufferGeometry();
  nebulaPositions = new Float32Array(NEBULA_COUNT * 3);
  const nebulaColors = new Float32Array(NEBULA_COUNT * 3);

  for (let i = 0; i < NEBULA_COUNT; i++) {
    const i3 = i * 3;
    // Cluster nebula particles in a few areas
    const clusterX = (Math.floor(Math.random() * 3) - 1) * 100;
    const clusterY = (Math.floor(Math.random() * 3) - 1) * 50;
    nebulaPositions[i3] = clusterX + (Math.random() - 0.5) * 80;
    nebulaPositions[i3 + 1] = clusterY + (Math.random() - 0.5) * 60;
    nebulaPositions[i3 + 2] = (Math.random() - 0.5) * 200 - 100;

    // Nebula colors - purples, pinks, blues
    const hue = 0.7 + Math.random() * 0.3; // Purple to pink range
    const color = new THREE.Color().setHSL(hue % 1, 0.6, 0.5);
    nebulaColors[i3] = color.r;
    nebulaColors[i3 + 1] = color.g;
    nebulaColors[i3 + 2] = color.b;
  }

  nebulaGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(nebulaPositions, 3)
  );
  nebulaGeometry.setAttribute(
    'color',
    new THREE.BufferAttribute(nebulaColors, 3)
  );

  const nebulaMaterial = new THREE.PointsMaterial({
    size: 15,
    vertexColors: true,
    transparent: true,
    opacity: 0.3,
    sizeAttenuation: true,
  });

  nebulaParticles = new THREE.Points(nebulaGeometry, nebulaMaterial);
  scene.add(nebulaParticles);

  // Add ambient colored lights
  const purpleLight = new THREE.PointLight(0x8800ff, 0.5, 500);
  purpleLight.position.set(-100, 50, -200);
  scene.add(purpleLight);

  const blueLight = new THREE.PointLight(0x0088ff, 0.5, 500);
  blueLight.position.set(100, -50, -200);
  scene.add(blueLight);
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  const normalizedAvg = avg / 255;
  const time = Date.now() / 1000;

  // Warp speed effect - move stars towards camera
  const positions = stars.geometry.attributes.position.array as Float32Array;
  const warpSpeed = 0.5 + normalizedAvg * 3;

  for (let i = 0; i < STAR_COUNT; i++) {
    const i3 = i * 3;
    positions[i3 + 2] += warpSpeed;

    // Reset stars that pass the camera
    if (positions[i3 + 2] > 100) {
      positions[i3 + 2] = -600;
      positions[i3] = (Math.random() - 0.5) * 400;
      positions[i3 + 1] = (Math.random() - 0.5) * 400;
    }
  }
  stars.geometry.attributes.position.needsUpdate = true;

  // Twinkle effect
  const sizes = stars.geometry.attributes.size.array as Float32Array;
  for (let i = 0; i < STAR_COUNT; i++) {
    const twinkle = Math.sin(time * 10 + i * 0.1) * 0.3 + 0.7;
    sizes[i] = starSizes[i] * twinkle * (1 + normalizedAvg * 0.5);
  }
  stars.geometry.attributes.size.needsUpdate = true;

  // Rotate stars slightly
  stars.rotation.z += 0.0002 + normalizedAvg * 0.001;

  // Animate nebula
  nebulaParticles.rotation.y += 0.001;
  nebulaParticles.rotation.x = Math.sin(time * 0.1) * 0.1;
  (nebulaParticles.material as THREE.PointsMaterial).opacity =
    0.2 + normalizedAvg * 0.3;

  // Color shift based on audio
  const hueBase = (time * 0.05) % 1;
  applyAudioColor(starMaterial, normalizedAvg, {
    baseHue: hueBase,
    hueRange: 0.5,
    baseSaturation: 0.3,
    baseLuminance: 0.9,
  });

  // Camera effects
  toy.camera.position.x = Math.sin(time * 0.3) * 10;
  toy.camera.position.y = Math.cos(time * 0.2) * 5;
  toy.camera.lookAt(0, 0, -100);

  ctx.toy.render();
}

async function startAudio() {
  return startToyAudio(toy, animate, 256);
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
