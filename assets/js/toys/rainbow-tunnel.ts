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
import { startToyAudio } from '../utils/start-audio';

interface RingData {
  outer: THREE.Mesh;
  inner?: THREE.Mesh;
  baseZ: number;
  hue: number;
}

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const settingsPanel = getSettingsPanel();
  let activeQuality: QualityPreset = getActiveQualityPreset();

  const toy = new WebToy({
    cameraOptions: { position: { x: 0, y: 0, z: 100 } },
    lightingOptions: { type: 'HemisphereLight' },
    ambientLightOptions: { intensity: 0.4 },
    rendererOptions: {
      maxPixelRatio: activeQuality.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    },
    canvas: container?.querySelector('canvas'),
  } as ToyConfig);

  const rings: RingData[] = [];
  let particleTrail: THREE.Points | null = null;
  let particleGeometry: THREE.BufferGeometry | null = null;
  let particleMaterial: THREE.PointsMaterial | null = null;
  const lightSources: THREE.PointLight[] = [];
  let tunnelLength = 0;

  function getTunnelConfig() {
    const scale = activeQuality.particleScale ?? 1;
    const ringCount = Math.max(8, Math.round(20 * scale));
    const ringSpacing = 30;
    const tunnelLength = ringCount * ringSpacing;
    const particleCount = Math.max(250, Math.floor(500 * scale));
    const torusDetail = Math.max(24, Math.round(64 * Math.sqrt(scale)));
    return { ringCount, ringSpacing, tunnelLength, particleCount, torusDetail };
  }

  function disposeRingAssets() {
    rings.splice(0).forEach((ring) => {
      toy.scene.remove(ring.outer);
      ring.outer.geometry.dispose();
      (ring.outer.material as THREE.Material).dispose();
      if (ring.inner) {
        toy.scene.remove(ring.inner);
        ring.inner.geometry.dispose();
        (ring.inner.material as THREE.Material).dispose();
      }
    });

    lightSources.splice(0).forEach((light) => {
      toy.scene.remove(light);
    });

    if (particleTrail) {
      toy.scene.remove(particleTrail);
    }
    particleTrail = null;
    particleGeometry?.dispose();
    particleMaterial?.dispose();
    particleGeometry = null;
    particleMaterial = null;
  }

  function rebuildScene() {
    disposeRingAssets();
    const {
      ringCount,
      ringSpacing,
      tunnelLength: nextLength,
      particleCount,
      torusDetail,
    } = getTunnelConfig();
    tunnelLength = nextLength;

    for (let i = 0; i < ringCount; i++) {
      const hue = i / ringCount;
      const baseZ = -i * ringSpacing;

      const outerGeometry = new THREE.TorusGeometry(15, 2, 16, torusDetail);
      const outerMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, 0.8, 0.5),
        emissive: new THREE.Color().setHSL(hue, 0.5, 0.2),
        metalness: 0.6,
        roughness: 0.3,
      });
      const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
      outerRing.position.z = baseZ;
      toy.scene.add(outerRing);

      const innerGeometry = new THREE.TorusGeometry(12, 1, 16, torusDetail);
      const innerMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL((hue + 0.1) % 1, 0.9, 0.6),
        emissive: new THREE.Color().setHSL((hue + 0.1) % 1, 0.8, 0.4),
        transparent: true,
        opacity: 0.7,
        metalness: 0.8,
        roughness: 0.2,
      });
      const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
      innerRing.position.z = baseZ;
      toy.scene.add(innerRing);

      rings.push({
        outer: outerRing,
        inner: innerRing,
        baseZ,
        hue,
      });
    }

    particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 5 + Math.random() * 8;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = Math.random() * -tunnelLength;
    }

    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );
    particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.6,
    });
    particleTrail = new THREE.Points(particleGeometry, particleMaterial);
    toy.scene.add(particleTrail);

    const lightColors = [0xff0066, 0x00ff99, 0x6600ff, 0xffff00];
    lightColors.forEach((color, i) => {
      const light = new THREE.PointLight(color, 1, 100);
      light.position.z = -i * (tunnelLength / 4);
      toy.scene.add(light);
      lightSources.push(light);
    });
  }

  function animate(ctx: AnimationContext) {
    const data = getContextFrequencyData(ctx);
    const avg = getAverageFrequency(data);
    const normalizedAvg = avg / 255;
    const time = Date.now() / 1000;

    const binsPerRing = Math.max(
      1,
      Math.floor(data.length / Math.max(rings.length, 1)),
    );

    rings.forEach((ringData, idx) => {
      const bin = Math.min(Math.floor(idx * binsPerRing), data.length - 1);
      const value = data[bin] || 0;
      const normalizedValue = value / 255;

      // Rotate rings at varying speeds
      const rotationSpeed = 0.01 + normalizedValue * 0.05;
      ringData.outer.rotation.x += rotationSpeed;
      ringData.outer.rotation.z += rotationSpeed * 0.5;
      if (ringData.inner) {
        ringData.inner.rotation.x -= rotationSpeed * 0.7;
        ringData.inner.rotation.z -= rotationSpeed * 0.3;
      }

      // Pulsing scale based on audio
      const scale = 1 + normalizedValue * 0.4;
      ringData.outer.scale.set(scale, scale, 1);
      if (ringData.inner) {
        ringData.inner.scale.set(scale * 0.9, scale * 0.9, 1);
      }

      // Dynamic color shift
      const hueShift = (ringData.hue + normalizedAvg * 0.3 + time * 0.05) % 1;
      const outerMaterial = ringData.outer.material as THREE.MeshStandardMaterial;
      outerMaterial.color.setHSL(hueShift, 0.8, 0.5 + normalizedValue * 0.2);
      outerMaterial.emissive.setHSL(hueShift, 0.6, normalizedValue * 0.4);

      if (ringData.inner) {
        const innerMaterial = ringData.inner
          .material as THREE.MeshStandardMaterial;
        innerMaterial.color.setHSL(
          (hueShift + 0.1) % 1,
          0.9,
          0.6 + normalizedValue * 0.2,
        );
        innerMaterial.emissive.setHSL(
          (hueShift + 0.1) % 1,
          0.8,
          normalizedValue * 0.5,
        );
        innerMaterial.opacity = 0.5 + normalizedValue * 0.4;
      }
    });

    // Smooth camera fly-through
    const flySpeed = 0.8 + normalizedAvg * 2;
    toy.camera.position.z -= flySpeed;

    // Add slight camera wobble
    toy.camera.position.x = Math.sin(time * 2) * 2;
    toy.camera.position.y = Math.cos(time * 1.5) * 2;

    // Reset camera when it reaches the end
    if (toy.camera.position.z < -tunnelLength + 50) {
      toy.camera.position.z = 100;
    }

    // Camera look-ahead
    toy.camera.lookAt(
      Math.sin(time * 0.5) * 3,
      Math.cos(time * 0.5) * 3,
      toy.camera.position.z - 50,
    );

    ctx.toy.render();
  }

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    toy.updateRendererSettings({
      maxPixelRatio: preset.maxPixelRatio,
      renderScale: preset.renderScale,
    });
    rebuildScene();
  }

  function setupSettingsPanel() {
    settingsPanel.configure({
      title: 'Rainbow tunnel',
      description: 'Preset tweaks update DPI and ring density together.',
    });
    settingsPanel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });
  }

  async function startAudio(request: ToyAudioRequest = false) {
    return startToyAudio(
      toy,
      animate,
      resolveToyAudioOptions(request, { fftSize: 256 }),
    );
  }

  setupSettingsPanel();
  rebuildScene();

  // Register globals for toy.html buttons
  const win = (container?.ownerDocument.defaultView ?? window) as any;
  win.startAudio = startAudio;
  win.startAudioFallback = () => startAudio(true);

  return {
    dispose: () => {
      toy.dispose();
      disposeRingAssets();
      win.startAudio = undefined;
      win.startAudioFallback = undefined;
    },
  };
}
