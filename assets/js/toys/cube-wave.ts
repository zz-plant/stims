import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { type AudioColorParams, applyAudioColor } from '../utils/color-audio';
import { disposeObject3D } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import {
  buildSingleButtonGroupPanel,
  createToyQualityControls,
} from '../utils/toy-settings';
import type { UnifiedInputState } from '../utils/unified-input';

type ShapeMode = 'cubes' | 'spheres';

type GridItem = {
  mesh: THREE.Mesh;
  row: number;
  col: number;
};

type GridPreset = {
  label: string;
  primitive: ShapeMode;
  grid: {
    rows: number;
    cols: number;
    spacingX: number;
    spacingZ: number;
  };
  geometryFactory: (row: number, col: number) => THREE.BufferGeometry;
  materialFactory: (row: number, col: number) => THREE.MeshStandardMaterial;
  colorFor: (row: number, col: number) => AudioColorParams;
  animation: {
    heightMode: 'position' | 'scaleY';
    baseHeight: number;
    audioHeight: number;
    wave?: {
      amplitude: number;
      frequency: number;
      phase: (row: number, col: number) => number;
    };
    baseScale: number;
    audioScale: number;
    rotation: {
      x?: number;
      y?: number;
      audioBoost?: number;
    };
  };
  camera: {
    position: THREE.Vector3;
    lookAtY: number;
    sway?: {
      amplitude: number;
      frequency: number;
    };
  };
  extras?: (group: THREE.Group) => void;
  updateExtras?: (group: THREE.Group, time: number, avg: number) => void;
};

export function start({ container }: ToyStartOptions = {}) {
  const gridGroup = new THREE.Group();
  const gridItems: GridItem[] = [];

  const { quality } = createToyQualityControls({
    title: 'Grid visualizer',
    description:
      'Adjust render resolution caps and switch primitives without restarting audio.',
    defaultPresetId: 'balanced',
    getRuntime: () => runtime,
    onChange: () => {
      rebuildGrid(activeMode);
    },
  });
  let runtime: ToyRuntimeInstance;
  const controls = {
    energyBoost: 1,
    cameraDrift: 1,
  };
  let targetEnergyBoost = controls.energyBoost;
  let targetCameraDrift = controls.cameraDrift;
  let rotationLatch = 0;

  const presets: Record<ShapeMode, GridPreset> = {
    cubes: {
      label: 'Cubes',
      primitive: 'cubes',
      grid: { rows: 12, cols: 12, spacingX: 4.5, spacingZ: 4.5 },
      geometryFactory: () => new THREE.BoxGeometry(4, 4, 4),
      materialFactory: () =>
        new THREE.MeshStandardMaterial({
          color: 0x66ccff,
          metalness: 0.25,
          roughness: 0.3,
          emissive: 0x152844,
          emissiveIntensity: 0.4,
        }),
      colorFor: () => ({
        baseHue: 0.58,
        hueRange: -0.5,
        baseSaturation: 0.8,
        baseLuminance: 0.5,
        luminanceRange: 0.3,
        emissive: {
          baseHue: 0.58,
          hueRange: -0.25,
          baseSaturation: 0.55,
          baseLuminance: 0.06,
          luminanceRange: 0.22,
        },
      }),
      animation: {
        heightMode: 'scaleY',
        baseHeight: 0,
        audioHeight: 0,
        wave: {
          amplitude: 1.2,
          frequency: 2.2,
          phase: (row, col) => row * 0.25 + col * 0.25,
        },
        baseScale: 1,
        audioScale: 1.8,
        rotation: { y: 0.01, audioBoost: 0.035 },
      },
      camera: {
        position: new THREE.Vector3(0, 30, 80),
        lookAtY: 2,
        sway: { amplitude: 3, frequency: 0.18 },
      },
      extras: (group) => {
        const floor = new THREE.Mesh(
          new THREE.CircleGeometry(56, 48),
          new THREE.MeshStandardMaterial({
            color: 0x080b18,
            roughness: 0.75,
            metalness: 0.1,
          }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -2.5;
        group.add(floor);

        const rimLight = new THREE.PointLight(0x66ccff, 0.7, 120);
        rimLight.position.set(-36, 26, 32);
        group.add(rimLight);

        const fillLight = new THREE.PointLight(0xff66aa, 0.55, 110);
        fillLight.position.set(36, 18, -26);
        group.add(fillLight);
      },
    },
    spheres: {
      label: 'Spheres',
      primitive: 'spheres',
      grid: { rows: 3, cols: 7, spacingX: 8, spacingZ: 10 },
      geometryFactory: () => new THREE.SphereGeometry(2.5, 32, 32),
      materialFactory: (_row, col) => {
        const hue = (col / 7) * 0.3 + 0.8;
        return new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(hue % 1, 0.7, 0.5),
          metalness: 0.4,
          roughness: 0.28,
          emissive: new THREE.Color().setHSL(hue % 1, 0.5, 0.08),
        });
      },
      colorFor: (_row, col) => {
        const baseHue = (col / 7) * 0.3 + 0.8;
        return {
          baseHue,
          hueRange: 0.2,
          baseSaturation: 0.7,
          saturationRange: 0.3,
          baseLuminance: 0.5,
          luminanceRange: 0.2,
          emissive: {
            baseHue,
            baseSaturation: 0.5,
            baseLuminance: 0,
            luminanceRange: 0.3,
          },
        };
      },
      animation: {
        heightMode: 'position',
        baseHeight: 0,
        audioHeight: 15,
        wave: {
          amplitude: 3,
          frequency: 3,
          phase: (row, col) => col * 0.3 + row * 0.5,
        },
        baseScale: 1,
        audioScale: 0.5,
        rotation: { x: 0.01, y: 0.015, audioBoost: 0.05 },
      },
      camera: {
        position: new THREE.Vector3(0, 26, 70),
        lookAtY: 5,
        sway: { amplitude: 5, frequency: 0.2 },
      },
      extras: (group) => {
        const floorGeometry = new THREE.PlaneGeometry(100, 60);
        const floorMaterial = new THREE.MeshStandardMaterial({
          color: 0x111122,
          metalness: 0.9,
          roughness: 0.2,
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -8;
        group.add(floor);

        const colors = [0xff00ff, 0x00ffff, 0xffff00];
        colors.forEach((color, i) => {
          const light = new THREE.PointLight(color, 0.5, 50);
          light.position.set((i - 1) * 30, 20, 0);
          group.add(light);
        });
      },
    },
  };

  let currentPreset: GridPreset = presets.cubes;
  let activeMode: ShapeMode = 'spheres';

  function getGridConfig(preset: GridPreset) {
    const particleScale = quality.activeQuality.particleScale ?? 1;
    const scale = Math.max(0.6, particleScale);
    const rows = Math.max(2, Math.round(preset.grid.rows * scale));
    const cols = Math.max(2, Math.round(preset.grid.cols * scale));
    const spacingScale = 1 / Math.max(Math.sqrt(scale), 0.75);

    return {
      rows,
      cols,
      spacingX: preset.grid.spacingX * spacingScale,
      spacingZ: preset.grid.spacingZ * spacingScale,
    };
  }

  function disposeGroup(group: THREE.Group) {
    disposeObject3D(group, { removeFromParent: false, clearChildren: true });
  }

  function rebuildGrid(mode: ShapeMode) {
    disposeGroup(gridGroup);
    currentPreset = presets[mode];
    activeMode = mode;

    runtime.toy.camera.position.copy(currentPreset.camera.position);
    runtime.toy.camera.lookAt(0, currentPreset.camera.lookAtY, 0);

    const { rows, cols, spacingX, spacingZ } = getGridConfig(currentPreset);
    const startX = -((cols - 1) * spacingX) / 2;
    const startZ = -((rows - 1) * spacingZ) / 2;

    if (currentPreset.extras) {
      currentPreset.extras(gridGroup);
    }

    gridItems.length = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const geometry = currentPreset.geometryFactory(row, col);
        const material = currentPreset.materialFactory(row, col);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
          startX + col * spacingX,
          currentPreset.animation.baseHeight,
          startZ + row * spacingZ,
        );
        gridGroup.add(mesh);
        gridItems.push({ mesh, row, col });
      }
    }
  }

  function setupSettingsPanel() {
    buildSingleButtonGroupPanel({
      title: 'Grid visualizer',
      description:
        'Switch mode with one tap. The active mode stays highlighted.',
      quality,
      section: {
        title: 'Shape mode',
        description: 'Cubes pop harder, spheres feel smoother.',
      },
      buttonGroup: {
        type: 'button-group',
        options: Object.entries(presets).map(([key, preset]) => ({
          id: key,
          label: preset.label,
        })),
        getActiveId: () => activeMode,
        onChange: (mode) => rebuildGrid(mode as ShapeMode),
        rowClassName: 'control-panel__row control-panel__mode-row',
        buttonClassName: 'control-panel__mode',
        activeClassName: 'is-active',
        dataAttribute: 'data-grid-mode',
        setAriaPressed: true,
      },
    });
  }

  function updateTransforms(
    item: GridItem,
    normalizedValue: number,
    rawValue: number,
    time: number,
  ) {
    const { mesh, row, col } = item;
    const anim = currentPreset.animation;
    const waveOffset =
      anim.wave?.amplitude && anim.wave.frequency
        ? Math.sin(time * anim.wave.frequency + anim.wave.phase(row, col)) *
          anim.wave.amplitude
        : 0;

    if (anim.heightMode === 'position') {
      mesh.position.y =
        anim.baseHeight + waveOffset + normalizedValue * anim.audioHeight;
      const scale = anim.baseScale + normalizedValue * anim.audioScale;
      mesh.scale.setScalar(scale);
    } else {
      const yScale = anim.baseScale + normalizedValue * anim.audioScale;
      mesh.scale.set(1, yScale, 1);
      mesh.position.y = anim.baseHeight + waveOffset;
    }

    if (anim.rotation.x) {
      mesh.rotation.x +=
        anim.rotation.x + normalizedValue * (anim.rotation.audioBoost ?? 0);
    }
    if (anim.rotation.y) {
      mesh.rotation.y +=
        anim.rotation.y +
        rawValue / 100000 +
        normalizedValue * (anim.rotation.audioBoost ?? 0);
    }

    const colorParams = currentPreset.colorFor(row, col);
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => {
        applyAudioColor(material, normalizedValue, colorParams);
      });
    } else {
      applyAudioColor(
        mesh.material as THREE.MeshStandardMaterial,
        normalizedValue,
        colorParams,
      );
    }
  }

  function animate(dataArray: Uint8Array, time: number) {
    controls.energyBoost = THREE.MathUtils.lerp(
      controls.energyBoost,
      targetEnergyBoost,
      0.08,
    );
    controls.cameraDrift = THREE.MathUtils.lerp(
      controls.cameraDrift,
      targetCameraDrift,
      0.08,
    );
    const avg = getWeightedAverageFrequency(dataArray);

    const binsPerItem = dataArray.length / Math.max(gridItems.length, 1);

    gridItems.forEach((item, index) => {
      const bin = Math.floor(index * binsPerItem);
      const value = dataArray[bin] ?? avg;
      const normalizedValue = THREE.MathUtils.clamp(
        (value / 255) * controls.energyBoost,
        0,
        1.4,
      );
      updateTransforms(item, normalizedValue, value, time);
    });

    const sway = currentPreset.camera.sway;
    if (sway) {
      runtime.toy.camera.position.x =
        Math.sin(time * sway.frequency) * sway.amplitude * controls.cameraDrift;
      runtime.toy.camera.position.z =
        currentPreset.camera.position.z - (controls.energyBoost - 1) * 10;
      runtime.toy.camera.lookAt(0, currentPreset.camera.lookAtY, 0);
    }

    currentPreset.updateExtras?.(gridGroup, time, avg);

    runtime.toy.render();
  }

  function switchMode(direction: 1 | -1) {
    const modeKeys = Object.keys(presets) as ShapeMode[];
    const currentIndex = modeKeys.indexOf(activeMode);
    const nextIndex =
      (currentIndex + direction + modeKeys.length) % modeKeys.length;
    rebuildGrid(modeKeys[nextIndex]);
  }

  function handleInput(state: UnifiedInputState | null) {
    if (!state || state.pointerCount === 0) {
      rotationLatch = 0;
      return;
    }

    targetEnergyBoost = THREE.MathUtils.clamp(
      1 + state.normalizedCentroid.y * 0.6,
      0.65,
      1.9,
    );
    targetCameraDrift = THREE.MathUtils.clamp(
      1 + state.normalizedCentroid.x * 0.45,
      0.6,
      1.7,
    );

    const gesture = state.gesture;
    if (!gesture || gesture.pointerCount < 2) return;

    targetEnergyBoost = THREE.MathUtils.clamp(
      targetEnergyBoost + (gesture.scale - 1) * 0.6,
      0.65,
      2,
    );
    if (rotationLatch <= 0.45 && gesture.rotation > 0.45) {
      switchMode(1);
    } else if (rotationLatch >= -0.45 && gesture.rotation < -0.45) {
      switchMode(-1);
    }
    rotationLatch = gesture.rotation;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      switchMode(1);
    } else if (event.key === 'ArrowLeft') {
      switchMode(-1);
    } else if (event.key === 'ArrowUp') {
      targetEnergyBoost = THREE.MathUtils.clamp(
        targetEnergyBoost + 0.1,
        0.65,
        2,
      );
    } else if (event.key === 'ArrowDown') {
      targetEnergyBoost = THREE.MathUtils.clamp(
        targetEnergyBoost - 0.1,
        0.65,
        2,
      );
    }
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 30, z: 80 } },
      lightingOptions: {
        type: 'DirectionalLight',
        position: { x: 0, y: 50, z: 50 },
        intensity: 1.25,
      },
      ambientLightOptions: { intensity: 0.6 },
    },
    audio: { fftSize: 256 },
    input: {
      onInput: (state) => handleInput(state),
    },
    plugins: [
      {
        name: 'cube-wave',
        setup: ({ toy }) => {
          toy.scene.add(gridGroup);
          window.addEventListener('keydown', handleKeydown);
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        dispose: () => {
          disposeGroup(gridGroup);
          window.removeEventListener('keydown', handleKeydown);
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  setupSettingsPanel();
  rebuildGrid(activeMode);

  return runtime;
}
