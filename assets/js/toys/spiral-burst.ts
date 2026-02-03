import * as THREE from 'three';
import {
  getActivePerformanceSettings,
  type PerformanceSettings,
} from '../core/performance-panel';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { createBeatTracker } from '../utils/audio-beat';
import type { FrequencyAnalyser } from '../utils/audio-handler';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { mapFrequencyToItems } from '../utils/audio-mapper';
import { applyAudioColor } from '../utils/color-audio';
import { createPerformanceSettingsHandler } from '../utils/performance-settings';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createAudioToyStarter } from '../utils/toy-runtime-starter';
import {
  buildToySettingsPanelWithPerformance,
  createToyQualityControls,
} from '../utils/toy-settings';
import type { UnifiedInputState } from '../utils/unified-input';

type SpiralMode = 'burst' | 'bloom' | 'vortex' | 'heartbeat';

type SpiralPalette = {
  name: string;
  baseHue: number;
  background: THREE.ColorRepresentation;
  fog: THREE.ColorRepresentation;
  bloom: THREE.ColorRepresentation;
  particle: THREE.ColorRepresentation;
};

type SpiralArm = {
  lines: THREE.Line[];
  group: THREE.Group;
  baseHue: number;
  phaseOffset: number;
  direction: number;
};

type ParticleField = {
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  points: THREE.Points;
  velocities: Float32Array;
  count: number;
};

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const { quality } = createToyQualityControls({
    title: 'Spiral Burst',
    description:
      'Explosive spirals that pulse with your music. Try different modes, pinch to amplify, and rotate to swap moods!',
    getRuntime: () => runtime,
    getRendererSettings: (preset) => ({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: preset.renderScale,
    }),
    onChange: () => {
      buildSpiralArms();
      disposeParticleField();
      particleField = createParticleField();
      createBloomMesh();
    },
  });
  let performanceSettings = getActivePerformanceSettings();
  let performanceSettingsHandler: ReturnType<
    typeof createPerformanceSettingsHandler
  > | null = null;
  let currentMode: SpiralMode = 'burst';
  let activePaletteIndex = 0;
  let runtime: ToyRuntimeInstance;

  const palettes: SpiralPalette[] = [
    {
      name: 'Solar Pulse',
      baseHue: 0.92,
      background: '#07020b',
      fog: '#07020b',
      bloom: '#ff7d9f',
      particle: '#ffb1cc',
    },
    {
      name: 'Ion Bloom',
      baseHue: 0.58,
      background: '#030316',
      fog: '#030316',
      bloom: '#7cf7ff',
      particle: '#a4e6ff',
    },
    {
      name: 'Cinder',
      baseHue: 0.02,
      background: '#120406',
      fog: '#120406',
      bloom: '#ff8a63',
      particle: '#ffc5a6',
    },
    {
      name: 'Ultraviolet',
      baseHue: 0.74,
      background: '#0a031a',
      fog: '#0a031a',
      bloom: '#cfa6ff',
      particle: '#f0d6ff',
    },
  ];

  const controls = {
    spinBoost: 1,
    pulseBoost: 1,
  };
  let targetSpinBoost = controls.spinBoost;
  let targetPulseBoost = controls.pulseBoost;
  let rotationLatch = 0;

  const spiralArms: SpiralArm[] = [];
  const spiralContainer = new THREE.Group();

  // Particle field for extra magic
  let particleField: ParticleField | null = null;

  // Beat detection
  let beatIntensity = 0;
  let smoothedBass = 0;
  let smoothedMids = 0;
  let smoothedHighs = 0;
  let beatFlash = 0;
  let beatStreak = 0;
  const beatTracker = createBeatTracker({
    threshold: 0.45,
    minIntervalMs: 120,
    smoothing: { bass: 0.85, mid: 0.9, treble: 0.92 },
    beatDecay: 0.92,
  });

  // Central bloom mesh
  let bloomMesh: THREE.Mesh | null = null;

  function getArmConfig() {
    const scale =
      (quality.activeQuality.particleScale ?? 1) *
      performanceSettings.particleBudget;
    const armCount = Math.max(3, Math.round(6 * scale));
    const linesPerArm = Math.max(8, Math.round(16 * scale));
    const pointsPerLine = Math.max(20, Math.round(40 * Math.sqrt(scale)));
    return { armCount, linesPerArm, pointsPerLine };
  }

  function getParticleCount() {
    const scale =
      (quality.activeQuality.particleScale ?? 1) *
      performanceSettings.particleBudget;
    return Math.max(400, Math.round(1200 * scale));
  }

  function createBloomMesh() {
    if (bloomMesh) {
      runtime.toy.scene.remove(bloomMesh);
      disposeGeometry(bloomMesh.geometry as THREE.BufferGeometry);
      disposeMaterial(bloomMesh.material as THREE.Material);
    }

    const geometry = new THREE.IcosahedronGeometry(8, 2);
    const palette = palettes[activePaletteIndex];
    const material = new THREE.MeshStandardMaterial({
      color: palette.bloom,
      emissive: palette.bloom,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.4,
      transparent: true,
      opacity: 0.85,
      wireframe: false,
    });

    bloomMesh = new THREE.Mesh(geometry, material);
    runtime.toy.scene.add(bloomMesh);
  }

  function createParticleField(): ParticleField {
    const count = getParticleCount();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const palette = palettes[activePaletteIndex];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 40 + Math.random() * 80;
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi) - 40;
      velocities[i] = 0.2 + Math.random() * 0.4;

      const hue = (palette.baseHue + Math.random() * 0.2) % 1;
      const color = new THREE.Color().setHSL(hue, 0.85, 0.6);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 1.5,
      sizeAttenuation: performanceSettings.shaderQuality !== 'low',
      transparent: true,
      opacity: 0.7,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    runtime.toy.scene.add(points);

    return { geometry, material, points, velocities, count };
  }

  function disposeSpiralArms() {
    spiralArms.forEach((arm) => {
      arm.lines.forEach((line) => {
        arm.group.remove(line);
        disposeGeometry(line.geometry);
        disposeMaterial(line.material as THREE.Material);
      });
      spiralContainer.remove(arm.group);
    });
    spiralArms.length = 0;
  }

  function disposeParticleField() {
    if (!particleField) return;
    runtime.toy.scene.remove(particleField.points);
    disposeGeometry(particleField.geometry);
    disposeMaterial(particleField.material);
    particleField = null;
  }

  function buildSpiralArms() {
    disposeSpiralArms();
    const { armCount, linesPerArm, pointsPerLine } = getArmConfig();

    for (let a = 0; a < armCount; a++) {
      const armGroup = new THREE.Group();
      const armLines: THREE.Line[] = [];
      const armHue = a / armCount;
      const phaseOffset = (a / armCount) * Math.PI * 2;
      const direction = a % 2 === 0 ? 1 : -1;

      for (let i = 0; i < linesPerArm; i++) {
        const geometry = new THREE.BufferGeometry();
        const points: THREE.Vector3[] = [];
        const lineOffset = (i / linesPerArm) * 0.5;

        for (let j = 0; j < pointsPerLine; j++) {
          const t = j / pointsPerLine;
          const angle = phaseOffset + t * Math.PI * 4 + lineOffset;
          const radius = t * 50 + i * 2;
          const wobble = Math.sin(t * Math.PI * 3 + i) * 3;

          points.push(
            new THREE.Vector3(
              Math.cos(angle) * radius + wobble,
              Math.sin(angle) * radius + wobble,
              t * 30 - 15,
            ),
          );
        }

        geometry.setFromPoints(points);

        const color = new THREE.Color().setHSL(
          (armHue + (i / linesPerArm) * 0.3) % 1,
          0.8,
          0.6,
        );
        const material = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.8,
          linewidth: 2,
        });

        const line = new THREE.Line(geometry, material);
        armGroup.add(line);
        armLines.push(line);
      }

      spiralContainer.add(armGroup);
      spiralArms.push({
        lines: armLines,
        group: armGroup,
        baseHue: armHue,
        phaseOffset,
        direction,
      });
    }
  }

  function applyPerformanceSettings(settings: PerformanceSettings) {
    performanceSettings = settings;
    buildSpiralArms();
    disposeParticleField();
    particleField = createParticleField();
  }

  function setMode(mode: SpiralMode) {
    currentMode = mode;
  }

  function setupSettingsPanel() {
    const modes: SpiralMode[] = ['burst', 'bloom', 'vortex', 'heartbeat'];
    buildToySettingsPanelWithPerformance({
      title: 'Spiral Burst',
      description:
        'Explosive spirals that pulse with your music. Try different modes, pinch to amplify, and rotate to swap moods!',
      quality,
      performance: {
        title: 'Performance',
        description: 'Adjust particle density and render quality.',
      },
      sections: [
        {
          title: 'Mode',
          description: 'Pick a spiral behavior.',
          controls: [
            {
              type: 'button-group',
              options: modes.map((mode) => ({
                id: mode,
                label: mode.charAt(0).toUpperCase() + mode.slice(1),
              })),
              getActiveId: () => currentMode,
              onChange: (mode) => setMode(mode as SpiralMode),
              rowClassName: 'control-panel__row control-panel__mode-row',
              buttonClassName: 'control-panel__mode',
              activeClassName: 'is-active',
              dataAttribute: 'data-spiral-mode',
              setAriaPressed: true,
            },
          ],
        },
      ],
    });
  }

  function applyPalette(index: number) {
    const palette = palettes[index];
    runtime.toy.scene.fog = new THREE.FogExp2(palette.fog, 0.008);
    runtime.toy.rendererReady.then((result) => {
      if (result) {
        result.renderer.setClearColor(palette.background, 1);
      }
    });

    spiralArms.forEach((arm) => {
      arm.lines.forEach((line) => {
        const lineMaterial = line.material as THREE.LineBasicMaterial;
        lineMaterial.color.setHSL(
          (palette.baseHue + Math.random() * 0.2) % 1,
          0.8,
          0.6,
        );
      });
    });

    if (particleField) {
      particleField.material.color = new THREE.Color(palette.particle);
    }

    if (bloomMesh) {
      const bloomMaterial = bloomMesh.material as THREE.MeshStandardMaterial;
      bloomMaterial.color = new THREE.Color(palette.bloom);
      bloomMaterial.emissive = new THREE.Color(palette.bloom);
    }
  }

  function animate(
    data: Uint8Array,
    time: number,
    analyser: FrequencyAnalyser | null,
  ) {
    const avg = getWeightedAverageFrequency(data);
    const normalizedAvg = avg / 255;

    // Multi-band frequency analysis using FrequencyAnalyser
    const energy = analyser
      ? analyser.getMultiBandEnergy()
      : { bass: 0, mid: 0, treble: 0 };

    const bass = energy.bass;
    const mids = energy.mid;
    const highs = energy.treble;

    const beatState = beatTracker.update(
      { bass, mid: mids, treble: highs },
      time,
    );
    smoothedBass = beatState.smoothedBands.bass;
    smoothedMids = beatState.smoothedBands.mid;
    smoothedHighs = beatState.smoothedBands.treble;
    beatIntensity = beatState.beatIntensity;
    if (beatState.isBeat) {
      beatFlash = 1;
      beatStreak = Math.min(1, beatStreak + 0.25 + smoothedHighs * 0.15);
    } else {
      beatFlash = Math.max(0, beatFlash - 0.08);
      beatStreak = Math.max(0, beatStreak * 0.985);
    }

    // Mode-specific behaviors
    controls.spinBoost = THREE.MathUtils.lerp(
      controls.spinBoost,
      targetSpinBoost,
      0.08,
    );
    controls.pulseBoost = THREE.MathUtils.lerp(
      controls.pulseBoost,
      targetPulseBoost,
      0.08,
    );

    let baseRotationSpeed = 0.005 * controls.spinBoost * (1 + beatStreak * 0.6);
    let expansionFactor = 1 + beatStreak * 0.15;
    let pulseIntensity = smoothedBass * controls.pulseBoost + beatFlash * 0.4;

    switch (currentMode) {
      case 'bloom':
        baseRotationSpeed = 0.002 * controls.spinBoost * (1 + beatStreak * 0.4);
        expansionFactor =
          1 + smoothedMids * 0.8 * controls.pulseBoost + beatStreak * 0.2;
        pulseIntensity = smoothedHighs * controls.pulseBoost + beatFlash * 0.35;
        break;
      case 'vortex':
        baseRotationSpeed =
          (0.015 + smoothedBass * 0.03) *
          controls.spinBoost *
          (1 + beatStreak * 0.5);
        expansionFactor =
          1 - smoothedBass * 0.3 * controls.pulseBoost + beatStreak * 0.1;
        break;
      case 'heartbeat':
        baseRotationSpeed = 0.003 * controls.spinBoost * (1 + beatStreak * 0.3);
        expansionFactor =
          1 + beatIntensity * 0.5 * controls.pulseBoost + beatStreak * 0.25;
        pulseIntensity = beatIntensity * controls.pulseBoost + beatFlash * 0.5;
        break;
      default: // burst
        expansionFactor =
          1 +
          smoothedBass * 0.6 * controls.pulseBoost +
          beatIntensity * 0.4 * controls.pulseBoost +
          beatStreak * 0.25;
        break;
    }

    // Animate spiral arms
    spiralArms.forEach((arm, armIdx) => {
      arm.group.rotation.z +=
        baseRotationSpeed * arm.direction * (1 + smoothedBass * 2);
      arm.group.rotation.x =
        Math.sin(time * 0.001 + armIdx) * 0.15 * smoothedMids;

      const armScale =
        expansionFactor + Math.sin(time * 0.002 + arm.phaseOffset) * 0.1;
      arm.group.scale.setScalar(armScale);

      mapFrequencyToItems(
        data,
        arm.lines,
        (line, idx, value) => {
          const normalizedValue = value / 255;
          const lineMaterial = line.material as THREE.LineBasicMaterial;

          // Dynamic rotation
          line.rotation.z += (0.001 + normalizedValue * 0.01) * arm.direction;

          // Pulsing scale
          const lineScale =
            1 + normalizedValue * pulseIntensity * 0.5 + beatFlash * 0.2;
          line.scale.setScalar(lineScale);

          // Color shifting
          const palette = palettes[activePaletteIndex];
          const hue =
            (palette.baseHue +
              arm.baseHue +
              (idx / arm.lines.length) * 0.2 +
              time * 0.0001 +
              normalizedValue * 0.15) %
            1;
          const saturation = 0.7 + normalizedValue * 0.3 + beatStreak * 0.2;
          const lightness = 0.4 + normalizedValue * 0.3 + beatFlash * 0.1;
          lineMaterial.color.setHSL(hue, saturation, lightness);
          lineMaterial.opacity = 0.5 + normalizedValue * 0.5 + beatFlash * 0.2;
        },
        { fallbackValue: avg },
      );
    });

    // Animate bloom mesh
    if (bloomMesh) {
      bloomMesh.rotation.x += 0.008 + smoothedMids * 0.02;
      bloomMesh.rotation.y += 0.012 + smoothedHighs * 0.015;

      const bloomScale =
        1 + smoothedBass * 0.8 + beatIntensity * 0.5 + beatFlash * 0.2;
      bloomMesh.scale.setScalar(bloomScale);

      const bloomMaterial = bloomMesh.material as THREE.MeshStandardMaterial;
      bloomMaterial.emissiveIntensity =
        0.3 + smoothedBass * 0.7 * controls.pulseBoost + beatFlash * 0.5;
      applyAudioColor(bloomMaterial, normalizedAvg, {
        baseHue: palettes[activePaletteIndex].baseHue,
        hueRange: 0.2,
        baseSaturation: 0.8,
        baseLuminance: 0.5,
      });
    }

    // Animate particle field
    if (particleField) {
      const positions = particleField.geometry.attributes.position
        .array as Float32Array;
      const colors = particleField.geometry.attributes.color
        .array as Float32Array;

      for (let i = 0; i < particleField.count; i++) {
        const i3 = i * 3;

        // Orbital motion
        const x = positions[i3];
        const y = positions[i3 + 1];
        const angle = Math.atan2(y, x);
        const radius = Math.sqrt(x * x + y * y);
        const orbitSpeed =
          particleField.velocities[i] *
          0.02 *
          (1 + smoothedMids * 2 + beatStreak * 0.6);

        const newAngle = angle + orbitSpeed;
        const radialPush =
          currentMode === 'burst' ? beatIntensity * 2 + beatFlash * 1.2 : 0;

        positions[i3] = Math.cos(newAngle) * (radius + radialPush);
        positions[i3 + 1] = Math.sin(newAngle) * (radius + radialPush);
        positions[i3 + 2] +=
          (smoothedBass * 3 - 0.5 + beatStreak * 0.8) *
          particleField.velocities[i];

        // Wrap around
        if (positions[i3 + 2] > 60) positions[i3 + 2] = -60;
        if (positions[i3 + 2] < -60) positions[i3 + 2] = 60;

        // Dynamic colors
        const palette = palettes[activePaletteIndex];
        const hue =
          (palette.baseHue +
            i / particleField.count +
            time * 0.00005 +
            smoothedHighs * 0.2) %
          1;
        const color = new THREE.Color().setHSL(
          hue,
          0.9 + beatStreak * 0.05,
          0.5 + smoothedHighs * 0.3 + beatFlash * 0.1,
        );
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;
      }

      particleField.geometry.attributes.position.needsUpdate = true;
      particleField.geometry.attributes.color.needsUpdate = true;
      particleField.material.size = 1.2 + smoothedBass * 2 + beatFlash * 0.8;
      particleField.material.opacity =
        0.5 + smoothedHighs * 0.4 + beatFlash * 0.2;
    }

    // Camera movement
    const camRadius = 110 + smoothedBass * 20 - beatFlash * 6;
    const camAngle = time * 0.0003;
    runtime.toy.camera.position.x =
      Math.sin(camAngle) * 20 + Math.sin(time * 0.01) * beatFlash * 0.8;
    runtime.toy.camera.position.y =
      Math.cos(camAngle * 0.7) * 15 + Math.cos(time * 0.012) * beatFlash * 0.6;
    runtime.toy.camera.position.z = camRadius;
    runtime.toy.camera.lookAt(0, 0, 0);

    // Background color pulse
    runtime.toy.rendererReady.then((result) => {
      if (result) {
        const palette = palettes[activePaletteIndex];
        const bgHue = (palette.baseHue + smoothedMids * 0.1) % 1;
        const bgColor = new THREE.Color().setHSL(
          bgHue,
          0.3,
          0.02 + beatIntensity * 0.03,
        );
        result.renderer.setClearColor(bgColor);
      }
    });

    runtime.toy.render();
  }

  function handleInput(state: UnifiedInputState | null) {
    if (!state || state.pointerCount === 0) {
      rotationLatch = 0;
      return;
    }
    const centroid = state.normalizedCentroid;
    targetSpinBoost = THREE.MathUtils.clamp(1 + centroid.x * 0.4, 0.6, 1.7);
    targetPulseBoost = THREE.MathUtils.clamp(1 + centroid.y * 0.45, 0.6, 1.8);

    const gesture = state.gesture;
    if (!gesture || gesture.pointerCount < 2) return;
    targetSpinBoost = THREE.MathUtils.clamp(
      targetSpinBoost + (gesture.scale - 1) * 0.5,
      0.6,
      1.9,
    );
    targetPulseBoost = THREE.MathUtils.clamp(
      targetPulseBoost + Math.abs(gesture.rotation) * 0.6,
      0.6,
      2,
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
      setMode(
        currentMode === 'burst'
          ? 'bloom'
          : currentMode === 'bloom'
            ? 'vortex'
            : currentMode === 'vortex'
              ? 'heartbeat'
              : 'burst',
      );
    } else if (event.key === 'ArrowDown') {
      setMode(
        currentMode === 'burst'
          ? 'heartbeat'
          : currentMode === 'heartbeat'
            ? 'vortex'
            : currentMode === 'vortex'
              ? 'bloom'
              : 'burst',
      );
    }
  }

  const startRuntime = createAudioToyStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 120 } },
      lightingOptions: { type: 'HemisphereLight', intensity: 0.6 },
      ambientLightOptions: { intensity: 0.3 },
      rendererOptions: {
        maxPixelRatio: performanceSettings.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 512 },
    input: {
      onInput: (state) => handleInput(state),
    },
    plugins: [
      {
        name: 'spiral-burst',
        setup: ({ toy }) => {
          toy.scene.add(spiralContainer);
          setupSettingsPanel();
          buildSpiralArms();
          particleField = createParticleField();
          createBloomMesh();
          applyPalette(activePaletteIndex);
          window.addEventListener('keydown', handleKeydown);
        },
        update: ({ frequencyData, time, analyser }) => {
          animate(frequencyData, time, analyser);
        },
        dispose: () => {
          disposeSpiralArms();
          disposeParticleField();
          if (bloomMesh) {
            runtime.toy.scene.remove(bloomMesh);
            disposeGeometry(bloomMesh.geometry as THREE.BufferGeometry);
            disposeMaterial(bloomMesh.material as THREE.Material);
          }
          window.removeEventListener('keydown', handleKeydown);
        },
      },
    ],
  });

  runtime = startRuntime({ container });
  performanceSettingsHandler = createPerformanceSettingsHandler({
    applyRendererSettings: (settings) => {
      runtime.toy.updateRendererSettings({
        maxPixelRatio: settings.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      });
    },
    onChange: applyPerformanceSettings,
  });
  performanceSettings = performanceSettingsHandler.getSettings();

  return {
    ...runtime,
    dispose: () => {
      performanceSettingsHandler?.dispose();
      runtime.dispose();
    },
  };
}
