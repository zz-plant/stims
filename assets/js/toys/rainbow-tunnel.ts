import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  getContextFrequencyData,
  AnimationContext,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { startToyAudio } from '../utils/start-audio';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 100 } },
  lightingOptions: { type: 'HemisphereLight' },
  ambientLightOptions: { intensity: 0.4 },
} as ToyConfig);

interface RingData {
  outer: THREE.Mesh;
  inner?: THREE.Mesh;
  baseZ: number;
  hue: number;
}

const rings: RingData[] = [];
const RING_COUNT = 20;
const RING_SPACING = 30;
const TUNNEL_LENGTH = RING_COUNT * RING_SPACING;

function init() {
  const { scene } = toy;

  // Create rings with inner glow rings
  for (let i = 0; i < RING_COUNT; i++) {
    const hue = i / RING_COUNT;
    const baseZ = -i * RING_SPACING;

    // Outer ring
    const outerGeometry = new THREE.TorusGeometry(15, 2, 16, 64);
    const outerMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.8, 0.5),
      emissive: new THREE.Color().setHSL(hue, 0.5, 0.2),
      metalness: 0.6,
      roughness: 0.3,
    });
    const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
    outerRing.position.z = baseZ;
    scene.add(outerRing);

    // Inner glow ring
    const innerGeometry = new THREE.TorusGeometry(12, 1, 16, 64);
    const innerMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL((hue + 0.1) % 1, 0.9, 0.6),
      emissive: new THREE.Color().setHSL((hue + 0.1) % 1, 0.8, 0.4),
      transparent: true,
      opacity: 0.7,
      metalness: 0.8,
      roughness: 0.2,
    });
    const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
    innerRing.position.z = baseZ;
    scene.add(innerRing);

    rings.push({
      outer: outerRing,
      inner: innerRing,
      baseZ,
      hue,
    });
  }

  // Add particle trail through tunnel
  const particleGeometry = new THREE.BufferGeometry();
  const particleCount = 500;
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 5 + Math.random() * 8;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = Math.random() * -TUNNEL_LENGTH;
  }

  particleGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3)
  );
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.5,
    transparent: true,
    opacity: 0.6,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  // Add colored point lights along tunnel
  const lightColors = [0xff0066, 0x00ff99, 0x6600ff, 0xffff00];
  lightColors.forEach((color, i) => {
    const light = new THREE.PointLight(color, 1, 100);
    light.position.z = -i * (TUNNEL_LENGTH / 4);
    scene.add(light);
  });
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  const normalizedAvg = avg / 255;
  const time = Date.now() / 1000;

  const binsPerRing = Math.floor(data.length / rings.length);

  rings.forEach((ringData, idx) => {
    const bin = Math.min(Math.floor(idx * binsPerRing), data.length - 1);
    const value = data[bin] || 0;
    const normalizedValue = value / 255;

    // Rotate rings at varying speeds
    const rotationSpeed = 0.01 + normalizedValue * 0.05;
    ringData.outer.rotation.x += rotationSpeed;
    ringData.outer.rotation.z += rotationSpeed * 0.5;
    if (ringData.inner) {
      ringData.inner.rotation.x -= rotationSpeed * 0.7;
      ringData.inner.rotation.z -= rotationSpeed * 0.3;
    }

    // Pulsing scale based on audio
    const scale = 1 + normalizedValue * 0.4;
    ringData.outer.scale.set(scale, scale, 1);
    if (ringData.inner) {
      ringData.inner.scale.set(scale * 0.9, scale * 0.9, 1);
    }

    // Dynamic color shift
    const hueShift = (ringData.hue + normalizedAvg * 0.3 + time * 0.05) % 1;
    const outerMaterial = ringData.outer.material as THREE.MeshStandardMaterial;
    outerMaterial.color.setHSL(hueShift, 0.8, 0.5 + normalizedValue * 0.2);
    outerMaterial.emissive.setHSL(hueShift, 0.6, normalizedValue * 0.4);

    if (ringData.inner) {
      const innerMaterial = ringData.inner
        .material as THREE.MeshStandardMaterial;
      innerMaterial.color.setHSL(
        (hueShift + 0.1) % 1,
        0.9,
        0.6 + normalizedValue * 0.2
      );
      innerMaterial.emissive.setHSL(
        (hueShift + 0.1) % 1,
        0.8,
        normalizedValue * 0.5
      );
      innerMaterial.opacity = 0.5 + normalizedValue * 0.4;
    }
  });

  // Smooth camera fly-through
  const flySpeed = 0.8 + normalizedAvg * 2;
  toy.camera.position.z -= flySpeed;

  // Add slight camera wobble
  toy.camera.position.x = Math.sin(time * 2) * 2;
  toy.camera.position.y = Math.cos(time * 1.5) * 2;

  // Reset camera when it reaches the end
  if (toy.camera.position.z < -TUNNEL_LENGTH + 50) {
    toy.camera.position.z = 100;
  }

  // Camera look-ahead
  toy.camera.lookAt(
    Math.sin(time * 0.5) * 3,
    Math.cos(time * 0.5) * 3,
    toy.camera.position.z - 50
  );

  ctx.toy.render();
}

async function startAudio(useSynthetic = false) {
  return startToyAudio(toy, animate, {
    fftSize: 256,
    fallbackToSynthetic: useSynthetic,
    preferSynthetic: useSynthetic,
  });
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
(window as unknown as Record<string, unknown>).startAudioFallback = () =>
  startAudio(true);
