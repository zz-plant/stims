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

const settingsPanel = getSettingsPanel();
let activeQuality: QualityPreset = getActiveQualityPreset();
let performanceSettings: PerformanceSettings = getActivePerformanceSettings();

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 70 } },
  ambientLightOptions: { intensity: 0.25 },
  lightingOptions: {
    type: 'PointLight',
    position: { x: 20, y: 10, z: 40 },
    intensity: 0.4,
  },
  rendererOptions: {
    maxPixelRatio: performanceSettings.maxPixelRatio,
    renderScale: activeQuality.renderScale,
  },
} as ToyConfig);

type StarFieldBuffers = {
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  points: THREE.Points;
  count: number;
};

let starField: StarFieldBuffers | null = null;

function getShaderSizeMultiplier() {
  if (performanceSettings.shaderQuality === 'high') return 1.2;
  if (performanceSettings.shaderQuality === 'low') return 0.85;
  return 1;
}

function getStarCount() {
  const scale =
    (activeQuality.particleScale ?? 1) * performanceSettings.particleBudget;
  return Math.max(900, Math.floor(2400 * scale));
}

function createStarField(): StarFieldBuffers {
  const count = getStarCount();
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * 180;
    positions[i3 + 1] = (Math.random() - 0.5) * 140;
    positions[i3 + 2] = Math.random() * -600;

    velocities[i] = 0.4 + Math.random() * 0.8;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.2 * getShaderSizeMultiplier(),
    sizeAttenuation: performanceSettings.shaderQuality !== 'low',
    transparent: true,
    opacity: 0.9,
    blending:
      performanceSettings.shaderQuality === 'low'
        ? THREE.NormalBlending
        : THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  toy.scene.add(points);

  toy.scene.fog = new THREE.FogExp2(0x030712, 0.0008);
  toy.rendererReady.then((result) => {
    result?.renderer.setClearColor?.(0x030712, 1);
  });

  return { geometry, material, velocities, points, count };
}

function disposeStarField() {
  if (!starField) return;
  toy.scene.remove(starField.points);
  starField.geometry.dispose();
  starField.material.dispose();
  starField = null;
}

function resetStar(i: number, positions: Float32Array) {
  const i3 = i * 3;
  positions[i3] = (Math.random() - 0.5) * 180;
  positions[i3 + 1] = (Math.random() - 0.5) * 140;
  positions[i3 + 2] = -600;
}

function init() {
  setupSettingsPanel();
  setupPerformancePanel();
  if (!starField) {
    starField = createStarField();
  }
}

function applyQualityPreset(preset: QualityPreset) {
  activeQuality = preset;
  toy.updateRendererSettings({
    maxPixelRatio: performanceSettings.maxPixelRatio,
    renderScale: preset.renderScale,
  });
  disposeStarField();
  starField = createStarField();
}

function applyPerformanceSettings(settings: PerformanceSettings) {
  performanceSettings = settings;
  toy.updateRendererSettings({
    maxPixelRatio: performanceSettings.maxPixelRatio,
    renderScale: activeQuality.renderScale,
  });
  disposeStarField();
  starField = createStarField();
}

function setupSettingsPanel() {
  settingsPanel.configure({
    title: 'Star field',
    description: 'Tune render resolution and particle density for your GPU.',
  });
  settingsPanel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: activeQuality.id,
    onChange: applyQualityPreset,
  });
}

function setupPerformancePanel() {
  getPerformancePanel({
    title: 'Performance',
    description: 'Cap DPI or scale particle budgets to match your device.',
  });
  subscribeToPerformanceSettings(applyPerformanceSettings);
}

function animate(ctx: AnimationContext) {
  if (!starField) return;
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  const normalizedAvg = avg / 255;
  const time = ctx.time;

  const positions = starField.geometry.attributes.position
    .array as Float32Array;
  for (let i = 0; i < starField.count; i++) {
    const i3 = i * 3;
    const drift = Math.sin(time * 0.001 + i * 0.02) * 0.12;
    positions[i3] += drift;
    positions[i3 + 1] += Math.cos(time * 0.0012 + i * 0.015) * 0.09;
    positions[i3 + 2] += starField.velocities[i] * (1 + normalizedAvg * 3.5);

    if (positions[i3 + 2] > 80) {
      resetStar(i, positions);
    }
  }

  starField.geometry.attributes.position.needsUpdate = true;

  const baseSize = 1.2 * getShaderSizeMultiplier() + normalizedAvg * 2.2;
  starField.material.size = baseSize;
  starField.material.opacity = 0.65 + normalizedAvg * 0.3;
  applyAudioColor(starField.material, normalizedAvg, {
    baseHue: 0.6,
    hueRange: 0.35,
    baseSaturation: 0.3,
    baseLuminance: 0.82,
  });

  toy.camera.position.x = Math.sin(time * 0.0006) * 8;
  toy.camera.position.y = Math.cos(time * 0.0005) * 6;
  toy.camera.lookAt(0, 0, -120);

  ctx.toy.render();
}

async function startAudio(request: ToyAudioRequest = false) {
  return startToyAudio(
    toy,
    animate,
    resolveToyAudioOptions(request, { fftSize: 256 }),
  );
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
(window as unknown as Record<string, unknown>).startAudioFallback = () =>
  startAudio(true);
