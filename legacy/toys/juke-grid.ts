import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import { getBandAverage } from '../utils/audio-bands';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

type StripState = {
  mesh: THREE.Mesh;
  basePosition: number;
  phase: number;
};

export function start({ container }: ToyStartOptions = {}) {
  let runtime: ToyRuntimeInstance | null = null;
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Juke Grid',
    description:
      'A razor-cut lattice tuned for footwork kicks, snares, and chopped vocal syncopation.',
    storageKey: 'stims:juke-grid:quality',
    getRuntime: () => runtime,
    onChange: () => rebuildGrid(),
  });

  let gridGroup: THREE.Group | null = null;
  let columnGeometry: THREE.BoxGeometry | null = null;
  let rowGeometry: THREE.BoxGeometry | null = null;
  let columnMaterial: THREE.MeshBasicMaterial | null = null;
  let rowMaterial: THREE.MeshBasicMaterial | null = null;
  let columns: StripState[] = [];
  let rows: StripState[] = [];

  const palette = {
    background: new THREE.Color('#04060f'),
    columnHue: 0.03,
    rowHue: 0.57,
  };

  function getGridConfig() {
    const scale = quality.activeQuality.particleScale ?? 1;
    return {
      columns: Math.max(8, Math.round(12 * scale)),
      rows: Math.max(6, Math.round(9 * scale)),
      width: 24,
      height: 18,
    };
  }

  function disposeGrid() {
    if (gridGroup && runtime) {
      runtime.toy.scene.remove(gridGroup);
    }

    gridGroup = null;
    columns = [];
    rows = [];
    disposeGeometry(columnGeometry);
    disposeGeometry(rowGeometry);
    disposeMaterial(columnMaterial);
    disposeMaterial(rowMaterial);
    columnGeometry = null;
    rowGeometry = null;
    columnMaterial = null;
    rowMaterial = null;
  }

  function rebuildGrid() {
    if (!runtime) return;

    disposeGrid();

    const {
      columns: columnCount,
      rows: rowCount,
      width,
      height,
    } = getGridConfig();
    const nextGroup = new THREE.Group();

    const nextColumnGeometry = new THREE.BoxGeometry(0.22, height, 0.3);
    const nextRowGeometry = new THREE.BoxGeometry(width, 0.22, 0.3);
    const nextColumnMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(palette.columnHue, 0.9, 0.56),
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const nextRowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(palette.rowHue, 0.88, 0.55),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const nextColumns = Array.from({ length: columnCount }, (_, index) => {
      const mesh = new THREE.Mesh(nextColumnGeometry, nextColumnMaterial);
      const position =
        THREE.MathUtils.mapLinear(
          index,
          0,
          columnCount - 1,
          -width / 2,
          width / 2,
        ) || 0;
      mesh.position.set(position, 0, -1.4 + (index % 2) * 0.8);
      nextGroup.add(mesh);
      return {
        mesh,
        basePosition: position,
        phase: (index / Math.max(1, columnCount)) * Math.PI * 2,
      };
    });

    const nextRows = Array.from({ length: rowCount }, (_, index) => {
      const mesh = new THREE.Mesh(nextRowGeometry, nextRowMaterial);
      const position =
        THREE.MathUtils.mapLinear(
          index,
          0,
          rowCount - 1,
          -height / 2,
          height / 2,
        ) || 0;
      mesh.position.set(0, position, -2.4 + (index % 3) * 0.8);
      nextGroup.add(mesh);
      return {
        mesh,
        basePosition: position,
        phase: (index / Math.max(1, rowCount)) * Math.PI * 2,
      };
    });

    columnGeometry = nextColumnGeometry;
    rowGeometry = nextRowGeometry;
    columnMaterial = nextColumnMaterial;
    rowMaterial = nextRowMaterial;
    columns = nextColumns;
    rows = nextRows;
    gridGroup = nextGroup;
    runtime.toy.scene.add(nextGroup);
  }

  function animate(
    data: Uint8Array,
    time: number,
    input: ToyRuntimeFrame['input'],
  ) {
    if (!gridGroup || !columnMaterial || !rowMaterial) return;

    const avg = getWeightedAverageFrequency(data) / 255;
    const bass = getBandAverage(data, 0, 0.2) / 255;
    const mids = getBandAverage(data, 0.2, 0.62) / 255;
    const treble = getBandAverage(data, 0.62, 1) / 255;
    const pointerX = input?.normalizedCentroid.x ?? 0;
    const pointerY = input?.normalizedCentroid.y ?? 0;

    gridGroup.position.x = pointerX * 2.6;
    gridGroup.position.y = pointerY * 1.8;
    gridGroup.rotation.z = pointerX * 0.12;
    gridGroup.rotation.x = -pointerY * 0.08;

    const laneShuffle = 0.35 + mids * 2.4 + treble * 1.7;
    const slashAmount = 0.3 + treble * 1.5;

    for (const { mesh, basePosition, phase } of columns) {
      const swing = Math.sin(time * (8.5 + treble * 9) + phase) * laneShuffle;
      const lift = Math.cos(time * (4.4 + bass * 4) + phase) * (0.18 + bass);
      const stretch = 0.74 + bass * 1.3 + treble * 0.42;

      mesh.position.x = basePosition + swing;
      mesh.position.y = lift;
      mesh.scale.y = stretch;
      mesh.rotation.z = Math.sin(time * 6.2 + phase) * 0.04 + slashAmount * 0.1;
    }

    for (const { mesh, basePosition, phase } of rows) {
      const snap =
        Math.sin(time * (10.2 + mids * 11) + phase) * (0.22 + mids * 1.4);
      const surge = Math.cos(time * (5.8 + bass * 5.5) + phase) * slashAmount;
      const stretch = 0.78 + mids * 1.2 + bass * 0.25;

      mesh.position.x = surge;
      mesh.position.y = basePosition + snap;
      mesh.scale.x = stretch;
      mesh.rotation.z = Math.cos(time * 8 + phase) * 0.03 - slashAmount * 0.05;
    }

    columnMaterial.color.setHSL(
      (palette.columnHue + bass * 0.08 + treble * 0.04 + time * 0.01) % 1,
      0.9,
      0.48 + avg * 0.24,
    );
    rowMaterial.color.setHSL(
      (palette.rowHue + mids * 0.08 + treble * 0.1 + time * 0.015) % 1,
      0.86,
      0.48 + avg * 0.22,
    );
    columnMaterial.opacity = 0.52 + bass * 0.34 + treble * 0.12;
    rowMaterial.opacity = 0.48 + mids * 0.28 + treble * 0.18;
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
    audio: { fftSize: 512 },
    input: { touchAction: 'manipulation' },
    plugins: [
      {
        name: 'juke-grid',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          configurePanel();
          rebuildGrid();
        },
        update: ({ frequencyData, time, input }) => {
          animate(frequencyData, time, input);
        },
        dispose: () => {
          disposeGrid();
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return () => {
    runtime?.dispose();
  };
}
