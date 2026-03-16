import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import { getBandAverage } from '../utils/audio-bands';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

type ParticleField = {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  positions: Float32Array;
  laneOffsets: Float32Array;
  baseHeights: Float32Array;
  depths: Float32Array;
  speeds: Float32Array;
  phases: Float32Array;
  directions: Float32Array;
};

export function start({ container }: ToyStartOptions = {}) {
  let runtime: ToyRuntimeInstance | null = null;
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Heel-Toe Comets',
    description:
      'Diagonal comet lanes built for 160 BPM footwork rushes, hats, and chopped samples.',
    storageKey: 'stims:heel-toe-comets:quality',
    getRuntime: () => runtime,
    onChange: () => rebuildField(),
  });

  let particleField: ParticleField | null = null;
  const palette = {
    background: new THREE.Color('#06030f'),
    hue: 0.88,
  };

  function getParticleConfig() {
    const scale = quality.activeQuality.particleScale ?? 1;
    return {
      count: Math.max(260, Math.round(620 * scale)),
      depthMin: -90,
      depthMax: 18,
    };
  }

  function disposeField() {
    if (particleField && runtime) {
      runtime.toy.scene.remove(particleField.points);
      disposeGeometry(particleField.geometry);
      disposeMaterial(particleField.material);
    }
    particleField = null;
  }

  function rebuildField() {
    if (!runtime) return;

    disposeField();

    const { count, depthMin, depthMax } = getParticleConfig();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const laneOffsets = new Float32Array(count);
    const baseHeights = new Float32Array(count);
    const depths = new Float32Array(count);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    const directions = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      const lane = Math.floor(Math.random() * 5) - 2;
      const direction = index % 2 === 0 ? 1 : -1;
      const depth = THREE.MathUtils.lerp(depthMin, depthMax, Math.random());
      const i3 = index * 3;

      laneOffsets[index] = lane * 2.4 + (Math.random() - 0.5) * 1.2;
      baseHeights[index] = (Math.random() - 0.5) * 12 + lane * 0.7;
      depths[index] = depth;
      speeds[index] = 0.6 + Math.random() * 1.4;
      phases[index] = Math.random() * Math.PI * 2;
      directions[index] = direction;

      positions[i3] = laneOffsets[index];
      positions[i3 + 1] = baseHeights[index];
      positions[i3 + 2] = depth;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: new THREE.Color().setHSL(palette.hue, 0.9, 0.6),
      size: 0.34,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    runtime.toy.scene.add(points);
    particleField = {
      points,
      geometry,
      material,
      positions,
      laneOffsets,
      baseHeights,
      depths,
      speeds,
      phases,
      directions,
    };
  }

  function animate(
    data: Uint8Array,
    time: number,
    deltaMs: number,
    input: ToyRuntimeFrame['input'],
  ) {
    if (!particleField) return;

    const avg = getWeightedAverageFrequency(data) / 255;
    const bass = getBandAverage(data, 0, 0.18) / 255;
    const mids = getBandAverage(data, 0.18, 0.58) / 255;
    const treble = getBandAverage(data, 0.58, 1) / 255;
    const deltaSeconds = Math.max(0.001, deltaMs / 1000);
    const pointerX = input?.normalizedCentroid.x ?? 0;
    const pointerY = input?.normalizedCentroid.y ?? 0;
    const field = particleField;
    const { array } = field.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const positions = array as Float32Array;
    const forwardRush = 16 + bass * 46 + treble * 28;
    const stutter = 0.55 + treble * 2.1;

    field.points.position.x = pointerX * 1.8;
    field.points.position.y = pointerY * 1.3;
    field.points.rotation.z = pointerX * 0.12 + time * 0.08;

    for (let index = 0; index < field.speeds.length; index += 1) {
      const i3 = index * 3;
      const nextDepth =
        field.depths[index] + field.speeds[index] * forwardRush * deltaSeconds;
      field.depths[index] = nextDepth > 18 ? -90 : nextDepth;

      if (nextDepth > 18) {
        field.baseHeights[index] = (Math.random() - 0.5) * 12;
        field.laneOffsets[index] =
          (Math.floor(Math.random() * 5) - 2) * 2.4 + (Math.random() - 0.5);
        field.directions[index] *= -1;
      }

      const phase = field.phases[index];
      const depth = field.depths[index];
      const slash =
        Math.sin(time * (10 + treble * 12) + phase) *
        field.directions[index] *
        stutter;
      const heelToe =
        Math.cos(time * (6.5 + mids * 6) + phase) * (0.3 + bass * 0.9);

      positions[i3] =
        field.laneOffsets[index] +
        slash +
        depth * 0.035 * field.directions[index];
      positions[i3 + 1] =
        field.baseHeights[index] +
        Math.sin(depth * 0.1 + phase) * (0.6 + mids * 1.1) +
        heelToe;
      positions[i3 + 2] = depth;
    }

    (
      field.geometry.getAttribute('position') as THREE.BufferAttribute
    ).needsUpdate = true;

    field.material.color.setHSL(
      (palette.hue + bass * 0.05 + treble * 0.18 + time * 0.012) % 1,
      0.92,
      0.52 + avg * 0.24,
    );
    field.material.opacity = 0.5 + avg * 0.28 + treble * 0.2;
    field.material.size = 0.18 + bass * 0.36 + treble * 0.42;
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 30 } },
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
        name: 'heel-toe-comets',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          configurePanel();
          rebuildField();
        },
        update: ({ frequencyData, time, deltaMs, input }) => {
          animate(frequencyData, time, deltaMs, input);
        },
        dispose: () => {
          disposeField();
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return () => {
    runtime?.dispose();
  };
}
