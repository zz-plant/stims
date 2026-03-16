import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import {
  getBandLevels,
  getWeightedEnergy,
  updateEnergyPeak,
} from '../utils/audio-reactivity';
import {
  disposeGeometry,
  disposeMaterial,
  disposeMesh,
} from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import {
  buildToySettingsPanel,
  createRendererQualityManager,
} from '../utils/toy-settings';
import type { UnifiedInputState } from '../utils/unified-input';

interface RingData {
  outer: THREE.Mesh;
  inner?: THREE.Mesh;
  baseZ: number;
  hue: number;
}

type TunnelMotionMode = 'cruise' | 'glide' | 'burst';
type TunnelColorMode = 'steady' | 'neon' | 'prism';

export function start({ container }: ToyStartOptions = {}) {
  const quality = createRendererQualityManager({
    getRuntime: () => runtime,
    getRendererSettings: (preset) => ({
      maxPixelRatio: preset.maxPixelRatio,
      renderScale: preset.renderScale,
    }),
    onChange: () => {
      rebuildScene();
    },
  });
  let runtime: ToyRuntimeInstance;
  let currentMotionMode: TunnelMotionMode = 'glide';
  let currentColorMode: TunnelColorMode = 'neon';
  const motionModes: Record<
    TunnelMotionMode,
    { speed: number; wobble: number; forwardBias: number; cameraDrift: number }
  > = {
    cruise: { speed: 0.82, wobble: 0.6, forwardBias: 0.82, cameraDrift: 0.72 },
    glide: { speed: 1.02, wobble: 1.0, forwardBias: 1.0, cameraDrift: 1.0 },
    burst: { speed: 1.24, wobble: 1.28, forwardBias: 1.16, cameraDrift: 1.15 },
  };
  const colorModes: Record<TunnelColorMode, number> = {
    steady: 0,
    neon: 0.18,
    prism: 0.42,
  };

  const rings: RingData[] = [];
  const controls = {
    speed: motionModes.glide.speed,
    wobble: motionModes.glide.wobble,
    spectrumShift: colorModes.neon,
  };
  let targetSpeed = controls.speed;
  let targetWobble = controls.wobble;
  let targetSpectrumShift = controls.spectrumShift;
  let rotationLatch = 0;
  let particleTrail: THREE.Points | null = null;
  let particleGeometry: THREE.BufferGeometry | null = null;
  let particleMaterial: THREE.PointsMaterial | null = null;
  const lightSources: THREE.PointLight[] = [];
  let tunnelLength = 0;
  let energyPeak = 0.05;
  let bassPeak = 0.05;
  let treblePeak = 0.04;
  let previousBass = 0;

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

  function setMotionMode(mode: TunnelMotionMode) {
    currentMotionMode = mode;
    const profile = motionModes[mode];
    targetSpeed = profile.speed;
    targetWobble = profile.wobble;
  }

  function setColorMode(mode: TunnelColorMode) {
    currentColorMode = mode;
    targetSpectrumShift = colorModes[mode];
  }

  function animate(data: Uint8Array, time: number) {
    controls.speed = THREE.MathUtils.lerp(controls.speed, targetSpeed, 0.08);
    controls.wobble = THREE.MathUtils.lerp(controls.wobble, targetWobble, 0.08);
    controls.spectrumShift = THREE.MathUtils.lerp(
      controls.spectrumShift,
      targetSpectrumShift,
      0.08,
    );
    const bands = getBandLevels({ data });
    const weightedEnergy = getWeightedEnergy(bands, { boost: 1.55 });
    energyPeak = updateEnergyPeak(energyPeak, weightedEnergy, {
      decay: 0.94,
      floor: 0.05,
    });
    bassPeak = updateEnergyPeak(bassPeak, bands.bass, {
      decay: 0.91,
      floor: 0.04,
    });
    treblePeak = updateEnergyPeak(treblePeak, bands.treble, {
      decay: 0.89,
      floor: 0.03,
    });
    const bassRise = Math.max(0, bands.bass - previousBass);
    previousBass = bands.bass;

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
      const energy = Math.max(
        normalizedValue,
        idleEnergy,
        bassPeak * 0.65 + bands.mid * 0.35,
      );
      const rotationSpeed =
        (0.018 + energy * 0.06 + treblePeak * 0.03) * controls.speed;
      ringData.outer.rotation.x += rotationSpeed;
      ringData.outer.rotation.z +=
        rotationSpeed * (0.35 + controls.wobble * 0.2 + bands.mid * 0.18);
      if (ringData.inner) {
        ringData.inner.rotation.x -= rotationSpeed * (0.7 + bassPeak * 0.35);
        ringData.inner.rotation.z -= rotationSpeed * (0.3 + treblePeak * 0.25);
      }

      // Pulsing scale based on audio
      const scale =
        1.04 +
        energy * (0.35 + controls.wobble * 0.2) +
        bassPeak * 0.3 +
        bassRise * 0.45;
      ringData.outer.scale.set(scale, scale, 1);
      if (ringData.inner) {
        const innerScale = scale * (0.86 + treblePeak * 0.08);
        ringData.inner.scale.set(innerScale, innerScale, 1);
      }

      // Dynamic color shift
      const hueShift =
        (ringData.hue +
          energyPeak * 0.28 +
          bands.mid * 0.22 +
          treblePeak * 0.12 +
          time * 0.08 +
          controls.spectrumShift) %
        1;
      const outerMaterial = ringData.outer
        .material as THREE.MeshStandardMaterial;
      outerMaterial.color.setHSL(
        hueShift,
        0.82 + treblePeak * 0.12,
        0.52 + energy * 0.16 + bassPeak * 0.14,
      );
      outerMaterial.emissive.setHSL(
        hueShift,
        0.72,
        0.18 + energy * 0.32 + bassPeak * 0.34 + treblePeak * 0.18,
      );

      if (ringData.inner) {
        const innerMaterial = ringData.inner
          .material as THREE.MeshStandardMaterial;
        innerMaterial.color.setHSL(
          (hueShift + 0.1) % 1,
          0.88 + treblePeak * 0.08,
          0.62 + energy * 0.12 + treblePeak * 0.2,
        );
        innerMaterial.emissive.setHSL(
          (hueShift + 0.1) % 1,
          0.86,
          0.2 + energy * 0.28 + treblePeak * 0.44,
        );
        innerMaterial.opacity = 0.58 + energy * 0.18 + treblePeak * 0.24;
      }
    });

    // Smooth camera fly-through
    const flySpeed =
      (0.95 + energyPeak * 1.95 + bassPeak * 2.55 + bassRise * 3.45) *
      controls.speed *
      motionModes[currentMotionMode].forwardBias;
    runtime.toy.camera.position.z -= flySpeed;

    // Add slight camera wobble
    runtime.toy.camera.position.x =
      Math.sin(time * (2.4 + bands.mid * 0.9)) *
      (1.4 + controls.wobble + treblePeak * 1.2) *
      motionModes[currentMotionMode].cameraDrift;
    runtime.toy.camera.position.y =
      Math.cos(time * (1.85 + bassPeak * 0.45)) *
      (1.2 + controls.wobble + bassPeak * 1.4) *
      motionModes[currentMotionMode].cameraDrift;

    // Reset camera when it reaches the end
    if (runtime.toy.camera.position.z < -tunnelLength + 50) {
      runtime.toy.camera.position.z = 100;
    }

    // Camera look-ahead
    runtime.toy.camera.lookAt(
      Math.sin(time * (0.5 + bands.mid * 0.16)) * (3 + treblePeak * 1.4),
      Math.cos(time * (0.5 + bassPeak * 0.12)) * (3 + bassPeak * 1.1),
      runtime.toy.camera.position.z - 50,
    );

    if (particleTrail && particleGeometry && particleMaterial) {
      const positions = particleGeometry.attributes.position
        .array as Float32Array;
      for (let i = 0; i < positions.length / 3; i += 1) {
        const i3 = i * 3;
        positions[i3 + 2] +=
          0.8 +
          energyPeak * 2.1 +
          bassPeak * 2.6 +
          (i % 7 === 0 ? treblePeak : 0);
        if (positions[i3 + 2] > 50) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 5 + Math.random() * (8 + bassPeak * 6);
          positions[i3] = Math.cos(angle) * radius;
          positions[i3 + 1] = Math.sin(angle) * radius;
          positions[i3 + 2] = -tunnelLength;
        }
      }
      particleGeometry.attributes.position.needsUpdate = true;
      particleMaterial.size = 0.75 + treblePeak * 1.5 + energyPeak * 0.4;
      particleMaterial.opacity = 0.62 + treblePeak * 0.28 + energyPeak * 0.12;
      particleMaterial.color.setHSL(
        (time * 0.08 + controls.spectrumShift + treblePeak * 0.16) % 1,
        0.8,
        0.72 + treblePeak * 0.12,
      );
    }

    lightSources.forEach((light, index) => {
      light.intensity =
        0.7 +
        bassPeak * 1.4 +
        treblePeak * 0.5 +
        Math.sin(time * 1.4 + index) * 0.08;
      light.distance = 100 + energyPeak * 18;
      light.position.x =
        Math.sin(time * (0.8 + index * 0.12)) * (12 + bands.mid * 8);
      light.position.y =
        Math.cos(time * (0.7 + index * 0.1)) * (10 + bassPeak * 10);
    });

    runtime.toy.render();
  }

  function handleInput(state: UnifiedInputState | null) {
    if (!state || state.pointerCount === 0) {
      rotationLatch = 0;
      return;
    }

    targetSpeed = THREE.MathUtils.clamp(
      1 + state.normalizedCentroid.x * 0.45,
      0.65,
      1.8,
    );
    targetWobble = THREE.MathUtils.clamp(
      1 + state.normalizedCentroid.y * 0.55,
      0.6,
      2,
    );

    const gesture = state.gesture;
    if (!gesture || gesture.pointerCount < 2) return;

    targetSpeed = THREE.MathUtils.clamp(
      targetSpeed + (gesture.scale - 1) * 0.5,
      0.65,
      2,
    );
    targetWobble = THREE.MathUtils.clamp(
      targetWobble + Math.abs(gesture.rotation) * 0.8,
      0.6,
      2.2,
    );

    if (rotationLatch <= 0.45 && gesture.rotation > 0.45) {
      targetSpectrumShift = (targetSpectrumShift + 0.08) % 1;
    } else if (rotationLatch >= -0.45 && gesture.rotation < -0.45) {
      targetSpectrumShift = (targetSpectrumShift - 0.08 + 1) % 1;
    }
    rotationLatch = gesture.rotation;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowUp') {
      targetSpeed = THREE.MathUtils.clamp(targetSpeed + 0.1, 0.65, 2);
    } else if (event.key === 'ArrowDown') {
      targetSpeed = THREE.MathUtils.clamp(targetSpeed - 0.1, 0.65, 2);
    } else if (event.key === 'ArrowRight') {
      targetSpectrumShift = (targetSpectrumShift + 0.06) % 1;
    } else if (event.key === 'ArrowLeft') {
      targetSpectrumShift = (targetSpectrumShift - 0.06 + 1) % 1;
    }
  }

  function setupSettingsPanel() {
    buildToySettingsPanel({
      title: 'Rainbow tunnel',
      description:
        'Choose a comfort level first, then nudge the color drift when you want a stronger rush.',
      quality,
      sections: [
        {
          title: 'Motion mode',
          description:
            'Cruise is easier to stay with. Burst is louder and more physical.',
          controls: [
            {
              type: 'button-group',
              options: [
                { id: 'cruise', label: 'Cruise' },
                { id: 'glide', label: 'Glide' },
                { id: 'burst', label: 'Burst' },
              ],
              getActiveId: () => currentMotionMode,
              onChange: (mode) => setMotionMode(mode as TunnelMotionMode),
              buttonClassName: 'cta-button',
              activeClassName: 'active',
              setDisabledOnActive: true,
              setAriaPressed: false,
            },
          ],
        },
        {
          title: 'Color drift',
          description:
            'Steady keeps hue changes grounded. Prism swings harder with the beat.',
          controls: [
            {
              type: 'button-group',
              options: [
                { id: 'steady', label: 'Steady' },
                { id: 'neon', label: 'Neon' },
                { id: 'prism', label: 'Prism' },
              ],
              getActiveId: () => currentColorMode,
              onChange: (mode) => setColorMode(mode as TunnelColorMode),
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
    input: {
      onInput: (state) => handleInput(state),
    },
    plugins: [
      {
        name: 'rainbow-tunnel',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          setupSettingsPanel();
          rebuildScene();
          window.addEventListener('keydown', handleKeydown);
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        dispose: () => {
          disposeRingAssets();
          window.removeEventListener('keydown', handleKeydown);
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return runtime;
}
