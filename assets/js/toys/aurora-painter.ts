import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { startToyAudio } from '../utils/start-audio';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 45 }, fov: 60 },
  rendererOptions: { alpha: true, maxPixelRatio: 1.5 },
  ambientLightOptions: { intensity: 0.5, color: 0x0c1327 },
  lightingOptions: {
    type: 'DirectionalLight',
    options: { color: 0xaadfff, intensity: 0.75, position: { x: 18, y: 26, z: 18 } },
  },
} as ToyConfig);

toy.scene.background = new THREE.Color(0x03060c);
toy.scene.fog = new THREE.FogExp2(0x03060c, 0.025);

const RIBBON_COUNT = 6;
const RIBBON_POINTS = 70;
const TUBE_SEGMENTS = 140;

const ribbons: {
  points: THREE.Vector3[];
  curve: THREE.CatmullRomCurve3;
  mesh: THREE.Mesh;
  colorOffset: number;
}[] = [];

function randomRadius(base: number, variance: number) {
  return base + (Math.random() - 0.5) * variance;
}

function buildRibbon(index: number) {
  const baseRadius = 6 + index * 0.6;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < RIBBON_POINTS; i += 1) {
    const angle = (i / RIBBON_POINTS) * Math.PI * 2 + index * 0.35;
    points.push(
      new THREE.Vector3(
        Math.cos(angle) * randomRadius(baseRadius, 4),
        Math.sin(angle) * randomRadius(3.5, 3),
        -i * 0.4 - index
      )
    );
  }

  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, 0.6, 14, false);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL((index / RIBBON_COUNT + 0.5) % 1, 0.75, 0.55),
    emissive: 0x0b1327,
    emissiveIntensity: 0.35,
    metalness: 0.15,
    roughness: 0.35,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -index * 1.5;
  toy.scene.add(mesh);

  ribbons.push({ points, curve, mesh, colorOffset: Math.random() });
}

function averageRange(data: Uint8Array, startRatio: number, endRatio: number) {
  if (data.length === 0) return 0;
  const start = Math.max(0, Math.floor(data.length * startRatio));
  const end = Math.min(data.length, Math.ceil(data.length * endRatio));
  if (end <= start) return 0;

  let sum = 0;
  for (let i = start; i < end; i += 1) {
    sum += data[i];
  }
  return sum / (end - start);
}

function updateRibbon(
  ribbon: (typeof ribbons)[number],
  data: Uint8Array,
  time: number
) {
  const avg = getAverageFrequency(data);
  const bass = averageRange(data, 0, 0.32);
  const treble = averageRange(data, 0.65, 1);

  for (let i = ribbon.points.length - 1; i > 0; i -= 1) {
    ribbon.points[i].copy(ribbon.points[i - 1]);
  }

  const swirl = time * 0.65 + ribbon.colorOffset * Math.PI * 2;
  const sway = Math.sin(time * 1.3 + ribbon.colorOffset * 4) * (0.7 + bass / 260);
  const lift = Math.cos(time * 0.9 + ribbon.colorOffset * 2) * (0.6 + treble / 400);

  ribbon.points[0].set(
    Math.cos(swirl) * (8 + avg / 45) + sway,
    Math.sin(swirl * 0.8) * (5 + treble / 60) + lift,
    Math.sin(time * 0.35 + ribbon.colorOffset) * 3
  );

  ribbon.curve.points = ribbon.points;
  ribbon.mesh.geometry.dispose();
  const radius = 0.55 + bass / 240;
  ribbon.mesh.geometry = new THREE.TubeGeometry(
    ribbon.curve,
    TUBE_SEGMENTS,
    radius,
    16,
    false
  );

  const material = ribbon.mesh.material as THREE.MeshStandardMaterial;
  const hue = (0.52 + ribbon.colorOffset + avg / 360 + time * 0.025) % 1;
  material.color.setHSL(hue, 0.8, 0.52 + treble / 520);
  material.opacity = 0.55 + Math.min(0.4, bass / 260);
  material.emissiveIntensity = 0.25 + avg / 380;
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const time = performance.now() * 0.0015;

  ribbons.forEach((ribbon) => updateRibbon(ribbon, data, time));

  toy.camera.position.z = 45 + Math.sin(time * 0.35) * 2.2;
  toy.camera.lookAt(0, 0, -4);

  toy.render();
}

function init() {
  for (let i = 0; i < RIBBON_COUNT; i += 1) {
    buildRibbon(i);
  }
}

async function startAudio() {
  return startToyAudio(toy, animate, { fftSize: 512 });
}

init();

(window as unknown as Record<string, unknown>).startAudio = startAudio;
