import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { startToyAudio } from '../utils/start-audio';
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

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 36 } },
  sceneOptions: {
    fog: { color: 0x050914, density: 0.012 },
    background: '#03060f',
  },
  rendererOptions: { maxPixelRatio: 1.8 },
  ambientLightOptions: { color: 0x88aaff, intensity: 0.25 },
  lightingOptions: {
    type: 'PointLight',
    options: { color: 0x66ccff, intensity: 2.2, distance: 140 },
    position: { x: 0, y: 16, z: 24 },
  },
} as ToyConfig);

const bubbles: Bubble[] = [];
const harmonicBubbles: HarmonicBubble[] = [];
const bubbleGroup = new THREE.Group();
const harmonicGeometry = new THREE.SphereGeometry(1, 32, 32);
let shaderSources: { vertex: string; fragment: string } | null = null;

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

function createBubble(hue: number) {
  const geometry = new THREE.SphereGeometry(1, 64, 64);
  const material = createBubbleMaterial(hue);
  const mesh = new THREE.Mesh(geometry, material);

  const baseScale = THREE.MathUtils.randFloat(0.8, 2.8);
  mesh.scale.setScalar(baseScale);
  mesh.position.set(
    THREE.MathUtils.randFloatSpread(24),
    THREE.MathUtils.randFloatSpread(18),
    THREE.MathUtils.randFloatSpread(10)
  );

  const velocity = new THREE.Vector3(
    THREE.MathUtils.randFloatSpread(0.05),
    THREE.MathUtils.randFloat(0.02, 0.06),
    THREE.MathUtils.randFloatSpread(0.03)
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
  if (harmonicBubbles.length > 120 || !shaderSources) return;

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
      THREE.MathUtils.randFloatSpread(2.2)
    )
  );

  const velocity = parent.velocity
    .clone()
    .multiplyScalar(0.6)
    .add(
      new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(0.35),
        THREE.MathUtils.randFloat(0.12, 0.32),
        THREE.MathUtils.randFloatSpread(0.35)
      )
    );

  harmonicBubbles.push({ mesh, velocity, life: 1.1 });
  bubbleGroup.add(mesh);
}

async function init() {
  await loadShaders();
  toy.scene.add(bubbleGroup);

  const rimLight = new THREE.PointLight(0x4ee6ff, 1.4, 120, 1.8);
  rimLight.position.set(-14, -18, 22);
  toy.scene.add(rimLight);

  const count = 26;
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
      bubble.mesh.scale.lerpScalar(scaleTarget, 0.08);

      const drift = new THREE.Vector3(
        Math.sin(time * 0.45 + index) * 0.002,
        0.003 + energy * 0.014 + normalizedAvg * 0.01,
        Math.cos(time * 0.38 + index) * 0.002
      );

      bubble.mesh.position.add(bubble.velocity.clone().add(drift));

      if (bubble.mesh.position.length() > 38) {
        bubble.mesh.position.multiplyScalar(-0.6);
      }

      const hueShift = (energy * 0.2 + normalizedAvg * 0.1) % 1;
      const baseColor = new THREE.Color().setHSL(
        (bubble.hue + hueShift) % 1,
        0.5,
        0.45 + energy * 0.2
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
    { fallbackValue: avg }
  );
}

function animate(ctx: AnimationContext) {
  const data = getContextFrequencyData(ctx);
  const avg = getAverageFrequency(data);
  const time = performance.now() * 0.001;

  animateBubbles(data, avg, time);
  animateHarmonics(time);

  toy.render();
}

const initPromise = init();

async function startAudio(useSynthetic = false) {
  await initPromise;
  return startToyAudio(toy, animate, {
    fftSize: 2048,
    smoothingTimeConstant: 0.72,
    fallbackToSynthetic: useSynthetic,
    preferSynthetic: useSynthetic,
  });
}

(window as unknown as Record<string, unknown>).startAudio = startAudio;
(window as unknown as Record<string, unknown>).startAudioFallback = () =>
  startAudio(true);
