import * as THREE from 'three';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  type QualityPreset,
} from '../core/settings-panel';
import { createToyRuntime } from '../core/toy-runtime';
import { getAverageFrequency } from '../utils/audio-handler';
import { mapFrequencyToItems } from '../utils/audio-mapper';

type Bubble = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  velocity: THREE.Vector3;
  baseScale: number;
  hue: number;
  harmonicCharge: number;
};

type HarmonicBubble = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  velocity: THREE.Vector3;
  life: number;
};

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const settingsPanel = getSettingsPanel();
  let activeQuality: QualityPreset = getActiveQualityPreset();
  let runtime: ReturnType<typeof createToyRuntime>;

  const bubbles: Bubble[] = [];
  const tempScale = new THREE.Vector3();
  const harmonicBubbles: HarmonicBubble[] = [];
  const bubbleGroup = new THREE.Group();
  let bubbleGeometry: THREE.SphereGeometry | null = null;
  let harmonicGeometry: THREE.SphereGeometry | null = null;
  let bubbleDetail = getBubbleDetail();
  let shaderSources: { vertex: string; fragment: string } | null = null;

  function getBubbleDetail() {
    const scale = activeQuality.particleScale ?? 1;
    return {
      bubbleCount: Math.max(12, Math.round(26 * scale)),
      harmonicLimit: Math.max(40, Math.round(120 * scale)),
      segments: Math.max(24, Math.round(64 * Math.sqrt(scale))),
    };
  }

  async function loadShaderSource(path: string) {
    const response = await fetch(path);
    return response.text();
  }

  async function loadShaders() {
    if (shaderSources) return shaderSources;
    const [vertex, fragment] = await Promise.all([
      loadShaderSource('assets/shaders/bubble-harmonics.vert'),
      loadShaderSource('assets/shaders/bubble-harmonics.frag'),
    ]);
    shaderSources = { vertex, fragment };
    return shaderSources;
  }

  function createBubbleMaterial(hue: number) {
    if (!shaderSources) {
      throw new Error('Shader sources missing');
    }

    const baseColor = new THREE.Color().setHSL(hue, 0.45, 0.45);
    const highlightColor = new THREE.Color().setHSL((hue + 0.2) % 1, 0.7, 0.72);

    return new THREE.ShaderMaterial({
      vertexShader: shaderSources.vertex,
      fragmentShader: shaderSources.fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        baseColor: { value: baseColor },
        highlightColor: { value: highlightColor },
        opacity: { value: 0.85 },
        refractionStrength: { value: 1.2 },
        fresnelPower: { value: 3.2 },
      },
    });
  }

  function refreshGeometries() {
    bubbleGeometry?.dispose();
    harmonicGeometry?.dispose();
    bubbleGeometry = new THREE.SphereGeometry(
      1,
      bubbleDetail.segments,
      bubbleDetail.segments,
    );
    harmonicGeometry = new THREE.SphereGeometry(
      1,
      Math.max(16, Math.round(bubbleDetail.segments * 0.7)),
      Math.max(16, Math.round(bubbleDetail.segments * 0.7)),
    );
  }

  function createBubble(hue: number) {
    const geometry = bubbleGeometry ?? new THREE.SphereGeometry(1, 64, 64);
    const material = createBubbleMaterial(hue);
    const mesh = new THREE.Mesh(geometry, material);

    const baseScale = THREE.MathUtils.randFloat(0.8, 2.8);
    mesh.scale.setScalar(baseScale);
    mesh.position.set(
      THREE.MathUtils.randFloatSpread(24),
      THREE.MathUtils.randFloatSpread(18),
      THREE.MathUtils.randFloatSpread(10),
    );

    const velocity = new THREE.Vector3(
      THREE.MathUtils.randFloatSpread(0.05),
      THREE.MathUtils.randFloat(0.02, 0.06),
      THREE.MathUtils.randFloatSpread(0.03),
    );

    const bubble: Bubble = {
      mesh,
      velocity,
      baseScale,
      hue,
      harmonicCharge: THREE.MathUtils.randFloat(0.2, 0.6),
    };

    bubbles.push(bubble);
    bubbleGroup.add(mesh);
  }

  function addHarmonicBubble(parent: Bubble, energy: number) {
    if (
      harmonicBubbles.length > bubbleDetail.harmonicLimit ||
      !shaderSources ||
      !harmonicGeometry
    ) {
      return;
    }

    const hue = (parent.hue + 0.15 + energy * 0.2) % 1;
    const material = createBubbleMaterial(hue);
    const mesh = new THREE.Mesh(harmonicGeometry, material);
    const scale = parent.baseScale * THREE.MathUtils.lerp(0.3, 0.7, energy);
    mesh.scale.setScalar(scale);
    mesh.position.copy(parent.mesh.position);
    mesh.position.add(
      new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(2.2),
        THREE.MathUtils.randFloatSpread(2.2),
        THREE.MathUtils.randFloatSpread(2.2),
      ),
    );

    const velocity = parent.velocity
      .clone()
      .multiplyScalar(0.6)
      .add(
        new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(0.35),
          THREE.MathUtils.randFloat(0.12, 0.32),
          THREE.MathUtils.randFloatSpread(0.35),
        ),
      );

    harmonicBubbles.push({ mesh, velocity, life: 1.1 });
    bubbleGroup.add(mesh);
  }

  function clearBubbleMeshes() {
    bubbleGroup.children.slice().forEach((child) => {
      const mesh = child as THREE.Mesh;
      bubbleGroup.remove(mesh);
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        (mesh.material as THREE.Material).dispose();
      }
    });
    bubbles.length = 0;
    harmonicBubbles.length = 0;
  }

  let isReady = false;
  async function init() {
    await loadShaders();
    runtime.toy.scene.add(bubbleGroup);
    const rimLight = new THREE.PointLight(0x4ee6ff, 1.4, 120, 1.8);
    rimLight.position.set(-14, -18, 22);
    runtime.toy.scene.add(rimLight);
    rebuildBubbles();
    isReady = true;
  }

  function rebuildBubbles() {
    clearBubbleMeshes();
    bubbleDetail = getBubbleDetail();
    refreshGeometries();

    const count = bubbleDetail.bubbleCount;
    for (let i = 0; i < count; i++) {
      createBubble((i / count + Math.random() * 0.1) % 1);
    }
  }

  function animateHarmonics(time: number) {
    for (let i = harmonicBubbles.length - 1; i >= 0; i--) {
      const harmonic = harmonicBubbles[i];
      harmonic.mesh.position.add(harmonic.velocity);
      harmonic.velocity.multiplyScalar(0.99);
      harmonic.life -= 0.01;

      const material = harmonic.mesh.material;
      material.uniforms.time.value = time;
      material.uniforms.opacity.value = Math.max(0, harmonic.life);

      harmonic.mesh.scale.multiplyScalar(0.995);
      harmonic.mesh.rotateY(0.0025);

      if (harmonic.life <= 0) {
        bubbleGroup.remove(harmonic.mesh);
        harmonic.mesh.material.dispose();
        harmonicBubbles.splice(i, 1);
      }
    }
  }

  function animateBubbles(data: Uint8Array, avg: number, time: number) {
    const normalizedAvg = avg / 255;

    mapFrequencyToItems(
      data,
      bubbles,
      (bubble, index, value) => {
        const energy = value / 255;
        const wobble = Math.sin(time + index * 0.35) * 0.15;
        const scaleTarget =
          bubble.baseScale * (0.9 + energy * 1.8 + wobble * 0.1);
        tempScale.setScalar(scaleTarget);
        bubble.mesh.scale.lerp(tempScale, 0.08);

        const drift = new THREE.Vector3(
          Math.sin(time * 0.45 + index) * 0.002,
          0.003 + energy * 0.014 + normalizedAvg * 0.01,
          Math.cos(time * 0.38 + index) * 0.002,
        );

        bubble.mesh.position.add(bubble.velocity.clone().add(drift));

        if (bubble.mesh.position.length() > 38) {
          bubble.mesh.position.multiplyScalar(-0.6);
        }

        const hueShift = (energy * 0.2 + normalizedAvg * 0.1) % 1;
        const baseColor = new THREE.Color().setHSL(
          (bubble.hue + hueShift) % 1,
          0.5,
          0.45 + energy * 0.2,
        );
        const highlightColor = baseColor.clone().offsetHSL(0.08, 0, 0.22);
        const material = bubble.mesh.material;
        material.uniforms.time.value = time + index * 0.2;
        material.uniforms.baseColor.value.copy(baseColor);
        material.uniforms.highlightColor.value.copy(highlightColor);

        bubble.harmonicCharge += energy * 0.015;
        if (bubble.harmonicCharge > 0.55 && energy > 0.62) {
          addHarmonicBubble(bubble, energy);
          bubble.harmonicCharge = 0.12;
        }
      },
      { fallbackValue: avg },
    );
  }

  function animate(data: Uint8Array, time: number) {
    const avg = getAverageFrequency(data);
    const scaledTime = time;

    animateBubbles(data, avg, scaledTime);
    animateHarmonics(scaledTime);

    runtime.toy.render();
  }

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    runtime.toy.updateRendererSettings({
      maxPixelRatio: preset.maxPixelRatio,
      renderScale: preset.renderScale,
    });
    bubbleDetail = getBubbleDetail();
    refreshGeometries();
    if (!shaderSources) return;
    rebuildBubbles();
  }

  function setupSettingsPanel() {
    settingsPanel.configure({
      title: 'Bubble harmonics',
      description: 'Presets adjust DPI caps plus bubble and harmonic counts.',
    });
    settingsPanel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });
  }

  runtime = createToyRuntime({
    container,
    canvas: container?.querySelector('canvas'),
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 36 } },
      sceneOptions: {
        fog: { color: 0x050914, density: 0.012 },
        background: '#03060f',
      },
      rendererOptions: {
        maxPixelRatio: activeQuality.maxPixelRatio,
        renderScale: activeQuality.renderScale,
      },
      ambientLightOptions: { color: 0x88aaff, intensity: 0.25 },
      lightingOptions: {
        type: 'PointLight',
        color: 0x66ccff,
        intensity: 2.2,
        position: { x: 0, y: 16, z: 24 },
      },
    },
    audio: { fftSize: 2048, options: { smoothingTimeConstant: 0.72 } },
    plugins: [
      {
        name: 'bubble-harmonics',
        setup: () => {
          void init();
        },
        update: ({ frequencyData, time }) => {
          if (!isReady) return;
          animate(frequencyData, time);
        },
        dispose: () => {
          clearBubbleMeshes();
          bubbleGeometry?.dispose();
          harmonicGeometry?.dispose();
        },
      },
    ],
  });

  setupSettingsPanel();

  return runtime;
}
