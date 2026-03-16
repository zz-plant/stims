import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import {
  getBandLevels,
  getWeightedEnergy,
  updateEnergyPeak,
} from '../utils/audio-reactivity';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import {
  buildToySettingsPanel,
  createToyQualityControls,
} from '../utils/toy-settings';

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

export function start({ container }: ToyStartOptions = {}) {
  const { quality } = createToyQualityControls({
    title: 'Fractal Kite Garden',
    description:
      'Quality presets persist across toys so you can balance DPI and branching density.',
    getRuntime: () => runtime,
    onChange: () => {
      buildGarden();
      if (panelDensityInput) {
        panelDensityInput.value = settings.density.toString();
      }
    },
  });
  let runtime: ToyRuntimeInstance;
  let settingsPanel: ReturnType<typeof buildToySettingsPanel>;

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
  const tempSway = new THREE.Vector3();
  const tempTargetColor = new THREE.Color();
  const tempEmissive = new THREE.Color();
  const whiteColor = new THREE.Color(0xffffff);
  let panelDensityInput: HTMLInputElement | null = null;
  let audioPeak = 0.04;
  let bassPeak = 0.04;
  let treblePeak = 0.04;
  let previousMid = 0;

  function getDensity() {
    const scale = quality.activeQuality.particleScale ?? 1;
    return THREE.MathUtils.clamp(settings.density * scale, 0.25, 1.6);
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
          disposeGeometry(mesh.geometry);
        }
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => disposeMaterial(material));
        } else {
          disposeMaterial(mesh.material as THREE.Material);
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
    branchDepth: number,
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
      directionVector,
    );
    mesh.quaternion.copy(quaternion);
    mesh.rotateY((Math.random() - 0.5) * 0.6);

    kiteGroup.add(mesh);

    kiteInstances.push({
      mesh,
      basePosition: position.clone(),
      swayAxis: new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.6,
        Math.random() - 0.5,
      ).normalize(),
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
    maxKites: number,
  ) {
    if (depth <= 0 || kiteInstances.length >= maxKites) return;

    const segmentLength = 3 + Math.random() * 2;
    const nextPosition = origin
      .clone()
      .addScaledVector(direction, segmentLength);
    createKite(nextPosition, direction, depth);

    const remainingDepth = depth - 1;
    if (remainingDepth <= 0 || kiteInstances.length >= maxKites) return;

    const childCount =
      1 + Math.floor(Math.random() * (settings.density * 2 + 1));
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
    const density = getDensity();
    const maxKites = Math.floor(180 + density * 220);
    const branchDepth = 3 + Math.floor(density * 3);
    const branchCount = 8 + Math.floor(density * 12);

    for (let i = 0; i < branchCount; i++) {
      const angle = (i / branchCount) * Math.PI * 2 + Math.random() * 0.1;
      const radius = 6 + Math.random() * 4;
      const origin = new THREE.Vector3(
        Math.cos(angle) * radius,
        -3 + Math.random() * 1.5,
        Math.sin(angle) * radius,
      );
      const direction = new THREE.Vector3(
        -origin.x * 0.06 + (Math.random() - 0.5) * 0.2,
        1,
        -origin.z * 0.06 + (Math.random() - 0.5) * 0.2,
      ).normalize();

      growBranch(origin, direction, branchDepth, maxKites);
      if (kiteInstances.length >= maxKites) break;
    }

    runtime.toy.scene.add(kiteGroup);
  }

  function createControls() {
    const densityRow = settingsPanel.addSection(
      'Pattern density',
      'Higher settings add more branching kites.',
    );

    const densityInput = document.createElement('input');
    densityInput.type = 'range';
    densityInput.min = '0.25';
    densityInput.max = '1';
    densityInput.step = '0.05';
    densityInput.value = settings.density.toString();
    densityInput.className = 'control-panel__slider';
    densityInput.addEventListener('input', () => {
      settings.density = Number(densityInput.value);
      buildGarden();
    });
    panelDensityInput = densityInput;
    densityRow.appendChild(densityInput);
  }

  function setupSettingsPanel() {
    settingsPanel = buildToySettingsPanel({
      title: 'Fractal Kite Garden',
      description:
        'Quality presets persist across toys so you can balance DPI and branching density.',
      quality,
      sections: [
        {
          title: 'Color palette',
          description: 'Switch gradients without resetting audio.',
          controls: [
            {
              type: 'button-group',
              options: (Object.keys(palettes) as PaletteKey[]).map(
                (paletteKey) => ({
                  id: paletteKey,
                  label:
                    paletteKey.charAt(0).toUpperCase() + paletteKey.slice(1),
                }),
              ),
              getActiveId: () => settings.palette,
              onChange: (paletteKey) => {
                settings.palette = paletteKey as PaletteKey;
                buildGarden();
              },
              buttonClassName: 'cta-button',
              activeClassName: 'active',
              setDisabledOnActive: true,
              setAriaPressed: false,
            },
          ],
        },
      ],
    });
  }

  function init() {
    runtime.toy.scene.fog = new THREE.FogExp2(0x030712, 0.028);
    runtime.toy.rendererReady.then((result) => {
      if (result) {
        result.renderer.setClearColor(0x030712, 1);
      }
    });
    setupSettingsPanel();
    createControls();
    buildGarden();
  }

  function animate(data: Uint8Array, time: number) {
    const bands = getBandLevels({ data, ratios: { bass: 0.18, mid: 0.62 } });
    const weightedEnergy = getWeightedEnergy(bands, {
      boost: 1.45,
      weights: { bass: 0.2, mid: 0.5, treble: 0.3 },
    });
    audioPeak = updateEnergyPeak(audioPeak, weightedEnergy, {
      decay: 0.94,
      floor: 0.04,
    });
    bassPeak = updateEnergyPeak(bassPeak, bands.bass, {
      decay: 0.92,
      floor: 0.03,
    });
    treblePeak = updateEnergyPeak(treblePeak, bands.treble, {
      decay: 0.9,
      floor: 0.03,
    });
    const midRise = Math.max(0, bands.mid - previousMid);
    previousMid = bands.mid;

    kiteInstances.forEach((kite) => {
      const mesh = kite.mesh;
      const flutter =
        Math.sin(time * (0.0012 + bands.mid * 0.0009) + kite.flutterSpeed) *
        (0.4 + bands.mid * 2 + midRise * 1.5);
      tempSway
        .copy(kite.swayAxis)
        .multiplyScalar(
          flutter *
            (0.6 + kite.branchDepth * 0.35 + bassPeak * 0.45 + audioPeak * 0.2),
        );

      mesh.position.copy(kite.basePosition).add(tempSway);
      mesh.rotation.z =
        kite.twist +
        Math.sin(time * 0.0009 + kite.flutterSpeed * 2) *
          (0.18 + bands.mid * 0.18) +
        bands.mid * 0.45 +
        midRise * 0.22;
      mesh.rotation.y += 0.0025 + treblePeak * 0.03 + audioPeak * 0.006;
      mesh.rotation.x =
        Math.cos(time * 0.0007 + kite.flutterSpeed) * (0.05 + bassPeak * 0.18);

      const scale =
        0.9 +
        kite.branchDepth * 0.06 +
        treblePeak * 0.85 +
        bands.mid * 0.4 +
        bassPeak * 0.18 +
        midRise * 0.24;
      mesh.scale.setScalar(scale);

      const material = mesh.material as THREE.MeshStandardMaterial;
      tempTargetColor
        .copy(kite.baseColor)
        .lerp(
          whiteColor,
          Math.min(1, treblePeak * 0.75 + bands.mid * 0.25 + audioPeak * 0.18),
        );
      material.color.copy(tempTargetColor);
      tempEmissive
        .copy(tempTargetColor)
        .multiplyScalar(0.18 + treblePeak * 0.42 + bassPeak * 0.16);
      material.emissive.copy(tempEmissive);
      material.opacity = 0.88 + treblePeak * 0.08;
    });

    runtime.toy.camera.position.x =
      Math.sin(time * 0.0005) * (2 + bands.mid * 4);
    runtime.toy.camera.position.y =
      6 + Math.cos(time * 0.0004) * (1 + bassPeak * 2);
    runtime.toy.camera.lookAt(0, 1 + bands.mid * 2, 0);

    runtime.toy.render();
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 6, z: 26 } },
      lightingOptions: {
        type: 'DirectionalLight',
        position: { x: -6, y: 12, z: 8 },
        intensity: 1.15,
      },
      ambientLightOptions: { intensity: 0.35 },
      rendererOptions: {
        maxPixelRatio: quality.activeQuality.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 512 },
    plugins: [
      {
        name: 'fractal-kite-garden',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          init();
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        dispose: () => {
          disposeGarden();
          if (kiteGeometry) {
            kiteGeometry.dispose();
            kiteGeometry = null;
          }
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return runtime;
}
