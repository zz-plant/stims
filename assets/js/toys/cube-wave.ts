import * as THREE from 'three';
import {
  type AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  type QualityPreset,
} from '../core/settings-panel';
import type { ToyConfig } from '../core/types';
import WebToy from '../core/web-toy';
import { getAverageFrequency } from '../utils/audio-handler';
import {
  resolveToyAudioOptions,
  type ToyAudioRequest,
} from '../utils/audio-start';
import { type AudioColorParams, applyAudioColor } from '../utils/color-audio';
import { startToyAudio } from '../utils/start-audio';

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
};

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const toy = new WebToy({
    cameraOptions: { position: { x: 0, y: 30, z: 80 } },
    lightingOptions: {
      type: 'DirectionalLight',
      position: { x: 0, y: 50, z: 50 },
      intensity: 1.25,
    },
    ambientLightOptions: { intensity: 0.6 },
    canvas: container?.querySelector('canvas'),
  } as ToyConfig);

  const gridGroup = new THREE.Group();
  const gridItems: GridItem[] = [];

  let activeQuality: QualityPreset = getActiveQualityPreset({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: 'balanced',
  });

  const presets: Record<ShapeMode, GridPreset> = {
    cubes: {
      label: 'Cubes',
      primitive: 'cubes',
      grid: { rows: 10, cols: 10, spacingX: 5, spacingZ: 5 },
      geometryFactory: () => new THREE.BoxGeometry(4, 4, 4),
      materialFactory: () =>
        new THREE.MeshStandardMaterial({
          color: 0x66ccff,
          metalness: 0.35,
          roughness: 0.35,
        }),
      colorFor: () => ({
        baseHue: 0.58,
        hueRange: -0.45,
        baseSaturation: 0.8,
        baseLuminance: 0.5,
      }),
      animation: {
        heightMode: 'scaleY',
        baseHeight: 0,
        audioHeight: 0,
        baseScale: 1,
        audioScale: 1.2,
        rotation: { y: 0.006, audioBoost: 0.02 },
      },
      camera: {
        position: new THREE.Vector3(0, 30, 80),
        lookAtY: 0,
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
  let activeMode: ShapeMode = 'cubes';

  function getGridConfig(preset: GridPreset) {
    const particleScale = activeQuality.particleScale ?? 1;
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
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });
    group.clear();
  }

  function rebuildGrid(mode: ShapeMode) {
    disposeGroup(gridGroup);
    currentPreset = presets[mode];
    activeMode = mode;

    toy.camera.position.copy(currentPreset.camera.position);
    toy.camera.lookAt(0, currentPreset.camera.lookAtY, 0);

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

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    toy.updateRendererSettings({
      maxPixelRatio: preset.maxPixelRatio,
      renderScale: preset.renderScale,
    });
    rebuildGrid(activeMode);
  }

  function setupSettingsPanel() {
    const panel = getSettingsPanel();
    panel.configure({
      title: 'Grid visualizer',
      description:
        'Adjust render resolution caps and switch primitives without restarting audio.',
    });

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });

    const shapeRow = panel.addSection(
      'Shape',
      'Change the primitive without restarting audio.',
    );

    const select = document.createElement('select');
    select.className = 'control-panel__select';
    Object.entries(presets).forEach(([key, preset]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = preset.label;
      select.appendChild(option);
    });

    select.value = activeMode;
    select.addEventListener('change', () => {
      const nextMode = select.value as ShapeMode;
      rebuildGrid(nextMode);
    });

    shapeRow.appendChild(select);
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

  function animate(ctx: AnimationContext) {
    const dataArray = getContextFrequencyData(ctx);
    const avg = getAverageFrequency(dataArray);
    const time = Date.now() / 1000;

    const binsPerItem = dataArray.length / Math.max(gridItems.length, 1);

    gridItems.forEach((item, index) => {
      const bin = Math.floor(index * binsPerItem);
      const value = dataArray[bin] ?? avg;
      const normalizedValue = value / 255;
      updateTransforms(item, normalizedValue, value, time);
    });

    const sway = currentPreset.camera.sway;
    if (sway) {
      toy.camera.position.x = Math.sin(time * sway.frequency) * sway.amplitude;
      toy.camera.lookAt(0, currentPreset.camera.lookAtY, 0);
    }

    ctx.toy.render();
  }

  async function startAudio(request: ToyAudioRequest = false) {
    return startToyAudio(
      toy,
      animate,
      resolveToyAudioOptions(request, { fftSize: 256 }),
    );
  }

  toy.scene.add(gridGroup);
  setupSettingsPanel();
  rebuildGrid(activeMode);

  // Register globals for toy.html buttons
  const win = (container?.ownerDocument.defaultView ?? window) as any;
  win.startAudio = startAudio;
  win.startAudioFallback = () => startAudio(true);

  return {
    dispose: () => {
      toy.dispose();
      disposeGroup(gridGroup);
      win.startAudio = undefined;
      win.startAudioFallback = undefined;
    },
  };
}
