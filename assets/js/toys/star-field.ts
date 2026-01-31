import * as THREE from 'three';
import {
  getActivePerformanceSettings,
  getPerformancePanel,
  type PerformanceSettings,
} from '../core/performance-panel';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { applyAudioColor } from '../utils/color-audio';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';
import type { UnifiedInputState } from '../utils/unified-input';

type StarFieldBuffers = {
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  points: THREE.Points;
  count: number;
};

type StarfieldPalette = {
  name: string;
  background: THREE.ColorRepresentation;
  fog: THREE.ColorRepresentation;
  starHue: number;
  nebulaA: THREE.ColorRepresentation;
  nebulaB: THREE.ColorRepresentation;
};

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Star field',
    description:
      'Tune render resolution and particle density for your GPU. Pinch to intensify the drift and rotate to swap nebula moods.',
    getRuntime: () => runtime,
    getRendererSettings: (preset) => ({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: preset.renderScale,
    }),
    onChange: () => {
      disposeStarField();
      starField = createStarField();
    },
  });
  let performanceSettings: PerformanceSettings = getActivePerformanceSettings();
  let activePaletteIndex = 0;
  let runtime: ToyRuntimeInstance;

  const palettes: StarfieldPalette[] = [
    {
      name: 'Midnight',
      background: '#030712',
      fog: '#030712',
      starHue: 0.6,
      nebulaA: '#1f2a5a',
      nebulaB: '#0a1233',
    },
    {
      name: 'Celadon',
      background: '#020f12',
      fog: '#020f12',
      starHue: 0.35,
      nebulaA: '#174b4a',
      nebulaB: '#082627',
    },
    {
      name: 'Crimson',
      background: '#120307',
      fog: '#120307',
      starHue: 0.98,
      nebulaA: '#4b1020',
      nebulaB: '#20050f',
    },
    {
      name: 'Violet',
      background: '#0b041a',
      fog: '#0b041a',
      starHue: 0.76,
      nebulaA: '#3b1a66',
      nebulaB: '#160a33',
    },
  ];

  const controls = {
    drift: 1,
    sparkle: 1,
  };
  let targetDrift = controls.drift;
  let targetSparkle = controls.sparkle;
  let rotationLatch = 0;

  let starField: StarFieldBuffers | null = null;
  let nebulaMesh: THREE.Mesh | null = null;
  const nebulaUniforms = {
    u_time: { value: 0 },
    u_intensity: { value: 0 },
    u_colorA: { value: new THREE.Color() },
    u_colorB: { value: new THREE.Color() },
  };

  function getShaderSizeMultiplier() {
    if (performanceSettings.shaderQuality === 'high') return 1.2;
    if (performanceSettings.shaderQuality === 'low') return 0.85;
    return 1;
  }

  function getStarCount() {
    const scale =
      (quality.activeQuality.particleScale ?? 1) *
      performanceSettings.particleBudget;
    return Math.max(900, Math.floor(2400 * scale));
  }

  function createStarField(): StarFieldBuffers {
    const count = getStarCount();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const palette = palettes[activePaletteIndex];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * 180;
      positions[i3 + 1] = (Math.random() - 0.5) * 140;
      positions[i3 + 2] = Math.random() * -600;

      velocities[i] = 0.4 + Math.random() * 0.8;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: new THREE.Color().setHSL(palette.starHue, 0.4, 0.9),
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
    runtime.toy.scene.add(points);

    runtime.toy.scene.fog = new THREE.FogExp2(palette.fog, 0.0008);
    runtime.toy.rendererReady.then((result) => {
      if (result) {
        result.renderer.setClearColor(palette.background, 1);
      }
    });

    return { geometry, material, velocities, points, count };
  }

  function createNebula() {
    if (nebulaMesh) {
      runtime.toy.scene.remove(nebulaMesh);
      disposeMaterial(nebulaMesh.material as THREE.Material);
      disposeGeometry(nebulaMesh.geometry as THREE.BufferGeometry);
    }

    const geometry = new THREE.PlaneGeometry(420, 300, 1, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: nebulaUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform float u_time;
        uniform float u_intensity;
        uniform vec3 u_colorA;
        uniform vec3 u_colorB;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amp = 0.55;
          for (int i = 0; i < 4; i++) {
            value += amp * noise(p);
            p *= 2.1;
            amp *= 0.5;
          }
          return value;
        }

        void main() {
          vec2 uv = vUv;
          vec2 warp = vec2(
            fbm(uv * 3.4 + u_time * 0.04),
            fbm(uv * 3.1 - u_time * 0.03)
          );
          vec2 shifted = uv + (warp - 0.5) * 0.18;
          float clouds = fbm(shifted * 5.4 + u_time * 0.08);
          float glow = smoothstep(0.2, 0.85, clouds);
          vec3 color = mix(u_colorB, u_colorA, glow);
          color += glow * u_intensity * 0.35;
          gl_FragColor = vec4(color, 0.85);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    nebulaMesh = new THREE.Mesh(geometry, material);
    nebulaMesh.position.z = -260;
    runtime.toy.scene.add(nebulaMesh);
  }

  function disposeStarField() {
    if (!starField) return;
    runtime.toy.scene.remove(starField.points);
    disposeGeometry(starField.geometry);
    disposeMaterial(starField.material);
    starField = null;
  }

  function resetStar(i: number, positions: Float32Array) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * 180;
    positions[i3 + 1] = (Math.random() - 0.5) * 140;
    positions[i3 + 2] = -600;
  }

  function applyPerformanceSettings(settings: PerformanceSettings) {
    performanceSettings = settings;
    runtime.toy.updateRendererSettings({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: quality.activeQuality.renderScale,
    });
    disposeStarField();
    starField = createStarField();
  }

  function setupSettingsPanel() {
    configurePanel();
  }

  function setupPerformancePanel() {
    getPerformancePanel({
      title: 'Performance',
      description: 'Cap DPI or scale particle budgets to match your device.',
    });
  }

  function animate(data: Uint8Array, time: number) {
    if (!starField) return;
    const avg = getWeightedAverageFrequency(data);
    const normalizedAvg = avg / 255;

    controls.drift = THREE.MathUtils.lerp(controls.drift, targetDrift, 0.08);
    controls.sparkle = THREE.MathUtils.lerp(
      controls.sparkle,
      targetSparkle,
      0.08,
    );

    nebulaUniforms.u_time.value = time * 0.0006;
    nebulaUniforms.u_intensity.value = normalizedAvg * controls.sparkle;

    const positions = starField.geometry.attributes.position
      .array as Float32Array;
    for (let i = 0; i < starField.count; i++) {
      const i3 = i * 3;
      const drift = Math.sin(time * 0.001 + i * 0.02) * 0.12;
      positions[i3] += drift * controls.drift;
      positions[i3 + 1] +=
        Math.cos(time * 0.0012 + i * 0.015) * 0.09 * controls.drift;
      positions[i3 + 2] +=
        starField.velocities[i] * (1 + normalizedAvg * 3.5 * controls.sparkle);

      if (positions[i3 + 2] > 80) {
        resetStar(i, positions);
      }
    }

    starField.geometry.attributes.position.needsUpdate = true;

    const baseSize =
      1.2 * getShaderSizeMultiplier() + normalizedAvg * 2.2 * controls.sparkle;
    starField.material.size = baseSize;
    starField.material.opacity = 0.65 + normalizedAvg * 0.3;
    const palette = palettes[activePaletteIndex];
    applyAudioColor(starField.material, normalizedAvg, {
      baseHue: palette.starHue,
      hueRange: 0.35 * controls.sparkle,
      baseSaturation: 0.3,
      baseLuminance: 0.82,
    });

    runtime.toy.camera.position.x = Math.sin(time * 0.0006) * 8;
    runtime.toy.camera.position.y = Math.cos(time * 0.0005) * 6;
    runtime.toy.camera.lookAt(0, 0, -120);

    runtime.toy.render();
  }

  function handleInput(state: UnifiedInputState | null) {
    if (!state || state.pointerCount === 0) {
      rotationLatch = 0;
      return;
    }
    const centroid = state.normalizedCentroid;
    targetDrift = THREE.MathUtils.clamp(1 + centroid.x * 0.4, 0.6, 1.6);
    targetSparkle = THREE.MathUtils.clamp(1 + centroid.y * 0.5, 0.6, 1.8);

    const gesture = state.gesture;
    if (!gesture || gesture.pointerCount < 2) return;
    targetDrift = THREE.MathUtils.clamp(
      targetDrift + (gesture.scale - 1) * 0.4,
      0.6,
      1.8,
    );
    targetSparkle = THREE.MathUtils.clamp(
      targetSparkle + Math.abs(gesture.rotation) * 0.6,
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
      targetDrift = THREE.MathUtils.clamp(targetDrift + 0.1, 0.6, 1.8);
    } else if (event.key === 'ArrowDown') {
      targetDrift = THREE.MathUtils.clamp(targetDrift - 0.1, 0.6, 1.8);
    }
  }

  function applyPalette(index: number) {
    const palette = palettes[index];
    nebulaUniforms.u_colorA.value.set(palette.nebulaA);
    nebulaUniforms.u_colorB.value.set(palette.nebulaB);
    runtime.toy.scene.fog = new THREE.FogExp2(palette.fog, 0.0008);
    runtime.toy.rendererReady.then((result) => {
      if (result) {
        result.renderer.setClearColor(palette.background, 1);
      }
    });
    if (starField) {
      starField.material.color.setHSL(palette.starHue, 0.4, 0.9);
    }
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 70 } },
      ambientLightOptions: { intensity: 0.25 },
      lightingOptions: {
        type: 'PointLight',
        position: { x: 20, y: 10, z: 40 },
        intensity: 0.4,
      },
      rendererOptions: {
        maxPixelRatio: performanceSettings.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 256 },
    input: {
      onInput: (state) => handleInput(state),
    },
    plugins: [
      {
        name: 'star-field',
        setup: () => {
          setupSettingsPanel();
          setupPerformancePanel();
          starField = createStarField();
          createNebula();
          applyPalette(activePaletteIndex);
          window.addEventListener('keydown', handleKeydown);
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        onPerformanceChange: (settings) => {
          applyPerformanceSettings(settings);
        },
        dispose: () => {
          disposeStarField();
          window.removeEventListener('keydown', handleKeydown);
          if (nebulaMesh) {
            runtime.toy.scene.remove(nebulaMesh);
            disposeMaterial(nebulaMesh.material as THREE.Material);
            disposeGeometry(nebulaMesh.geometry as THREE.BufferGeometry);
          }
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  return runtime;
}
