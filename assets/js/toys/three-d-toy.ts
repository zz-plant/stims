import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  getContextFrequencyData,
  AnimationContext,
  type AudioLoopController,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { createIdleDetector } from '../utils/idle-detector';
import {
  createControlPanel,
  type ControlPanelState,
} from '../utils/control-panel';
import { startToyAudio } from '../utils/start-audio';

let errorElement: HTMLElement | null;

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 80 } },
  lightingOptions: {
    type: 'PointLight',
    color: 0xff00ff,
    intensity: 2,
    position: { x: 20, y: 30, z: 20 },
  },
  ambientLightOptions: { color: 0x404040, intensity: 0.8 },
} as ToyConfig);

let torusKnot: THREE.Mesh;
let particles: THREE.Points;
const shapes: THREE.Mesh[] = [];
let paletteHue = 0.6;
let idleBlend = 0;
let controlState: ControlPanelState;
const idleDetector = createIdleDetector();
const clock = new THREE.Clock();
let audioController: AudioLoopController | null = null;

const controlPanel = createControlPanel();
controlState = controlPanel.getState();
document.body.appendChild(controlPanel.panel);
controlPanel.onChange((state) => {
  controlState = state;
});

function createRandomShape() {
  const shapeType = Math.floor(Math.random() * 3);
  let geometry;
  const material = new THREE.MeshStandardMaterial({
    color: Math.random() * 0xffffff,
    emissive: Math.random() * 0x444444,
    metalness: 0.8,
    roughness: 0.4,
  });

  switch (shapeType) {
    case 0:
      geometry = new THREE.SphereGeometry(5, 32, 32);
      break;
    case 1:
      geometry = new THREE.BoxGeometry(7, 7, 7);
      break;
    default:
      geometry = new THREE.TetrahedronGeometry(6, 0);
      break;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    Math.random() * 120 - 60,
    Math.random() * 120 - 60,
    Math.random() * -800
  );
  toy.scene.add(mesh);
  shapes.push(mesh);
}

function init() {
  const { scene } = toy;

  torusKnot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(10, 3, 100, 16),
    new THREE.MeshStandardMaterial({
      color: 0x00ffcc,
      metalness: 0.7,
      roughness: 0.4,
    })
  );
  scene.add(torusKnot);

  const particlesGeometry = new THREE.BufferGeometry();
  const particlesCount = 1500;
  const particlesPosition = new Float32Array(particlesCount * 3);
  for (let i = 0; i < particlesCount * 3; i++) {
    particlesPosition[i] = (Math.random() - 0.5) * 800;
  }
  particlesGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(particlesPosition, 3)
  );
  const particlesMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.8,
  });
  particles = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particles);

  for (let i = 0; i < 7; i++) {
    createRandomShape();
  }
}

function showError(message: string) {
  if (!errorElement) {
    errorElement = document.createElement('div');
    errorElement.id = 'error-message';
    errorElement.style.position = 'absolute';
    errorElement.style.top = '20px';
    errorElement.style.left = '20px';
    errorElement.style.color = '#ff0000';
    errorElement.style.background = 'rgba(0, 0, 0, 0.7)';
    errorElement.style.padding = '10px';
    errorElement.style.borderRadius = '5px';
    errorElement.style.zIndex = '10';
    document.body.appendChild(errorElement);
  }
  errorElement.textContent = message;
  errorElement.style.display = 'block';
}

function hideError() {
  if (errorElement) {
    errorElement.style.display = 'none';
  }
}

function animate(ctx: AnimationContext) {
  const dataArray = getContextFrequencyData(ctx);
  const avgFrequency = getAverageFrequency(dataArray);

  const { idle, idleProgress } = idleDetector.update(dataArray);
  const idleTarget = controlState.idleEnabled ? idleProgress : 0;
  idleBlend = THREE.MathUtils.lerp(idleBlend, idleTarget, 0.05);
  const idleStrength = controlState.mobilePreset ? 0.55 : 1;
  const idleOffset = idleBlend * idleStrength;

  const time = clock.getElapsedTime();
  const paletteEnabled = controlState.paletteCycle;
  const paletteSpeedBase = controlState.mobilePreset ? 0.003 : 0.006;
  const activityDamp = idle ? 1 : 0.2;
  const paletteSpeed = paletteEnabled
    ? paletteSpeedBase * (idleBlend + activityDamp)
    : 0;
  paletteHue = (paletteHue + paletteSpeed) % 1;

  const backgroundColor = new THREE.Color().setHSL(
    paletteHue,
    0.4,
    0.08 + idleBlend * 0.1
  );
  toy.scene.background = backgroundColor;
  document.body.style.backgroundImage = `radial-gradient(circle at 20% 20%, hsla(${
    (paletteHue + 0.08) * 360
  }, 70%, ${25 + idleBlend * 15}%, 0.9), hsla(${
    (paletteHue + 0.26) * 360
  }, 60%, ${6 + idleBlend * 10}%, 0.95))`;

  torusKnot.rotation.x += avgFrequency / 5000;
  torusKnot.rotation.y += avgFrequency / 7000;

  const wobble = 1 + Math.sin(time * 0.6) * 0.15 * idleOffset;
  const wobbleVec = new THREE.Vector3(wobble, wobble, wobble);
  torusKnot.scale.lerp(wobbleVec, 0.08);

  particles.rotation.y += 0.001 + avgFrequency / 15000;

  shapes.forEach((shape) => {
    shape.rotation.x += Math.random() * 0.03;
    shape.rotation.y += Math.random() * 0.03;
    shape.position.z += 1.5 + avgFrequency / 50;
    if (shape.position.z > 20) {
      shape.position.z = -800;
      shape.position.x = Math.random() * 120 - 60;
      shape.position.y = Math.random() * 120 - 60;
      (shape.material as THREE.MeshStandardMaterial).color.set(
        Math.random() * 0xffffff
      );
    }
    const wobbleAmt =
      1 + Math.sin(time * 0.9 + shape.position.x) * 0.08 * idleOffset;
    shape.scale.lerp(new THREE.Vector3(wobbleAmt, wobbleAmt, wobbleAmt), 0.1);
  });

  const randomScale =
    1 + Math.sin(Date.now() * 0.001) * (controlState.mobilePreset ? 0.15 : 0.3);
  torusKnot.scale.set(randomScale, randomScale, randomScale);

  const driftAmount = idleOffset * (controlState.mobilePreset ? 2.5 : 4.2);
  toy.camera.position.x = Math.sin(time * 0.25) * driftAmount;
  toy.camera.position.y = Math.cos(time * 0.2) * driftAmount * 0.6;
  toy.camera.lookAt(0, 0, 0);

  ctx.toy.render();
}

async function startAudio() {
  try {
    audioController = audioController || startToyAudio(toy, animate);
    await audioController.start();
    hideError();
    return true;
  } catch (e) {
    showError('Microphone access was denied. Please allow access and reload.');
    throw e;
  }
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
