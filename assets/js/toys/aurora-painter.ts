import * as THREE from 'three';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import type { UnifiedInputState } from '../utils';
import {
  createToyQualityControls,
  createToyRuntimeStarter,
  disposeGeometry,
  disposeMesh,
  getBandAverage,
  getWeightedAverageFrequency,
} from '../utils';

type AuroraPalette = {
  name: string;
  background: THREE.ColorRepresentation;
  fog: THREE.ColorRepresentation;
  light: THREE.ColorRepresentation;
  emissive: THREE.ColorRepresentation;
  hueShift: number;
  saturation: number;
};

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Aurora painter',
    description:
      'Control render scale and ribbon density without restarting audio. Pinch to swell the ribbons and rotate to switch moods.',
    getRuntime: () => runtime,
    onChange: () => {
      rebuildRibbons();
    },
  });
  let activePaletteIndex = 0;

  const palettes: AuroraPalette[] = [
    {
      name: 'Polar',
      background: '#03060c',
      fog: '#03060c',
      light: '#aadfff',
      emissive: '#0b1327',
      hueShift: 0.52,
      saturation: 0.82,
    },
    {
      name: 'Solarflare',
      background: '#120509',
      fog: '#120509',
      light: '#ffd0b8',
      emissive: '#3b0e14',
      hueShift: 0.98,
      saturation: 0.78,
    },
    {
      name: 'Verdant',
      background: '#021512',
      fog: '#021512',
      light: '#b6ffe8',
      emissive: '#043326',
      hueShift: 0.34,
      saturation: 0.86,
    },
    {
      name: 'Amethyst',
      background: '#07051f',
      fog: '#07051f',
      light: '#e1c1ff',
      emissive: '#200e48',
      hueShift: 0.72,
      saturation: 0.8,
    },
  ];

  const controls = {
    speed: 1,
    glow: 1,
  };
  let targetSpeed = controls.speed;
  let targetGlow = controls.glow;
  let rotationLatch = 0;

  let runtime: ToyRuntimeInstance;
  const ribbonGroup = new THREE.Group();

  const RIBBON_COUNT = 6;
  const RIBBON_POINTS = 70;
  const TUBE_SEGMENTS = 140;
  let ribbonDetail = getRibbonDetail();

  const ribbons: {
    points: THREE.Vector3[];
    curve: THREE.CatmullRomCurve3;
    mesh: THREE.Mesh;
    colorOffset: number;
    tubeSegments: number;
  }[] = [];

  function randomRadius(base: number, variance: number) {
    return base + (Math.random() - 0.5) * variance;
  }

  function getRibbonDetail() {
    const density = Math.max(0.6, quality.activeQuality.particleScale ?? 1);
    return {
      count: Math.max(3, Math.round(RIBBON_COUNT * density)),
      points: Math.max(40, Math.round(RIBBON_POINTS * density)),
      tubeSegments: Math.max(
        70,
        Math.round(TUBE_SEGMENTS * Math.sqrt(density)),
      ),
      radiusBase: 0.55 * Math.max(0.75, Math.sqrt(density)),
    };
  }

  function buildRibbon(index: number) {
    const baseRadius = 6 + index * 0.6;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < ribbonDetail.points; i += 1) {
      const angle = (i / ribbonDetail.points) * Math.PI * 2 + index * 0.35;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * randomRadius(baseRadius, 4),
          Math.sin(angle) * randomRadius(3.5, 3),
          -i * 0.4 - index,
        ),
      );
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(
      curve,
      ribbonDetail.tubeSegments,
      0.6,
      14,
      false,
    );
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(
        (index / RIBBON_COUNT + 0.5) % 1,
        0.75,
        0.55,
      ),
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
    ribbonGroup.add(mesh);

    ribbons.push({
      points,
      curve,
      mesh,
      colorOffset: Math.random(),
      tubeSegments: ribbonDetail.tubeSegments,
    });
  }

  function updateRibbon(
    ribbon: (typeof ribbons)[number],
    data: Uint8Array,
    time: number,
  ) {
    const avg = getWeightedAverageFrequency(data);
    const bass = getBandAverage(data, 0, 0.32);
    const treble = getBandAverage(data, 0.65, 1);

    for (let i = ribbon.points.length - 1; i > 0; i -= 1) {
      ribbon.points[i].copy(ribbon.points[i - 1]);
    }

    const swirl = time * 0.65 + ribbon.colorOffset * Math.PI * 2;
    const sway =
      Math.sin(time * 1.3 + ribbon.colorOffset * 4) *
      (0.7 + bass / 260) *
      controls.speed;
    const lift =
      Math.cos(time * 0.9 + ribbon.colorOffset * 2) *
      (0.6 + treble / 400) *
      controls.speed;

    ribbon.points[0].set(
      Math.cos(swirl) * (8 + avg / 45) + sway,
      Math.sin(swirl * 0.8) * (5 + treble / 60) + lift,
      Math.sin(time * 0.35 + ribbon.colorOffset) * 3,
    );

    ribbon.curve.points = ribbon.points;
    disposeGeometry(ribbon.mesh.geometry);
    const radius = ribbonDetail.radiusBase + bass / 240;
    ribbon.mesh.geometry = new THREE.TubeGeometry(
      ribbon.curve,
      ribbon.tubeSegments,
      radius * (0.8 + controls.glow * 0.3),
      16,
      false,
    );

    const material = ribbon.mesh.material as THREE.MeshStandardMaterial;
    const palette = palettes[activePaletteIndex];
    const hue =
      (palette.hueShift + ribbon.colorOffset + avg / 360 + time * 0.025) % 1;
    material.color.setHSL(hue, palette.saturation, 0.52 + treble / 520);
    material.opacity = 0.45 + Math.min(0.45, bass / 260) * controls.glow;
    material.emissiveIntensity = 0.25 + (avg / 380) * controls.glow;
  }

  function animate(data: Uint8Array, time: number) {
    controls.speed = THREE.MathUtils.lerp(controls.speed, targetSpeed, 0.08);
    controls.glow = THREE.MathUtils.lerp(controls.glow, targetGlow, 0.08);

    const scaledTime = time * 1.5 * controls.speed;

    ribbons.forEach((ribbon) => updateRibbon(ribbon, data, scaledTime));

    runtime.toy.camera.position.z = 45 + Math.sin(scaledTime * 0.35) * 2.2;
    runtime.toy.camera.lookAt(0, 0, -4);

    runtime.toy.render();
  }

  function disposeRibbons() {
    ribbons.forEach((ribbon) => {
      disposeMesh(ribbon.mesh);
    });
    ribbons.length = 0;
  }

  function rebuildRibbons() {
    disposeRibbons();
    ribbonDetail = getRibbonDetail();
    for (let i = 0; i < ribbonDetail.count; i += 1) {
      buildRibbon(i);
    }
  }

  function setupSettingsPanel() {
    configurePanel();
  }

  function applyPalette(index: number) {
    const palette = palettes[index];
    runtime.toy.scene.background = new THREE.Color(palette.background);
    if (runtime.toy.scene.fog instanceof THREE.FogExp2) {
      runtime.toy.scene.fog.color = new THREE.Color(palette.fog);
    }
    const light = runtime.toy.scene.children.find(
      (child) => child instanceof THREE.DirectionalLight,
    ) as THREE.DirectionalLight | undefined;
    if (light) {
      light.color = new THREE.Color(palette.light);
    }
    ribbons.forEach((ribbon) => {
      const material = ribbon.mesh.material as THREE.MeshStandardMaterial;
      material.emissive = new THREE.Color(palette.emissive);
    });
  }

  function handleInput(state: UnifiedInputState | null) {
    if (!state || state.pointerCount === 0) {
      rotationLatch = 0;
      return;
    }
    const centroid = state.normalizedCentroid;
    targetGlow = THREE.MathUtils.clamp(1 + centroid.y * 0.35, 0.7, 1.6);
    targetSpeed = THREE.MathUtils.clamp(1 + centroid.x * 0.35, 0.7, 1.6);

    const gesture = state.gesture;
    if (!gesture || gesture.pointerCount < 2) return;
    targetGlow = THREE.MathUtils.clamp(
      targetGlow + (gesture.scale - 1) * 0.4,
      0.7,
      1.7,
    );
    targetSpeed = THREE.MathUtils.clamp(
      targetSpeed + gesture.translation.x * 0.5,
      0.6,
      1.8,
    );
    if (rotationLatch <= 0.45 && gesture.rotation > 0.45) {
      activePaletteIndex = (activePaletteIndex + 1) % palettes.length;
      applyPalette(activePaletteIndex);
    } else if (rotationLatch >= -0.45 && gesture.rotation < -0.45) {
      activePaletteIndex =
        (activePaletteIndex - 1 + palettes.length) % palettes.length;
      applyPalette(activePaletteIndex);
    }
    rotationLatch = gesture.rotation;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      activePaletteIndex = (activePaletteIndex + 1) % palettes.length;
      applyPalette(activePaletteIndex);
    } else if (event.key === 'ArrowLeft') {
      activePaletteIndex =
        (activePaletteIndex - 1 + palettes.length) % palettes.length;
      applyPalette(activePaletteIndex);
    } else if (event.key === 'ArrowUp') {
      targetSpeed = THREE.MathUtils.clamp(targetSpeed + 0.1, 0.6, 1.8);
    } else if (event.key === 'ArrowDown') {
      targetSpeed = THREE.MathUtils.clamp(targetSpeed - 0.1, 0.6, 1.8);
    }
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 45 }, fov: 60 },
      rendererOptions: {
        alpha: true,
        maxPixelRatio: quality.activeQuality.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
      ambientLightOptions: { intensity: 0.5, color: 0x0c1327 },
      lightingOptions: {
        type: 'DirectionalLight',
        color: 0xaadfff,
        intensity: 0.75,
        position: { x: 18, y: 26, z: 18 },
      },
    },
    audio: { fftSize: 512 },
    input: {
      onInput: (state) => handleInput(state),
    },
    plugins: [
      {
        name: 'aurora-painter',
        setup: ({ toy }) => {
          toy.scene.background = new THREE.Color(0x03060c);
          toy.scene.fog = new THREE.FogExp2(0x03060c, 0.025);
          toy.scene.add(ribbonGroup);
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        dispose: () => {
          disposeRibbons();
          window.removeEventListener('keydown', handleKeydown);
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  setupSettingsPanel();
  if (!ribbons.length) {
    rebuildRibbons();
  }
  applyPalette(activePaletteIndex);
  window.addEventListener('keydown', handleKeydown);

  return runtime;
}
