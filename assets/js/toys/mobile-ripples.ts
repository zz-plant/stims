import * as THREE from 'three';
import {
  DEFAULT_QUALITY_PRESETS,
  type QualityPreset,
} from '../core/settings-panel';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { getBandAverage } from '../utils/audio-bands';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import {
  BREAKPOINTS,
  MEDIA_QUERIES,
  matchesMediaQuery,
  maxWidthQuery,
} from '../utils/breakpoints';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

const MOBILE_QUALITY_PRESET: QualityPreset = {
  id: 'mobile',
  label: 'Mobile saver',
  description: 'Lower pixel density with fewer rings for handheld GPUs.',
  maxPixelRatio: 1.1,
  renderScale: 0.8,
  particleScale: 0.65,
};

const QUALITY_PRESETS: QualityPreset[] = [
  MOBILE_QUALITY_PRESET,
  ...DEFAULT_QUALITY_PRESETS,
];

const isCompactDevice = () => {
  return (
    matchesMediaQuery(maxWidthQuery(BREAKPOINTS.md)) ||
    matchesMediaQuery(MEDIA_QUERIES.coarsePointer)
  );
};

type RingState = {
  mesh: THREE.Mesh;
  baseScale: number;
  pulseOffset: number;
};

export function start({ container }: ToyStartOptions = {}) {
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Mobile Ripples',
    description: 'Low-power neon ripples tuned for touch-first screens.',
    presets: QUALITY_PRESETS,
    defaultPresetId: isCompactDevice() ? 'mobile' : 'balanced',
    storageKey: 'stims:mobile-ripples:quality',
    getRuntime: () => runtime,
    onChange: () => rebuildRings(),
  });

  let runtime: ToyRuntimeInstance;
  let group: THREE.Group | null = null;
  let geometry: THREE.RingGeometry | null = null;
  let material: THREE.MeshBasicMaterial | null = null;
  let rings: RingState[] = [];

  const palette = {
    background: new THREE.Color('#04020b'),
    baseHue: 0.58,
    saturation: 0.82,
  };

  function getRingConfig() {
    const scale = quality.activeQuality.particleScale ?? 1;
    const count = Math.max(6, Math.round(8 + 6 * scale));
    const segments = Math.max(24, Math.round(32 + 20 * scale));
    const spacing = 1.25 + 0.45 * scale;
    return { count, segments, spacing };
  }

  function disposeRings() {
    if (group) {
      runtime.toy.scene.remove(group);
    }
    group = null;
    rings = [];
    disposeGeometry(geometry);
    disposeMaterial(material);
    geometry = null;
    material = null;
  }

  function rebuildRings() {
    disposeRings();
    const { count, segments, spacing } = getRingConfig();

    const nextGeometry = new THREE.RingGeometry(0.85, 1, segments);
    const nextMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(
        palette.baseHue,
        palette.saturation,
        0.55,
      ),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const nextGroup = new THREE.Group();
    const nextRings = Array.from({ length: count }, (_, index) => {
      const mesh = new THREE.Mesh(nextGeometry, nextMaterial);
      const baseScale = 2 + index * spacing;
      mesh.scale.setScalar(baseScale);
      mesh.rotation.z = index * 0.35;
      nextGroup.add(mesh);
      return { mesh, baseScale, pulseOffset: index * 0.45 };
    });

    geometry = nextGeometry;
    material = nextMaterial;
    group = nextGroup;
    rings = nextRings;

    runtime.toy.scene.add(nextGroup);
  }

  function animate(
    data: Uint8Array,
    time: number,
    input: { normalizedCentroid: { x: number; y: number } } | null,
  ) {
    if (!group || !material) return;

    const avg = getWeightedAverageFrequency(data) / 255;
    const bass = getBandAverage(data, 0, 0.28) / 255;
    const mids = getBandAverage(data, 0.28, 0.7) / 255;
    const treble = getBandAverage(data, 0.7, 1) / 255;

    const idlePulse = 0.24 + Math.sin(time * 1.35) * 0.11;
    const pulse = 0.95 + idlePulse + bass * 0.85;
    const driftX = (input?.normalizedCentroid.x ?? 0) * 2.2;
    const driftY = (input?.normalizedCentroid.y ?? 0) * 1.6;

    group.position.x = driftX;
    group.position.y = driftY;
    group.rotation.z = time * (0.08 + mids * 0.1);

    rings.forEach(({ mesh, baseScale, pulseOffset }) => {
      const ripple =
        Math.sin(time * (0.9 + mids * 0.28) + pulseOffset) *
        (0.2 + treble * 0.3);
      const scale = baseScale * (pulse + ripple);
      mesh.scale.setScalar(scale);
      mesh.rotation.z += 0.003 + mids * 0.002 + treble * 0.004;
    });

    const hue =
      (palette.baseHue + 0.06 * Math.sin(time * 0.6) + avg * 0.28) % 1;
    material.color.setHSL(hue, palette.saturation, 0.56 + avg * 0.24);
    material.opacity = 0.6 + avg * 0.25;
  }

  function setupSettingsPanel() {
    configurePanel();
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 28 } },
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
        name: 'mobile-ripples',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          setupSettingsPanel();
          rebuildRings();
        },
        update: ({ frequencyData, time, input }) => {
          animate(frequencyData, time, input);
        },
        dispose: () => {
          disposeRings();
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return () => {
    runtime.dispose();
  };
}
