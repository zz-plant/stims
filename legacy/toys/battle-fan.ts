import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import { getBandAverage } from '../utils/audio-bands';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

type SpokeState = {
  mesh: THREE.Mesh;
  angle: number;
  radius: number;
  phase: number;
  direction: number;
};

export function start({ container }: ToyStartOptions = {}) {
  let runtime: ToyRuntimeInstance | null = null;
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Battle Fan',
    description:
      'A radial fan of strobing bars that thrives on footwork call-and-response and rapid kick-snare flips.',
    storageKey: 'stims:battle-fan:quality',
    getRuntime: () => runtime,
    onChange: () => rebuildFan(),
  });

  let fanGroup: THREE.Group | null = null;
  let spokeGeometry: THREE.BoxGeometry | null = null;
  let spokeMaterial: THREE.MeshBasicMaterial | null = null;
  let centerGeometry: THREE.TorusGeometry | null = null;
  let centerMaterial: THREE.MeshBasicMaterial | null = null;
  let centerRing: THREE.Mesh | null = null;
  let spokes: SpokeState[] = [];
  let previousTreble = 0;

  const palette = {
    background: new THREE.Color('#100309'),
    baseHue: 0.94,
  };

  function getFanConfig() {
    const scale = quality.activeQuality.particleScale ?? 1;
    return {
      count: Math.max(20, Math.round(36 * scale)),
      innerRadius: 4.5,
      outerRadius: 9.5,
    };
  }

  function disposeFan() {
    if (fanGroup && runtime) {
      runtime.toy.scene.remove(fanGroup);
    }

    fanGroup = null;
    centerRing = null;
    spokes = [];
    disposeGeometry(spokeGeometry);
    disposeGeometry(centerGeometry);
    disposeMaterial(spokeMaterial);
    disposeMaterial(centerMaterial);
    spokeGeometry = null;
    centerGeometry = null;
    spokeMaterial = null;
    centerMaterial = null;
  }

  function rebuildFan() {
    if (!runtime) return;

    disposeFan();

    const { count, innerRadius, outerRadius } = getFanConfig();
    const nextGroup = new THREE.Group();
    const nextSpokeGeometry = new THREE.BoxGeometry(3.8, 0.26, 0.38);
    const nextSpokeMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(palette.baseHue, 0.88, 0.56),
      transparent: true,
      opacity: 0.74,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const nextCenterGeometry = new THREE.TorusGeometry(2.4, 0.22, 12, 48);
    const nextCenterMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.08, 0.9, 0.58),
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const nextSpokes = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2;
      const radius = index % 2 === 0 ? innerRadius : outerRadius;
      const mesh = new THREE.Mesh(nextSpokeGeometry, nextSpokeMaterial);
      mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      mesh.rotation.z = angle;
      nextGroup.add(mesh);

      return {
        mesh,
        angle,
        radius,
        phase: (index / Math.max(1, count)) * Math.PI * 2,
        direction: index % 2 === 0 ? 1 : -1,
      };
    });

    const nextCenterRing = new THREE.Mesh(
      nextCenterGeometry,
      nextCenterMaterial,
    );
    nextGroup.add(nextCenterRing);

    fanGroup = nextGroup;
    spokeGeometry = nextSpokeGeometry;
    spokeMaterial = nextSpokeMaterial;
    centerGeometry = nextCenterGeometry;
    centerMaterial = nextCenterMaterial;
    centerRing = nextCenterRing;
    spokes = nextSpokes;
    runtime.toy.scene.add(nextGroup);
  }

  function animate(
    data: Uint8Array,
    time: number,
    input: ToyRuntimeFrame['input'],
  ) {
    if (!fanGroup || !spokeMaterial || !centerMaterial || !centerRing) return;

    const avg = getWeightedAverageFrequency(data) / 255;
    const bass = getBandAverage(data, 0, 0.18) / 255;
    const mids = getBandAverage(data, 0.18, 0.58) / 255;
    const treble = getBandAverage(data, 0.58, 1) / 255;
    const trebleSpike = Math.max(0, treble - previousTreble);
    previousTreble = treble;
    const pointerX = input?.normalizedCentroid.x ?? 0;
    const pointerY = input?.normalizedCentroid.y ?? 0;

    fanGroup.position.x = pointerX * 1.8;
    fanGroup.position.y = pointerY * 1.8;
    fanGroup.rotation.z = time * (0.15 + mids * 0.24);

    for (const { mesh, angle, radius, phase, direction } of spokes) {
      const chop = Math.sin(time * (12 + treble * 12) + phase) * 0.5 + 0.5;
      const punch = bass * 1.4 + mids * 0.4 + trebleSpike * 1.8;
      const stretch = 0.55 + chop * (0.7 + treble * 0.9) + punch;
      const thickness = 0.9 + treble * 1.2;
      const orbit = angle + time * (0.35 + mids * 0.9) * direction;

      mesh.position.x = Math.cos(orbit) * radius;
      mesh.position.y = Math.sin(orbit) * radius;
      mesh.rotation.z = orbit + chop * 0.18 * direction;
      mesh.scale.x = stretch;
      mesh.scale.y = thickness;
    }

    centerRing.rotation.z = -time * (0.8 + treble * 0.7);
    centerRing.scale.setScalar(0.9 + bass * 0.8 + trebleSpike * 1.8);

    spokeMaterial.color.setHSL(
      (palette.baseHue + bass * 0.06 + treble * 0.1 + time * 0.02) % 1,
      0.88,
      0.46 + avg * 0.24,
    );
    centerMaterial.color.setHSL(
      (0.08 + bass * 0.1 + treble * 0.06 + time * 0.01) % 1,
      0.9,
      0.48 + avg * 0.22,
    );
    spokeMaterial.opacity =
      0.46 + bass * 0.2 + treble * 0.22 + trebleSpike * 0.3;
    centerMaterial.opacity = 0.58 + bass * 0.24 + trebleSpike * 0.26;
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 26 } },
      sceneOptions: { background: palette.background },
      rendererOptions: {
        maxPixelRatio: quality.activeQuality.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 512 },
    input: { touchAction: 'manipulation' },
    plugins: [
      {
        name: 'battle-fan',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          configurePanel();
          rebuildFan();
        },
        update: ({ frequencyData, time, input }) => {
          animate(frequencyData, time, input);
        },
        dispose: () => {
          disposeFan();
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return () => {
    runtime?.dispose();
  };
}
