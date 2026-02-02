import * as THREE from 'three';
import {
  DEFAULT_QUALITY_PRESETS,
  type QualityPreset,
} from '../core/settings-panel';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { getBandAverage } from '../utils/audio-bands';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

const MOBILE_QUALITY_PRESET: QualityPreset = {
  id: 'mobile',
  label: 'Mobile saver',
  description: 'Reduced pixel density and fewer particles for handheld GPUs.',
  maxPixelRatio: 1.15,
  renderScale: 0.85,
  particleScale: 0.6,
};

const QUALITY_PRESETS: QualityPreset[] = [
  MOBILE_QUALITY_PRESET,
  ...DEFAULT_QUALITY_PRESETS,
];

const isCompactDevice = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return (
    window.matchMedia('(max-width: 720px)').matches ||
    window.matchMedia('(pointer: coarse)').matches
  );
};

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Pocket Pulse',
    description: 'Mobile-tuned pulses that drift with touch and audio.',
    presets: QUALITY_PRESETS,
    defaultPresetId: isCompactDevice() ? 'mobile' : 'balanced',
    storageKey: 'stims:pocket-pulse:quality',
    getRuntime: () => runtime,
    onChange: () => {
      rebuildField();
    },
  });

  let runtime: ToyRuntimeInstance;
  let points: THREE.Points | null = null;
  let geometry: THREE.BufferGeometry | null = null;
  let material: THREE.PointsMaterial | null = null;
  let basePositions: Float32Array | null = null;
  let activeSize = 0.65;
  let beatEnergy = 0;

  const palette = {
    background: new THREE.Color('#050611'),
    baseHue: 0.62,
    saturation: 0.7,
  };

  function getFieldConfig() {
    const scale = quality.activeQuality.particleScale ?? 1;
    const count = Math.max(90, Math.round(260 * scale));
    const radius = 8 + 6 * Math.max(0.7, scale);
    const depth = 18 + 8 * Math.max(0.6, scale);
    const size = 0.45 + 0.3 * Math.max(0.7, scale);
    return { count, radius, depth, size };
  }

  function disposeField() {
    if (points) {
      runtime.toy.scene.remove(points);
    }
    points = null;
    disposeGeometry(geometry);
    disposeMaterial(material);
    geometry = null;
    material = null;
    basePositions = null;
  }

  function rebuildField() {
    disposeField();
    const { count, radius, depth, size } = getFieldConfig();
    activeSize = size;

    geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const ring = 0.35 + Math.random() * 0.65;
      const offset = Math.random() * 2 - 1;
      const orbitRadius = radius * ring + offset;

      positions[i * 3] = Math.cos(angle) * orbitRadius;
      positions[i * 3 + 1] = Math.sin(angle) * orbitRadius;
      positions[i * 3 + 2] = (Math.random() - 0.5) * depth;
    }

    basePositions = positions.slice();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    material = new THREE.PointsMaterial({
      color: new THREE.Color().setHSL(palette.baseHue, palette.saturation, 0.6),
      size,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    points = new THREE.Points(geometry, material);
    runtime.toy.scene.add(points);
  }

  function animate(
    data: Uint8Array,
    time: number,
    input: { normalizedCentroid: { x: number; y: number } } | null,
  ) {
    if (!geometry || !basePositions || !material || !points) return;

    const avg = getWeightedAverageFrequency(data) / 255;
    const bass = getBandAverage(data, 0, 0.28) / 255;
    const mids = getBandAverage(data, 0.28, 0.7) / 255;
    const treble = getBandAverage(data, 0.7, 1) / 255;
    const kick = Math.max(0, bass - 0.18);
    beatEnergy = Math.max(kick * 1.4, beatEnergy * 0.88);
    const pulse = 0.75 + bass * 1.2 + beatEnergy * 0.6;
    const swirl = time * (0.35 + mids * 0.4);

    const offsetX = (input?.normalizedCentroid.x ?? 0) * 5.5;
    const offsetY = (input?.normalizedCentroid.y ?? 0) * 4.2;
    const kickLift = beatEnergy * 3.2;

    const positionAttribute = geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const positions = positionAttribute.array as Float32Array;

    for (let i = 0; i < basePositions.length; i += 3) {
      const baseX = basePositions[i];
      const baseY = basePositions[i + 1];
      const baseZ = basePositions[i + 2];
      const wobble =
        Math.sin(swirl + baseZ * 0.08 + baseX * 0.04) * (0.6 + treble);
      const lift = Math.cos(swirl * 0.7 + baseY * 0.05) * (0.4 + mids);
      const ripple = Math.sin(time * 3.4 + baseZ * 0.24) * kickLift;

      positions[i] = baseX * pulse + offsetX + wobble + ripple * 0.2;
      positions[i + 1] = baseY * pulse + offsetY + lift + ripple * 0.2;
      positions[i + 2] =
        baseZ + Math.sin(time * 0.6 + baseX * 0.06) * 1.6 + ripple * 0.4;
    }

    positionAttribute.needsUpdate = true;

    const hue = (palette.baseHue + avg * 0.2 + time * 0.02) % 1;
    material.color.setHSL(hue, palette.saturation, 0.55 + avg * 0.25);
    material.opacity = 0.55 + avg * 0.3 + beatEnergy * 0.25;
    material.size = activeSize * (0.68 + treble * 0.9 + beatEnergy * 0.35);

    points.rotation.z = time * 0.12;
  }

  function setupSettingsPanel() {
    configurePanel();
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 24 } },
      sceneOptions: { background: palette.background },
      rendererOptions: {
        maxPixelRatio: quality.activeQuality.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 256 },
    input: { touchAction: 'manipulation' },
    plugins: [
      {
        name: 'pocket-pulse',
        setup: () => {
          setupSettingsPanel();
          rebuildField();
        },
        update: ({ frequencyData, time, input }) => {
          animate(frequencyData, time, input);
        },
        dispose: () => {
          disposeField();
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return () => {
    runtime.dispose();
  };
}
