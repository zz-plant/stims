import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import { startToyAudio } from '../utils/start-audio';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 6, z: 26 } },
  lightingOptions: {
    type: 'DirectionalLight',
    position: { x: -6, y: 12, z: 8 },
    intensity: 1.15,
  },
  ambientLightOptions: { intensity: 0.35 },
} as ToyConfig);

type PaletteKey = 'aurora' | 'sunset' | 'midnight';

type KiteInstance = {
  mesh: THREE.Mesh;
  basePosition: THREE.Vector3;
  swayAxis: THREE.Vector3;
  flutterSpeed: number;
  branchDepth: number;
  baseColor: THREE.Color;
  twist: number;
};

const palettes: Record<PaletteKey, number[]> = {
  aurora: [0x83e6ff, 0x6ad0f7, 0xd3afff, 0xa8f7dd],
  sunset: [0xffc6a3, 0xff7b80, 0xffa35c, 0xf8d28f],
  midnight: [0x92b1ff, 0x7cf0ff, 0xc1e6ff, 0x9ba4ff],
};

const settings = {
  palette: 'aurora' as PaletteKey,
  density: 0.65,
};

let kiteGeometry: THREE.BufferGeometry | null = null;
const kiteGroup = new THREE.Group();
const kiteInstances: KiteInstance[] = [];

function getBandAverage(data: Uint8Array, start: number, end: number) {
  const startIndex = Math.max(0, Math.floor(data.length * start));
  const endIndex = Math.min(data.length, Math.ceil(data.length * end));
  if (endIndex <= startIndex) return 0;

  let sum = 0;
  for (let i = startIndex; i < endIndex; i++) {
    sum += data[i];
  }
  return sum / (endIndex - startIndex);
}

function createKiteGeometry() {
  if (kiteGeometry) return kiteGeometry;

  const shape = new THREE.Shape();
  shape.moveTo(0, 1.5);
  shape.lineTo(1.1, 0);
  shape.lineTo(0, -1.7);
  shape.lineTo(-1.1, 0);
  shape.lineTo(0, 1.5);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: false,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, -0.08);
  geometry.computeVertexNormals();

  kiteGeometry = geometry;
  return geometry;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
      if (mesh.geometry && mesh.geometry !== kiteGeometry) {
        mesh.geometry.dispose();
      }
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material?.dispose();
      }
    }
  });
  group.clear();
}

function disposeGarden() {
  disposeGroup(kiteGroup);
  kiteInstances.length = 0;
}

function pickPaletteColor() {
  const colors = palettes[settings.palette];
  const color = colors[Math.floor(Math.random() * colors.length)];
  return new THREE.Color(color);
}

function createKite(
  position: THREE.Vector3,
  direction: THREE.Vector3,
  branchDepth: number
) {
  const geometry = createKiteGeometry();
  const baseColor = pickPaletteColor();
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor.clone().multiplyScalar(0.18),
    metalness: 0.08,
    roughness: 0.36,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);

  const directionVector = direction.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    directionVector
  );
  mesh.quaternion.copy(quaternion);
  mesh.rotateY((Math.random() - 0.5) * 0.6);

  kiteGroup.add(mesh);

  kiteInstances.push({
    mesh,
    basePosition: position.clone(),
    swayAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize(),
    flutterSpeed: Math.random() * Math.PI * 2,
    branchDepth,
    baseColor,
    twist: (Math.random() - 0.5) * 0.5,
  });
}

function growBranch(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  depth: number,
  maxKites: number
) {
  if (depth <= 0 || kiteInstances.length >= maxKites) return;

  const segmentLength = 3 + Math.random() * 2;
  const nextPosition = origin.clone().addScaledVector(direction, segmentLength);
  createKite(nextPosition, direction, depth);

  const remainingDepth = depth - 1;
  if (remainingDepth <= 0 || kiteInstances.length >= maxKites) return;

  const childCount = 1 + Math.floor(Math.random() * (settings.density * 2 + 1));
  for (let i = 0; i < childCount; i++) {
    const yaw = (Math.random() - 0.5) * (0.8 + settings.density * 0.8);
    const pitch = (Math.random() - 0.35) * 0.4;
    const childDirection = direction
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
      .normalize();

    growBranch(nextPosition, childDirection, remainingDepth, maxKites);
    if (kiteInstances.length >= maxKites) break;
  }
}

function buildGarden() {
  disposeGarden();
  const maxKites = Math.floor(180 + settings.density * 220);
  const branchDepth = 3 + Math.floor(settings.density * 3);
  const branchCount = 8 + Math.floor(settings.density * 12);

  for (let i = 0; i < branchCount; i++) {
    const angle = (i / branchCount) * Math.PI * 2 + Math.random() * 0.1;
    const radius = 6 + Math.random() * 4;
    const origin = new THREE.Vector3(
      Math.cos(angle) * radius,
      -3 + Math.random() * 1.5,
      Math.sin(angle) * radius
    );
    const direction = new THREE.Vector3(
      -origin.x * 0.06 + (Math.random() - 0.5) * 0.2,
      1,
      -origin.z * 0.06 + (Math.random() - 0.5) * 0.2
    ).normalize();

    growBranch(origin, direction, branchDepth, maxKites);
    if (kiteInstances.length >= maxKites) break;
  }

  toy.scene.add(kiteGroup);
}

function createControls() {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '16px';
  container.style.right = '16px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '10px';
  container.style.padding = '12px 14px';
  container.style.background = 'rgba(9, 12, 20, 0.6)';
  container.style.border = '1px solid #1f2937';
  container.style.borderRadius = '12px';
  container.style.color = '#f8fafc';
  container.style.fontFamily = 'Inter, system-ui, sans-serif';
  container.style.zIndex = '10';
  container.style.maxWidth = '260px';

  const title = document.createElement('div');
  title.textContent = 'Fractal Kite Garden';
  title.style.fontWeight = '600';
  title.style.letterSpacing = '0.01em';
  title.style.fontSize = '14px';
  container.appendChild(title);

  const densityLabel = document.createElement('label');
  densityLabel.textContent = 'Pattern density';
  densityLabel.style.display = 'flex';
  densityLabel.style.flexDirection = 'column';
  densityLabel.style.gap = '6px';
  densityLabel.style.fontSize = '12px';
  densityLabel.style.opacity = '0.9';

  const densityInput = document.createElement('input');
  densityInput.type = 'range';
  densityInput.min = '0.25';
  densityInput.max = '1';
  densityInput.step = '0.05';
  densityInput.value = settings.density.toString();
  densityInput.addEventListener('input', () => {
    settings.density = Number(densityInput.value);
    buildGarden();
  });

  densityLabel.appendChild(densityInput);
  container.appendChild(densityLabel);

  const paletteLabel = document.createElement('div');
  paletteLabel.textContent = 'Color palette';
  paletteLabel.style.fontSize = '12px';
  paletteLabel.style.opacity = '0.9';
  container.appendChild(paletteLabel);

  const paletteRow = document.createElement('div');
  paletteRow.style.display = 'flex';
  paletteRow.style.gap = '8px';

  (Object.keys(palettes) as PaletteKey[]).forEach((paletteKey) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = paletteKey.charAt(0).toUpperCase() + paletteKey.slice(1);
    button.style.padding = '6px 10px';
    button.style.borderRadius = '10px';
    button.style.border = '1px solid #1f2937';
    button.style.background =
      paletteKey === settings.palette ? '#0ea5e9' : 'rgba(255,255,255,0.06)';
    button.style.color = '#f8fafc';
    button.style.cursor = 'pointer';
    button.style.fontSize = '12px';
    button.addEventListener('click', () => {
      settings.palette = paletteKey;
      (paletteRow.childNodes as NodeListOf<HTMLButtonElement>).forEach(
        (child) => {
          child.style.background =
            child.textContent?.toLowerCase() === paletteKey ? '#0ea5e9' : 'rgba(255,255,255,0.06)';
        }
      );
      buildGarden();
    });
    paletteRow.appendChild(button);
  });

  container.appendChild(paletteRow);

  const hint = document.createElement('div');
  hint.textContent = 'Mid frequencies sway branches, highs brighten kite flashes.';
  hint.style.fontSize = '11px';
  hint.style.opacity = '0.75';
  hint.style.lineHeight = '1.4';
  container.appendChild(hint);

  document.body.appendChild(container);
}

function init() {
  toy.scene.fog = new THREE.FogExp2(0x030712, 0.028);
  toy.rendererReady.then((result) => {
    result?.renderer.setClearColor?.(0x030712, 1);
  });
  createControls();
  buildGarden();
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const mid = getBandAverage(data, 0.35, 0.65) / 255;
  const high = getBandAverage(data, 0.65, 1) / 255;
  const time = ctx.time;

  kiteInstances.forEach((kite) => {
    const mesh = kite.mesh;
    const flutter = Math.sin(time * 0.0012 + kite.flutterSpeed) * (0.4 + mid * 1.6);
    const sway = kite.swayAxis
      .clone()
      .multiplyScalar(flutter * (0.6 + kite.branchDepth * 0.35));

    mesh.position.copy(kite.basePosition).add(sway);
    mesh.rotation.z =
      kite.twist + Math.sin(time * 0.0009 + kite.flutterSpeed * 2) * 0.18 + mid * 0.35;
    mesh.rotation.y += 0.0025 + high * 0.02;

    const scale = 0.9 + kite.branchDepth * 0.06 + high * 0.9 + mid * 0.45;
    mesh.scale.setScalar(scale);

    const material = mesh.material as THREE.MeshStandardMaterial;
    const targetColor = kite.baseColor
      .clone()
      .lerp(new THREE.Color(0xffffff), Math.min(1, high * 0.7 + mid * 0.3));
    material.color.copy(targetColor);
    material.emissive.copy(targetColor.clone().multiplyScalar(0.2 + high * 0.4));
  });

  ctx.toy.render();
}

async function startAudio(useSynthetic = false) {
  return startToyAudio(toy, animate, {
    fftSize: 512,
    fallbackToSynthetic: useSynthetic,
    preferSynthetic: useSynthetic,
  });
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
(window as unknown as Record<string, unknown>).startAudioFallback = () =>
  startAudio(true);
