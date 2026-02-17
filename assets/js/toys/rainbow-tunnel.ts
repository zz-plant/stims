import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import {
  disposeGeometry,
  disposeMaterial,
  disposeMesh,
} from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

interface RingData {
  outer: THREE.Mesh;
  inner?: THREE.Mesh;
  baseZ: number;
  hue: number;
}

export function start({ container }: ToyStartOptions = {}) {
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Rainbow tunnel',
    description: 'Preset tweaks update DPI and ring density together.',
    getRuntime: () => runtime,
    onChange: () => {
      rebuildScene();
    },
  });
  let runtime: ToyRuntimeInstance;

  const rings: RingData[] = [];
  let particleTrail: THREE.Points | null = null;
  let particleGeometry: THREE.BufferGeometry | null = null;
  let particleMaterial: THREE.PointsMaterial | null = null;
  const lightSources: THREE.PointLight[] = [];
  let tunnelLength = 0;

  function getTunnelConfig() {
    const scale = quality.activeQuality.particleScale ?? 1;
    const ringCount = Math.max(8, Math.round(20 * scale));
    const ringSpacing = 30;
    const tunnelLength = ringCount * ringSpacing;
    const particleCount = Math.max(320, Math.floor(680 * scale));
    const torusDetail = Math.max(24, Math.round(64 * Math.sqrt(scale)));
    return { ringCount, ringSpacing, tunnelLength, particleCount, torusDetail };
  }

  function disposeRingAssets() {
    rings.splice(0).forEach((ring) => {
      disposeMesh(ring.outer);
      if (ring.inner) {
        disposeMesh(ring.inner);
      }
    });

    lightSources.splice(0).forEach((light) => {
      runtime.toy.scene.remove(light);
    });

    if (particleTrail) {
      runtime.toy.scene.remove(particleTrail);
    }
    particleTrail = null;
    disposeGeometry(particleGeometry ?? undefined);
    disposeMaterial(particleMaterial);
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
      runtime.toy.scene.add(outerRing);

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
      runtime.toy.scene.add(innerRing);

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
      size: 0.75,
      transparent: true,
      opacity: 0.75,
    });
    particleTrail = new THREE.Points(particleGeometry, particleMaterial);
    runtime.toy.scene.add(particleTrail);

    const lightColors = [0xff0066, 0x00ff99, 0x6600ff, 0xffff00];
    lightColors.forEach((color, i) => {
      const light = new THREE.PointLight(color, 1, 100);
      light.position.z = -i * (tunnelLength / 4);
      runtime.toy.scene.add(light);
      lightSources.push(light);
    });
  }

  function animate(data: Uint8Array, time: number) {
    const avg = getWeightedAverageFrequency(data);
    const normalizedAvg = avg / 255;

    const binsPerRing = Math.max(
      1,
      Math.floor(data.length / Math.max(rings.length, 1)),
    );

    rings.forEach((ringData, idx) => {
      const bin = Math.min(Math.floor(idx * binsPerRing), data.length - 1);
      const value = data[bin] || 0;
      const normalizedValue = value / 255;

      // Rotate rings at varying speeds
      const idleEnergy = 0.18 + 0.16 * (Math.sin(time * 0.9 + idx * 0.24) + 1);
      const energy = Math.max(normalizedValue, idleEnergy);
      const rotationSpeed = 0.018 + energy * 0.06;
      ringData.outer.rotation.x += rotationSpeed;
      ringData.outer.rotation.z += rotationSpeed * 0.5;
      if (ringData.inner) {
        ringData.inner.rotation.x -= rotationSpeed * 0.7;
        ringData.inner.rotation.z -= rotationSpeed * 0.3;
      }

      // Pulsing scale based on audio
      const scale = 1.04 + energy * 0.45;
      ringData.outer.scale.set(scale, scale, 1);
      if (ringData.inner) {
        ringData.inner.scale.set(scale * 0.9, scale * 0.9, 1);
      }

      // Dynamic color shift
      const hueShift = (ringData.hue + normalizedAvg * 0.4 + time * 0.08) % 1;
      const outerMaterial = ringData.outer
        .material as THREE.MeshStandardMaterial;
      outerMaterial.color.setHSL(hueShift, 0.85, 0.55 + energy * 0.2);
      outerMaterial.emissive.setHSL(hueShift, 0.72, 0.18 + energy * 0.45);

      if (ringData.inner) {
        const innerMaterial = ringData.inner
          .material as THREE.MeshStandardMaterial;
        innerMaterial.color.setHSL(
          (hueShift + 0.1) % 1,
          0.9,
          0.64 + energy * 0.2,
        );
        innerMaterial.emissive.setHSL(
          (hueShift + 0.1) % 1,
          0.86,
          0.2 + energy * 0.5,
        );
        innerMaterial.opacity = 0.62 + energy * 0.3;
      }
    });

    // Smooth camera fly-through
    const flySpeed = 1.55 + normalizedAvg * 2.8;
    runtime.toy.camera.position.z -= flySpeed;

    // Add slight camera wobble
    runtime.toy.camera.position.x = Math.sin(time * 2.4) * 2.4;
    runtime.toy.camera.position.y = Math.cos(time * 1.85) * 2.2;

    // Reset camera when it reaches the end
    if (runtime.toy.camera.position.z < -tunnelLength + 50) {
      runtime.toy.camera.position.z = 100;
    }

    // Camera look-ahead
    runtime.toy.camera.lookAt(
      Math.sin(time * 0.5) * 3,
      Math.cos(time * 0.5) * 3,
      runtime.toy.camera.position.z - 50,
    );

    runtime.toy.render();
  }

  function setupSettingsPanel() {
    configurePanel();
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 100 } },
      lightingOptions: { type: 'HemisphereLight' },
      ambientLightOptions: { intensity: 0.4 },
      rendererOptions: {
        maxPixelRatio: quality.activeQuality.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 256 },
    plugins: [
      {
        name: 'rainbow-tunnel',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          setupSettingsPanel();
          rebuildScene();
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        dispose: () => {
          disposeRingAssets();
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return runtime;
}
