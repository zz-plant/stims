import * as THREE from 'three';
import {
  type AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import {
  getActivePerformanceSettings,
  getPerformancePanel,
  type PerformanceSettings,
  subscribeToPerformanceSettings,
} from '../core/performance-panel';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  type QualityPreset,
} from '../core/settings-panel';
import { registerToyGlobals } from '../core/toy-globals';
import type { ToyConfig } from '../core/types';
import WebToy from '../core/web-toy';
import { getAverageFrequency } from '../utils/audio-handler';
import { mapFrequencyToItems } from '../utils/audio-mapper';
import {
  resolveToyAudioOptions,
  type ToyAudioRequest,
} from '../utils/audio-start';
import { applyAudioColor } from '../utils/color-audio';
import { startToyAudio } from '../utils/start-audio';

type SpiralMode = 'burst' | 'bloom' | 'vortex' | 'heartbeat';

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
  const settingsPanel = getSettingsPanel();
  let activeQuality: QualityPreset = getActiveQualityPreset();
  let performanceSettings: PerformanceSettings = getActivePerformanceSettings();
  let currentMode: SpiralMode = 'burst';
  let modeRow: HTMLDivElement | null = null;

  const toy = new WebToy({
    cameraOptions: { position: { x: 0, y: 0, z: 120 } },
    lightingOptions: { type: 'HemisphereLight', intensity: 0.6 },
    ambientLightOptions: { intensity: 0.3 },
    rendererOptions: {
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    },
    canvas: container?.querySelector('canvas'),
  } as ToyConfig);

  const spiralArms: SpiralArm[] = [];
  const spiralContainer = new THREE.Group();
  toy.scene.add(spiralContainer);

  // Particle field for extra magic
  let particleField: ParticleField | null = null;

  // Beat detection
  let lastBeatTime = 0;
  let beatIntensity = 0;
  let smoothedBass = 0;
  let smoothedMids = 0;
  let smoothedHighs = 0;

  // Central bloom mesh
  let bloomMesh: THREE.Mesh | null = null;

  function getArmConfig() {
    const scale =
      (activeQuality.particleScale ?? 1) * performanceSettings.particleBudget;
    const armCount = Math.max(3, Math.round(6 * scale));
    const linesPerArm = Math.max(8, Math.round(16 * scale));
    const pointsPerLine = Math.max(20, Math.round(40 * Math.sqrt(scale)));
    return { armCount, linesPerArm, pointsPerLine };
  }

  function getParticleCount() {
    const scale =
      (activeQuality.particleScale ?? 1) * performanceSettings.particleBudget;
    return Math.max(400, Math.round(1200 * scale));
  }

  function createBloomMesh() {
    if (bloomMesh) {
      toy.scene.remove(bloomMesh);
      (bloomMesh.geometry as THREE.BufferGeometry).dispose();
      (bloomMesh.material as THREE.Material).dispose();
    }

    const geometry = new THREE.IcosahedronGeometry(8, 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff6688,
      emissive: 0xff2255,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.4,
      transparent: true,
      opacity: 0.85,
      wireframe: false,
    });

    bloomMesh = new THREE.Mesh(geometry, material);
    toy.scene.add(bloomMesh);
  }

  function createParticleField(): ParticleField {
    const count = getParticleCount();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 40 + Math.random() * 80;
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi) - 40;
      velocities[i] = 0.2 + Math.random() * 0.4;

      const hue = Math.random();
      const color = new THREE.Color().setHSL(hue, 0.8, 0.6);
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
    toy.scene.add(points);

    return { geometry, material, points, velocities, count };
  }

  function disposeSpiralArms() {
    spiralArms.forEach((arm) => {
      arm.lines.forEach((line) => {
        arm.group.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      spiralContainer.remove(arm.group);
    });
    spiralArms.length = 0;
  }

  function disposeParticleField() {
    if (!particleField) return;
    toy.scene.remove(particleField.points);
    particleField.geometry.dispose();
    particleField.material.dispose();
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

  function detectBeat(bass: number, time: number): boolean {
    const threshold = 0.55;
    const minInterval = 120; // ms
    if (bass > threshold && time - lastBeatTime > minInterval) {
      lastBeatTime = time;
      return true;
    }
    return false;
  }

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    toy.updateRendererSettings({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: preset.renderScale,
    });
    buildSpiralArms();
    disposeParticleField();
    particleField = createParticleField();
    createBloomMesh();
  }

  function applyPerformanceSettings(settings: PerformanceSettings) {
    performanceSettings = settings;
    toy.updateRendererSettings({
      maxPixelRatio: settings.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    });
    buildSpiralArms();
    disposeParticleField();
    particleField = createParticleField();
  }

  function setMode(mode: SpiralMode) {
    currentMode = mode;
    updateModeButtons();
  }

  function updateModeButtons() {
    const buttons = container?.querySelectorAll('[data-spiral-mode]');
    buttons?.forEach((btn) => {
      const mode = btn.getAttribute('data-spiral-mode');
      const isActive = mode === currentMode;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  function setupSettingsPanel() {
    settingsPanel.configure({
      title: 'Spiral Burst',
      description:
        'Explosive spirals that pulse with your music. Try different modes!',
    });
    settingsPanel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });

    // Add mode buttons
    modeRow?.remove();
    const row = document.createElement('div');
    row.className = 'control-panel__row control-panel__mode-row';
    modeRow = row;

    const modes: SpiralMode[] = ['burst', 'bloom', 'vortex', 'heartbeat'];
    modes.forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      btn.setAttribute('data-spiral-mode', mode);
      btn.className = 'control-panel__mode';
      btn.classList.toggle('is-active', mode === currentMode);
      btn.setAttribute('aria-pressed', String(mode === currentMode));
      btn.addEventListener('click', () => setMode(mode));
      row.appendChild(btn);
    });

    const panel = container?.querySelector('.control-panel');
    panel?.appendChild(row);
  }

  function setupPerformancePanel() {
    getPerformancePanel({
      title: 'Performance',
      description: 'Adjust particle density and render quality.',
    });
    return subscribeToPerformanceSettings(applyPerformanceSettings);
  }

  function animate(ctx: AnimationContext) {
    const data = getContextFrequencyData(ctx);
    const avg = getAverageFrequency(data);
    const normalizedAvg = avg / 255;
    const time = ctx.time;

    // Multi-band frequency analysis using FrequencyAnalyser
    const energy = ctx.analyser
      ? ctx.analyser.getMultiBandEnergy()
      : { bass: 0, mid: 0, treble: 0 };

    const bass = energy.bass;
    const mids = energy.mid;
    const highs = energy.treble;

    // Smooth values
    smoothedBass = smoothedBass * 0.85 + bass * 0.15;
    smoothedMids = smoothedMids * 0.9 + mids * 0.1;
    smoothedHighs = smoothedHighs * 0.92 + highs * 0.08;

    // Beat detection
    const isBeat = detectBeat(smoothedBass, time);
    if (isBeat) {
      beatIntensity = 1;
    }
    beatIntensity *= 0.92;

    // Mode-specific behaviors
    let baseRotationSpeed = 0.005;
    let expansionFactor = 1;
    let pulseIntensity = smoothedBass;

    switch (currentMode) {
      case 'bloom':
        baseRotationSpeed = 0.002;
        expansionFactor = 1 + smoothedMids * 0.8;
        pulseIntensity = smoothedHighs;
        break;
      case 'vortex':
        baseRotationSpeed = 0.015 + smoothedBass * 0.03;
        expansionFactor = 1 - smoothedBass * 0.3;
        break;
      case 'heartbeat':
        baseRotationSpeed = 0.003;
        expansionFactor = 1 + beatIntensity * 0.5;
        pulseIntensity = beatIntensity;
        break;
      default: // burst
        expansionFactor = 1 + smoothedBass * 0.6 + beatIntensity * 0.4;
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
          const lineScale = 1 + normalizedValue * pulseIntensity * 0.5;
          line.scale.setScalar(lineScale);

          // Color shifting
          const hue =
            (arm.baseHue +
              (idx / arm.lines.length) * 0.2 +
              time * 0.0001 +
              normalizedValue * 0.15) %
            1;
          const saturation = 0.7 + normalizedValue * 0.3;
          const lightness = 0.4 + normalizedValue * 0.3;
          lineMaterial.color.setHSL(hue, saturation, lightness);
          lineMaterial.opacity = 0.5 + normalizedValue * 0.5;
        },
        { fallbackValue: avg },
      );
    });

    // Animate bloom mesh
    if (bloomMesh) {
      bloomMesh.rotation.x += 0.008 + smoothedMids * 0.02;
      bloomMesh.rotation.y += 0.012 + smoothedHighs * 0.015;

      const bloomScale = 1 + smoothedBass * 0.8 + beatIntensity * 0.5;
      bloomMesh.scale.setScalar(bloomScale);

      const bloomMaterial = bloomMesh.material as THREE.MeshStandardMaterial;
      bloomMaterial.emissiveIntensity = 0.3 + smoothedBass * 0.7;
      applyAudioColor(bloomMaterial, normalizedAvg, {
        baseHue: 0.92,
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
          particleField.velocities[i] * 0.02 * (1 + smoothedMids * 2);

        const newAngle = angle + orbitSpeed;
        const radialPush = currentMode === 'burst' ? beatIntensity * 2 : 0;

        positions[i3] = Math.cos(newAngle) * (radius + radialPush);
        positions[i3 + 1] = Math.sin(newAngle) * (radius + radialPush);
        positions[i3 + 2] +=
          (smoothedBass * 3 - 0.5) * particleField.velocities[i];

        // Wrap around
        if (positions[i3 + 2] > 60) positions[i3 + 2] = -60;
        if (positions[i3 + 2] < -60) positions[i3 + 2] = 60;

        // Dynamic colors
        const hue =
          (i / particleField.count + time * 0.00005 + smoothedHighs * 0.2) % 1;
        const color = new THREE.Color().setHSL(
          hue,
          0.9,
          0.5 + smoothedHighs * 0.3,
        );
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;
      }

      particleField.geometry.attributes.position.needsUpdate = true;
      particleField.geometry.attributes.color.needsUpdate = true;
      particleField.material.size = 1.2 + smoothedBass * 2;
      particleField.material.opacity = 0.5 + smoothedHighs * 0.4;
    }

    // Camera movement
    const camRadius = 110 + smoothedBass * 20;
    const camAngle = time * 0.0003;
    toy.camera.position.x = Math.sin(camAngle) * 20;
    toy.camera.position.y = Math.cos(camAngle * 0.7) * 15;
    toy.camera.position.z = camRadius;
    toy.camera.lookAt(0, 0, 0);

    // Background color pulse
    toy.rendererReady.then((result) => {
      if (result) {
        const bgHue = (0.7 + smoothedMids * 0.1) % 1;
        const bgColor = new THREE.Color().setHSL(
          bgHue,
          0.3,
          0.02 + beatIntensity * 0.03,
        );
        result.renderer.setClearColor(bgColor);
      }
    });

    ctx.toy.render();
  }

  async function startAudio(request: ToyAudioRequest = false) {
    return startToyAudio(
      toy,
      animate,
      resolveToyAudioOptions(request, { fftSize: 512 }),
    );
  }

  setupSettingsPanel();
  const perfUnsub = setupPerformancePanel();
  buildSpiralArms();
  particleField = createParticleField();
  createBloomMesh();

  // Set up fog for depth
  toy.scene.fog = new THREE.FogExp2(0x050510, 0.008);
  toy.rendererReady.then((result) => {
    if (result) {
      result.renderer.setClearColor(0x050510, 1);
    }
  });

  const unregisterGlobals = registerToyGlobals(container, startAudio);

  return {
    dispose: () => {
      toy.dispose();
      disposeSpiralArms();
      disposeParticleField();
      if (bloomMesh) {
        toy.scene.remove(bloomMesh);
        (bloomMesh.geometry as THREE.BufferGeometry).dispose();
        (bloomMesh.material as THREE.Material).dispose();
      }
      modeRow?.remove();
      modeRow = null;
      perfUnsub();
      unregisterGlobals();
    },
  };
}
