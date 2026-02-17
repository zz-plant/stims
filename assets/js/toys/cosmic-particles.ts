import * as THREE from 'three';
import {
  getActivePerformanceSettings,
  type PerformanceSettings,
} from '../core/performance-panel';
import type { QualityPreset } from '../core/settings-panel';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { applyAudioColor } from '../utils/color-audio';
import { createPerformanceSettingsHandler } from '../utils/performance-settings';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createAudioToyStarter } from '../utils/toy-runtime-starter';
import {
  buildToySettingsPanelWithPerformance,
  createToyQualityControls,
} from '../utils/toy-settings';
import type { UnifiedInputState } from '../utils/unified-input';

type PresetKey = 'orbit' | 'nebula';

type PresetInstance = {
  animate: (data: Uint8Array, time: number) => void;
  dispose: () => void;
};

export function start({ container }: ToyStartOptions = {}) {
  const { quality } = createToyQualityControls({
    title: 'Cosmic controls',
    description:
      'Quality changes persist between toys so you can cap DPI or ramp visuals.',
    defaultPresetId: 'balanced',
    getRuntime: () => runtime,
    getRendererSettings: (preset) => ({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: preset.renderScale,
    }),
    onChange: () => {
      setActivePreset(activePresetKey, { force: true });
    },
  });
  let performanceSettings = getActivePerformanceSettings();
  let performanceSettingsHandler: ReturnType<
    typeof createPerformanceSettingsHandler
  > | null = null;
  let runtime: ToyRuntimeInstance;

  let activePreset: PresetInstance | null = null;
  let activePresetKey: PresetKey = 'orbit';

  const controls = {
    motionBoost: 1,
    colorDrift: 0,
  };
  let targetMotionBoost = controls.motionBoost;
  let targetColorDrift = controls.colorDrift;
  let rotationLatch = 0;

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
    const baseRadii = new Float32Array(count);
    const baseAngles = new Float32Array(count);
    const verticalOffsets = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const radius = Math.sqrt(Math.random()) * 46;
      const angle = Math.random() * Math.PI * 2;
      const armOffset = Math.sin(radius * 0.22 + angle * 2.5) * 2.4;
      const yOffset = (Math.random() - 0.5) * 18;

      baseRadii[i] = radius;
      baseAngles[i] = angle;
      verticalOffsets[i] = yOffset;

      positions[i3] = Math.cos(angle + armOffset) * radius;
      positions[i3 + 1] = yOffset;
      positions[i3 + 2] = Math.sin(angle + armOffset) * radius;
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

    const ambientGlow = new THREE.PointLight(0x4f6bff, 0.45, 180);
    ambientGlow.position.set(-20, 8, -24);
    group.add(ambientGlow);

    runtime.toy.scene.add(group);
    runtime.toy.camera.position.set(0, 0, 60);

    return {
      animate(data, time) {
        const avg = getWeightedAverageFrequency(data);
        controls.motionBoost = THREE.MathUtils.lerp(
          controls.motionBoost,
          targetMotionBoost,
          0.08,
        );
        controls.colorDrift = THREE.MathUtils.lerp(
          controls.colorDrift,
          targetColorDrift,
          0.08,
        );

        const normalizedAvg = (avg / 255) * controls.motionBoost;
        const rotationSpeed = 0.002 + normalizedAvg * 0.006;

        const animatedPositions = particles.geometry.attributes.position
          .array as Float32Array;
        for (let i = 0; i < count; i++) {
          const i3 = i * 3;
          const pulse =
            1 + normalizedAvg * 0.18 + Math.sin(time * 2 + i * 0.04) * 0.04;
          const orbitAngle =
            baseAngles[i] +
            time * (0.25 + (baseRadii[i] / 46) * 0.65) +
            Math.sin(time + i * 0.015) * 0.05;

          animatedPositions[i3] = Math.cos(orbitAngle) * baseRadii[i] * pulse;
          animatedPositions[i3 + 1] =
            verticalOffsets[i] +
            Math.sin(time * 1.4 + i * 0.05) * (0.4 + normalizedAvg * 2.2);
          animatedPositions[i3 + 2] =
            Math.sin(orbitAngle) * baseRadii[i] * pulse;
        }
        particles.geometry.attributes.position.needsUpdate = true;

        particles.rotation.y += rotationSpeed;
        particles.rotation.x += rotationSpeed / 2;

        particlesMaterial.size = 1.3 + normalizedAvg * 2.8;
        const hue =
          (time * 0.08 + normalizedAvg * 0.2 + controls.colorDrift) % 1;
        particlesMaterial.color.setHSL(hue, 0.85, 0.64);

        light.intensity = 0.8 + normalizedAvg * 1.4;
        ambientGlow.intensity = 0.45 + normalizedAvg * 0.8;

        runtime.toy.camera.position.x =
          Math.sin(time * 0.35) * (6 + controls.motionBoost * 2);
        runtime.toy.camera.position.y =
          Math.cos(time * 0.24) * (4 + controls.motionBoost);
        runtime.toy.camera.lookAt(0, 0, 0);

        runtime.toy.render();
      },
      dispose() {
        runtime.toy.scene.remove(group);
        disposeGeometry(particlesGeometry);
        disposeMaterial(particlesMaterial);
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

    runtime.toy.scene.add(group);
    runtime.toy.camera.position.set(0, 0, 100);

    return {
      animate(data, time) {
        const avg = getWeightedAverageFrequency(data);
        controls.motionBoost = THREE.MathUtils.lerp(
          controls.motionBoost,
          targetMotionBoost,
          0.08,
        );
        controls.colorDrift = THREE.MathUtils.lerp(
          controls.colorDrift,
          targetColorDrift,
          0.08,
        );

        const normalizedAvg = (avg / 255) * controls.motionBoost;

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

        const hueBase = (time * 0.05 + controls.colorDrift) % 1;
        applyAudioColor(starMaterial, normalizedAvg, {
          baseHue: hueBase,
          hueRange: 0.5,
          baseSaturation: 0.3,
          baseLuminance: 0.9,
        });

        runtime.toy.camera.position.x =
          Math.sin(time * 0.3) * (8 + controls.motionBoost * 2);
        runtime.toy.camera.position.y =
          Math.cos(time * 0.2) * (4 + controls.motionBoost);
        runtime.toy.camera.lookAt(0, 0, -100);

        runtime.toy.render();
      },
      dispose() {
        runtime.toy.scene.remove(group);
        disposeGeometry(starGeometry);
        disposeMaterial(starMaterial);
        disposeGeometry(nebulaGeometry);
        disposeMaterial(nebulaMaterial);
      },
    };
  }

  function setActivePreset(key: PresetKey, { force } = { force: false }) {
    if (key === activePresetKey && activePreset && !force) return;

    activePreset?.dispose();
    activePreset =
      key === 'orbit'
        ? createOrbitPreset(quality.activeQuality)
        : createNebulaPreset(quality.activeQuality);
    activePresetKey = key;
  }

  function applyPerformanceSettings(settings: PerformanceSettings) {
    performanceSettings = settings;
    setActivePreset(activePresetKey, { force: true });
  }

  function setupSettingsPanel() {
    buildToySettingsPanelWithPerformance({
      title: 'Cosmic controls',
      description:
        'Quality changes persist between toys so you can cap DPI or ramp visuals.',
      quality,
      performance: {
        title: 'Performance',
        description:
          'Cap DPI, trim particle budgets, or lower shader detail for smoother play.',
      },
      sections: [
        {
          title: 'Cosmic preset',
          description:
            'Switch between swirling orbits and deep nebula fly-throughs.',
          controls: [
            {
              type: 'button-group',
              options: [
                { id: 'orbit', label: 'Orbit' },
                { id: 'nebula', label: 'Nebula' },
              ],
              getActiveId: () => activePresetKey,
              onChange: (key) => setActivePreset(key as PresetKey),
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

  function animate(data: Uint8Array, time: number) {
    activePreset?.animate(data, time);
  }

  function cyclePreset() {
    setActivePreset(activePresetKey === 'orbit' ? 'nebula' : 'orbit');
  }

  function handleInput(state: UnifiedInputState | null) {
    if (!state || state.pointerCount === 0) {
      rotationLatch = 0;
      return;
    }

    targetMotionBoost = THREE.MathUtils.clamp(
      1 + state.normalizedCentroid.y * 0.6,
      0.65,
      1.9,
    );

    const gesture = state.gesture;
    if (!gesture || gesture.pointerCount < 2) return;

    targetMotionBoost = THREE.MathUtils.clamp(
      targetMotionBoost + (gesture.scale - 1) * 0.55,
      0.65,
      2.2,
    );

    if (rotationLatch <= 0.45 && gesture.rotation > 0.45) {
      targetColorDrift = (targetColorDrift + 0.08) % 1;
      cyclePreset();
    } else if (rotationLatch >= -0.45 && gesture.rotation < -0.45) {
      targetColorDrift = (targetColorDrift - 0.08 + 1) % 1;
      cyclePreset();
    }
    rotationLatch = gesture.rotation;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      cyclePreset();
    } else if (event.key === 'ArrowLeft') {
      cyclePreset();
    } else if (event.key === 'ArrowUp') {
      targetMotionBoost = THREE.MathUtils.clamp(
        targetMotionBoost + 0.1,
        0.65,
        2.2,
      );
    } else if (event.key === 'ArrowDown') {
      targetMotionBoost = THREE.MathUtils.clamp(
        targetMotionBoost - 0.1,
        0.65,
        2.2,
      );
    }
  }

  setupSettingsPanel();
  const startRuntime = createAudioToyStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 80 } },
      ambientLightOptions: { intensity: 0.35 },
      rendererOptions: {
        maxPixelRatio: performanceSettings.maxPixelRatio,
      },
    },
    audio: { fftSize: 256 },
    input: {
      onInput: (state) => handleInput(state),
    },
    plugins: [
      {
        name: 'cosmic-particles',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          setupSettingsPanel();
          setActivePreset(activePresetKey);
          window.addEventListener('keydown', handleKeydown);
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        dispose: () => {
          activePreset?.dispose();
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
