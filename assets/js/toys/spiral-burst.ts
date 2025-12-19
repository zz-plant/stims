import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  getContextFrequencyData,
  AnimationContext,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { startToyAudio } from '../utils/start-audio';
import { mapFrequencyToItems } from '../utils/audio-mapper';
import {
  DEFAULT_QUALITY_PRESETS,
  getSettingsPanel,
  getStoredQualityPreset,
  type QualityPreset,
} from '../core/settings-panel';

const settingsPanel = getSettingsPanel();
let activeQuality: QualityPreset = getStoredQualityPreset();

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 100 } },
  lightingOptions: { type: 'HemisphereLight' },
  ambientLightOptions: {},
  rendererOptions: {
    maxPixelRatio: activeQuality.maxPixelRatio,
    renderScale: activeQuality.renderScale,
  },
} as ToyConfig);

const lines: THREE.Line[] = [];
const lineGroup = new THREE.Group();
toy.scene.add(lineGroup);

function getLineConfig() {
  const scale = activeQuality.particleScale ?? 1;
  const lineCount = Math.max(12, Math.round(50 * scale));
  const pointCount = Math.max(12, Math.round(30 * Math.sqrt(scale)));
  return { lineCount, pointCount };
}

function disposeLines() {
  lines.forEach((line) => {
    lineGroup.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  });
  lines.length = 0;
}

function init() {
  setupSettingsPanel();
  if (!lines.length) {
    buildLines();
  }
}

function buildLines() {
  disposeLines();
  const { lineCount, pointCount } = getLineConfig();
  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.BufferGeometry();
    const points = [];
    for (let j = 0; j < pointCount; j++) {
      const angle = j * 0.2 + i * 0.1;
      const radius = j * 0.5 + i;
      points.push(
        new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, j)
      );
    }
    geometry.setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: Math.random() * 0xffffff,
    });
    const line = new THREE.Line(geometry, material);
    lineGroup.add(line);
    lines.push(line);
  }
}

function applyQualityPreset(preset: QualityPreset) {
  activeQuality = preset;
  toy.updateRendererSettings({
    maxPixelRatio: preset.maxPixelRatio,
    renderScale: preset.renderScale,
  });
  buildLines();
}

function setupSettingsPanel() {
  settingsPanel.configure({
    title: 'Spiral burst',
    description: 'Match render scale and line density to your hardware.',
  });
  settingsPanel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: activeQuality.id,
    onChange: applyQualityPreset,
  });
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  mapFrequencyToItems(
    data,
    lines,
    (line, idx, value) => {
      line.rotation.z += 0.002 + value / 100000;
      line.rotation.x += 0.001 + idx / 10000;
      const scale = 1 + value / 256;
      line.scale.set(scale, scale, scale);
      const hue = (idx / lines.length + value / 512) % 1;
      (line.material as THREE.LineBasicMaterial).color.setHSL(hue, 0.6, 0.5);
    },
    { fallbackValue: avg }
  );
  ctx.toy.render();
}

async function startAudio(useSynthetic = false) {
  return startToyAudio(toy, animate, {
    fallbackToSynthetic: useSynthetic,
    preferSynthetic: useSynthetic,
  });
}

init();
(window as unknown as Record<string, unknown>).startAudio = startAudio;
(window as unknown as Record<string, unknown>).startAudioFallback = () =>
  startAudio(true);
