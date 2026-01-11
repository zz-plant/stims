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
import type { ToyConfig } from '../core/types';
import WebToy from '../core/web-toy';
import { getAverageFrequency } from '../utils/audio-handler';
import {
  resolveToyAudioOptions,
  type ToyAudioRequest,
} from '../utils/audio-start';
import { applyAudioColor } from '../utils/color-audio';
import { startToyAudio } from '../utils/start-audio';

type PresetKey = 'orbit' | 'nebula';

type PresetInstance = {
  animate: (ctx: AnimationContext) => void;
  dispose: () => void;
};

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const toy = new WebToy({
    cameraOptions: { position: { x: 0, y: 0, z: 80 } },
    ambientLightOptions: { intensity: 0.35 },
    rendererOptions: {
      maxPixelRatio: getActivePerformanceSettings().maxPixelRatio,
    },
    canvas: container?.querySelector('canvas'),
  } as ToyConfig);

  let activeQuality: QualityPreset = getActiveQualityPreset({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: 'balanced',
  });
  let performanceSettings: PerformanceSettings = getActivePerformanceSettings();

  let activePreset: PresetInstance | null = null;
  let activePresetKey: PresetKey = 'orbit';

  const presetButtons: Record<PresetKey, HTMLButtonElement> = {
    orbit: document.createElement('button'),
    nebula: document.createElement('button'),
  };

  function getParticleScale(quality: QualityPreset) {
    return (quality.particleScale ?? 1) * performanceSettings.particleBudget;
  }

  function createOrbitPreset(quality: QualityPreset): PresetInstance {
    const group = new THREE.Group();

    const particlesGeometry = new THREE.BufferGeometry();
    const detail = performanceSettings.shaderQuality === 'high' ? 1.2 : 1;
    const count = Math.max(
      900,
      Math.floor(2400 * getParticleScale(quality) * detail),
    );
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 90;
    }

    particlesGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    const particlesMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      transparent: true,
      opacity: 0.9,
      blending:
        performanceSettings.shaderQuality === 'low'
          ? THREE.NormalBlending
          : THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    group.add(particles);

    const light = new THREE.PointLight(0xffffff, 0.8);
    light.position.set(15, 20, 30);
    group.add(light);

    toy.scene.add(group);
    toy.camera.position.set(0, 0, 60);

    return {
      animate(ctx) {
        const data = getContextFrequencyData(ctx);
        const avg = getAverageFrequency(data);
        const rotationSpeed = 0.001 + avg / 100000;
        particles.rotation.y += rotationSpeed;
        particles.rotation.x += rotationSpeed / 2;

        particlesMaterial.size = 1.6 + avg / 50;
        const hue = (avg / 256) % 1;
        particlesMaterial.color.setHSL(hue, 0.7, 0.6);

        ctx.toy.render();
      },
      dispose() {
        toy.scene.remove(group);
        particlesGeometry.dispose();
        particlesMaterial.dispose();
      },
    };
  }

  function createNebulaPreset(quality: QualityPreset): PresetInstance {
    const group = new THREE.Group();

    const starGeometry = new THREE.BufferGeometry();
    const shaderDetail =
      performanceSettings.shaderQuality === 'high'
        ? 1.25
        : performanceSettings.shaderQuality === 'low'
          ? 0.9
          : 1;
    const STAR_COUNT = Math.max(
      1200,
      Math.floor(4000 * getParticleScale(quality) * shaderDetail),
    );
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starSizes = new Float32Array(STAR_COUNT);
    const starColors = new Float32Array(STAR_COUNT * 3);

    for (let i = 0; i < STAR_COUNT; i++) {
      const i3 = i * 3;
      starPositions[i3] = (Math.random() - 0.5) * 400;
      starPositions[i3 + 1] = (Math.random() - 0.5) * 400;
      starPositions[i3 + 2] = (Math.random() - 0.5) * 800 - 200;

      starSizes[i] = Math.random() * 2 + 0.5;

      const colorChoice = Math.random();
      if (colorChoice < 0.7) {
        starColors[i3] = 1;
        starColors[i3 + 1] = 1;
        starColors[i3 + 2] = 1;
      } else if (colorChoice < 0.85) {
        starColors[i3] = 0.6;
        starColors[i3 + 1] = 0.8;
        starColors[i3 + 2] = 1;
      } else {
        starColors[i3] = 1;
        starColors[i3 + 1] = 0.9;
        starColors[i3 + 2] = 0.6;
      }
    }

    const positionAttribute = new THREE.BufferAttribute(starPositions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    starGeometry.setAttribute('position', positionAttribute);

    const sizeAttribute = new THREE.BufferAttribute(starSizes, 1);
    sizeAttribute.setUsage(THREE.DynamicDrawUsage);
    starGeometry.setAttribute('size', sizeAttribute);
    starGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(starColors, 3),
    );

    const starMaterial = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    group.add(stars);

    const nebulaGeometry = new THREE.BufferGeometry();
    const NEBULA_COUNT = Math.max(
      80,
      Math.floor(200 * getParticleScale(quality) * shaderDetail),
    );
    const nebulaPositions = new Float32Array(NEBULA_COUNT * 3);
    const nebulaColors = new Float32Array(NEBULA_COUNT * 3);

    for (let i = 0; i < NEBULA_COUNT; i++) {
      const i3 = i * 3;
      const clusterX = (Math.floor(Math.random() * 3) - 1) * 100;
      const clusterY = (Math.floor(Math.random() * 3) - 1) * 50;
      nebulaPositions[i3] = clusterX + (Math.random() - 0.5) * 80;
      nebulaPositions[i3 + 1] = clusterY + (Math.random() - 0.5) * 60;
      nebulaPositions[i3 + 2] = (Math.random() - 0.5) * 200 - 100;

      const hue = 0.7 + Math.random() * 0.3;
      const color = new THREE.Color().setHSL(hue % 1, 0.6, 0.5);
      nebulaColors[i3] = color.r;
      nebulaColors[i3 + 1] = color.g;
      nebulaColors[i3 + 2] = color.b;
    }

    nebulaGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(nebulaPositions, 3),
    );
    nebulaGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(nebulaColors, 3),
    );

    const nebulaMaterial = new THREE.PointsMaterial({
      size: 15,
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      sizeAttenuation: true,
    });

    const nebulaParticles = new THREE.Points(nebulaGeometry, nebulaMaterial);
    group.add(nebulaParticles);

    const purpleLight = new THREE.PointLight(0x8800ff, 0.5, 500);
    purpleLight.position.set(-100, 50, -200);
    group.add(purpleLight);

    const blueLight = new THREE.PointLight(0x0088ff, 0.5, 500);
    blueLight.position.set(100, -50, -200);
    group.add(blueLight);

    toy.scene.add(group);
    toy.camera.position.set(0, 0, 100);

    return {
      animate(ctx) {
        const data = getContextFrequencyData(ctx);
        const avg = getAverageFrequency(data);
        const normalizedAvg = avg / 255;
        const time = Date.now() / 1000;

        const positions = stars.geometry.attributes.position
          .array as Float32Array;
        const warpSpeed = 0.5 + normalizedAvg * 3;

        for (let i = 0; i < STAR_COUNT; i++) {
          const i3 = i * 3;
          positions[i3 + 2] += warpSpeed;

          if (positions[i3 + 2] > 100) {
            positions[i3 + 2] = -600;
            positions[i3] = (Math.random() - 0.5) * 400;
            positions[i3 + 1] = (Math.random() - 0.5) * 400;
          }
        }
        stars.geometry.attributes.position.needsUpdate = true;

        const sizes = stars.geometry.attributes.size.array as Float32Array;
        for (let i = 0; i < STAR_COUNT; i++) {
          const twinkle = Math.sin(time * 10 + i * 0.1) * 0.3 + 0.7;
          sizes[i] = starSizes[i] * twinkle * (1 + normalizedAvg * 0.5);
        }
        stars.geometry.attributes.size.needsUpdate = true;

        stars.rotation.z += 0.0002 + normalizedAvg * 0.001;

        nebulaParticles.rotation.y += 0.001;
        nebulaParticles.rotation.x = Math.sin(time * 0.1) * 0.1;
        (nebulaParticles.material as THREE.PointsMaterial).opacity =
          0.2 + normalizedAvg * 0.3;

        const hueBase = (time * 0.05) % 1;
        applyAudioColor(starMaterial, normalizedAvg, {
          baseHue: hueBase,
          hueRange: 0.5,
          baseSaturation: 0.3,
          baseLuminance: 0.9,
        });

        toy.camera.position.x = Math.sin(time * 0.3) * 10;
        toy.camera.position.y = Math.cos(time * 0.2) * 5;
        toy.camera.lookAt(0, 0, -100);

        ctx.toy.render();
      },
      dispose() {
        toy.scene.remove(group);
        starGeometry.dispose();
        starMaterial.dispose();
        nebulaGeometry.dispose();
        nebulaMaterial.dispose();
      },
    };
  }

  function setActivePreset(key: PresetKey, { force } = { force: false }) {
    if (key === activePresetKey && activePreset && !force) return;

    activePreset?.dispose();
    activePreset =
      key === 'orbit'
        ? createOrbitPreset(activeQuality)
        : createNebulaPreset(activeQuality);
    activePresetKey = key;
    updatePresetButtons();
  }

  function updatePresetButtons() {
    (Object.keys(presetButtons) as PresetKey[]).forEach((key) => {
      const button = presetButtons[key];
      button.disabled = key === activePresetKey;
      button.classList.toggle('active', key === activePresetKey);
    });
  }

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    toy.updateRendererSettings({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: preset.renderScale,
    });
    setActivePreset(activePresetKey, { force: true });
  }

  function applyPerformanceSettings(settings: PerformanceSettings) {
    performanceSettings = settings;
    toy.updateRendererSettings({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    });
    setActivePreset(activePresetKey, { force: true });
  }

  function setupSettingsPanel() {
    const panel = getSettingsPanel();
    panel.configure({
      title: 'Cosmic controls',
      description:
        'Quality changes persist between toys so you can cap DPI or ramp visuals.',
    });

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });

    const presetRow = panel.addSection(
      'Cosmic preset',
      'Switch between swirling orbits and deep nebula fly-throughs.',
    );

    presetButtons.orbit.textContent = 'Orbit';
    presetButtons.nebula.textContent = 'Nebula';

    (Object.keys(presetButtons) as PresetKey[]).forEach((key) => {
      const button = presetButtons[key];
      button.className = 'cta-button';
      button.addEventListener('click', () => setActivePreset(key));
      presetRow.appendChild(button);
    });
  }

  function setupPerformancePanel() {
    getPerformancePanel({
      title: 'Performance',
      description:
        'Cap DPI, trim particle budgets, or lower shader detail for smoother play.',
    });

    return subscribeToPerformanceSettings(applyPerformanceSettings);
  }

  function animate(ctx: AnimationContext) {
    activePreset?.animate(ctx);
  }

  async function startAudio(request: ToyAudioRequest = false) {
    return startToyAudio(
      toy,
      animate,
      resolveToyAudioOptions(request, { fftSize: 256 }),
    );
  }

  setupSettingsPanel();
  const perfUnsub = setupPerformancePanel();
  setActivePreset(activePresetKey);

  // Register globals for toy.html buttons
  const win = (container?.ownerDocument.defaultView ?? window) as any;
  win.startAudio = startAudio;
  win.startAudioFallback = () => startAudio(true);

  return {
    dispose: () => {
      toy.dispose();
      activePreset?.dispose();
      perfUnsub();
      win.startAudio = undefined;
      win.startAudioFallback = undefined;
    },
  };
}
