import * as THREE from 'three';
import WebToy from '../core/web-toy';
import type { ToyConfig } from '../core/types';
import {
  AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import { startToyAudio } from '../utils/start-audio';
import {
  createPointerInput,
  type PointerPosition,
  type PointerSummary,
} from '../utils/pointer-input';
import {
  DEFAULT_QUALITY_PRESETS,
  getSettingsPanel,
  getActiveQualityPreset,
  type QualityPreset,
} from '../core/settings-panel';

type TideBlob = {
  position: THREE.Vector2;
  velocity: THREE.Vector2;
  life: number;
  radius: number;
  strength: number;
};

const settingsPanel = getSettingsPanel();
let activeQuality: QualityPreset = getActiveQualityPreset();

const MAX_BLOBS = 28;
const BASE_SPARK_COUNT = 200;

const controls = {
  trailLength: 2.4,
  glowStrength: 1.2,
  currentSpeed: 1,
};

function getSparkCount() {
  const scale = activeQuality.particleScale ?? 1;
  return Math.max(80, Math.floor(BASE_SPARK_COUNT * scale));
}

function getBlobCap() {
  const scale = activeQuality.particleScale ?? 1;
  return Math.max(10, Math.min(MAX_BLOBS, Math.round(MAX_BLOBS * scale)));
}

const toy = new WebToy({
  cameraOptions: { fov: 50, position: { x: 0, y: 0, z: 1.6 } },
  sceneOptions: { background: '#03121c' },
  rendererOptions: {
    exposure: 1.35,
    maxPixelRatio: activeQuality.maxPixelRatio,
    renderScale: activeQuality.renderScale,
  },
} as ToyConfig);

const blobs: TideBlob[] = [];
const blobUniforms = new Array<THREE.Vector4>(MAX_BLOBS)
  .fill(null)
  .map(() => new THREE.Vector4());

const uniforms = {
  u_time: { value: 0 },
  u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  u_blobs: { value: blobUniforms },
  u_blobCount: { value: 0 },
  u_threshold: { value: 0.9 },
  u_glowStrength: { value: controls.glowStrength },
  u_currentSpeed: { value: controls.currentSpeed },
  u_audioGlow: { value: 0 },
  u_audioSpark: { value: 0 },
};

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 vUv;

  #define MAX_BLOBS ${MAX_BLOBS}

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec4 u_blobs[MAX_BLOBS];
  uniform int u_blobCount;
  uniform float u_threshold;
  uniform float u_glowStrength;
  uniform float u_currentSpeed;
  uniform float u_audioGlow;
  uniform float u_audioSpark;

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
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amp * noise(p);
      p *= 2.2;
      amp *= 0.55;
    }
    return value;
  }

  vec2 flow(vec2 uv) {
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 centered = (uv - 0.5) * vec2(aspect, 1.0);
    float t = u_time * 0.35 * u_currentSpeed;
    float swirl = sin(centered.y * 4.0 + t * 1.2) + cos(centered.x * 3.0 - t * 0.8);
    vec2 drift = vec2(cos(swirl), sin(swirl)) * 0.015 * u_currentSpeed;
    return uv + drift;
  }

  void main() {
    vec2 uv = flow(vUv);
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    float field = 0.0;

    for (int i = 0; i < MAX_BLOBS; i++) {
      if (i >= u_blobCount) break;
      vec2 p = u_blobs[i].xy;
      float radius = u_blobs[i].z;
      float strength = u_blobs[i].w;
      vec2 delta = uv - p;
      delta.x *= aspect;
      float dist = max(length(delta), 0.001);
      field += strength * radius * radius / (dist * dist + 0.0005);
    }

    float shoreline = smoothstep(u_threshold - 0.25, u_threshold + 0.08, field);
    float shell = smoothstep(u_threshold, u_threshold + 0.25, field);

    vec3 deepSea = vec3(0.02, 0.08, 0.12);
    vec3 pool = vec3(0.08, 0.28, 0.36);
    vec3 crest = vec3(0.26, 0.78, 0.92);
    vec3 bloom = vec3(0.46, 0.96, 1.0);

    float foam = fbm(uv * 6.0 + u_time * 0.1) * 0.35;
    float glowStrength = (u_glowStrength + u_audioGlow * 1.4);

    vec3 color = mix(deepSea, pool, shoreline + foam * 0.2);
    color = mix(color, crest, shell);
    color += pow(max(field - u_threshold, 0.0), 1.4) * bloom * glowStrength;

    float spark = hash(uv * vec2(620.0, 420.0) + u_time * 2.5);
    float sparkMask = step(0.985 - u_audioSpark * 0.4, spark);
    color += sparkMask * (0.35 + u_audioSpark) * bloom;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  })
);

const sparkGeometry = new THREE.BufferGeometry();
const sparkPositions = new Float32Array(BASE_SPARK_COUNT * 3);
const sparkVelocities = new Float32Array(BASE_SPARK_COUNT * 3);
const sparkLife = new Float32Array(BASE_SPARK_COUNT);
const sparkMaterial = new THREE.PointsMaterial({
  color: new THREE.Color('#a8f3ff'),
  transparent: true,
  opacity: 0.8,
  size: 0.035,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const sparks = new THREE.Points(sparkGeometry, sparkMaterial);

let activeSparkCount = getSparkCount();
const lastPointerPositions = new Map<number, PointerPosition>();
const clock = new THREE.Clock();

function resetSpark(index: number, anchor?: TideBlob) {
  const uv = anchor?.position ?? new THREE.Vector2(Math.random(), Math.random());
  const x = uv.x * 2 - 1;
  const y = uv.y * 2 - 1;

  sparkPositions[index * 3] = x;
  sparkPositions[index * 3 + 1] = y;
  sparkPositions[index * 3 + 2] = 0;

  const angle = Math.random() * Math.PI * 2;
  const speed = 0.12 + Math.random() * 0.35;
  sparkVelocities[index * 3] = Math.cos(angle) * speed;
  sparkVelocities[index * 3 + 1] = Math.sin(angle) * speed;
  sparkVelocities[index * 3 + 2] = 0;
  sparkLife[index] = 0.75 + Math.random() * 0.75;
}

function initializeScene() {
  toy.scene.add(plane);
  toy.scene.add(sparks);

  sparkGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(sparkPositions, 3)
  );
  sparkGeometry.setDrawRange(0, activeSparkCount);

  for (let i = 0; i < activeSparkCount; i += 1) {
    resetSpark(i);
  }
}

function updateBlobs(delta: number) {
  for (let i = blobs.length - 1; i >= 0; i -= 1) {
    const blob = blobs[i];
    blob.life -= delta / controls.trailLength;
    blob.position.addScaledVector(blob.velocity, delta * 0.35 * controls.currentSpeed);

    blob.position.x = (blob.position.x + 1.0) % 1.0;
    blob.position.y = (blob.position.y + 1.0) % 1.0;

    if (blob.life <= 0) {
      blobs.splice(i, 1);
    }
  }

  const count = Math.min(blobs.length, getBlobCap());
  uniforms.u_blobCount.value = count;
  for (let i = 0; i < count; i += 1) {
    const blob = blobs[i];
    blobUniforms[i].set(blob.position.x, blob.position.y, blob.radius, blob.strength);
  }
}

function spawnBlobFromPointer(pointer: PointerPosition, intensity = 1) {
  const last = lastPointerPositions.get(pointer.id);
  const current = new THREE.Vector2(
    pointer.normalizedX * 0.5 + 0.5,
    pointer.normalizedY * 0.5 + 0.5
  );

  const velocity = last
    ? new THREE.Vector2(
        current.x - (last.normalizedX * 0.5 + 0.5),
        current.y - (last.normalizedY * 0.5 + 0.5)
      )
    : new THREE.Vector2(0, 0);

  const radius = THREE.MathUtils.clamp(0.12 + intensity * 0.2, 0.08, 0.35);
  const strength = THREE.MathUtils.clamp(1 + intensity * 1.3, 0.6, 2.2);

  blobs.unshift({
    position: current,
    velocity,
    life: 1.2 + intensity * 0.8,
    radius,
    strength,
  });

  if (blobs.length > getBlobCap()) {
    blobs.length = getBlobCap();
  }

  lastPointerPositions.set(pointer.id, pointer);
}

function handlePointerUpdate(summary: PointerSummary) {
  if (!summary.pointers.length) {
    lastPointerPositions.clear();
    return;
  }

  summary.pointers.forEach((pointer) => {
    spawnBlobFromPointer(pointer, 0.9);
  });
}

createPointerInput({
  target: window,
  boundsElement: toy.canvas,
  onChange: handlePointerUpdate,
  onGesture: () => undefined,
});

function updateSparks(delta: number, energy: number) {
  const positions = sparkGeometry.getAttribute('position') as THREE.BufferAttribute;
  const respawnBudget = Math.min(activeSparkCount, Math.floor(4 + energy * 24));
  let respawned = 0;

  for (let i = 0; i < activeSparkCount; i += 1) {
    const life = sparkLife[i];
    if (life <= 0 && respawned < respawnBudget) {
      resetSpark(i, blobs[THREE.MathUtils.randInt(0, Math.max(blobs.length - 1, 0))]);
      respawned += 1;
    }
  }

  for (let i = 0; i < activeSparkCount; i += 1) {
    if (sparkLife[i] <= 0) continue;

    sparkLife[i] -= delta * (0.6 + energy * 0.8);
    sparkPositions[i * 3] += sparkVelocities[i * 3] * delta * 0.4;
    sparkPositions[i * 3 + 1] += sparkVelocities[i * 3 + 1] * delta * 0.4;

    sparkPositions[i * 3] = THREE.MathUtils.clamp(sparkPositions[i * 3], -1.2, 1.2);
    sparkPositions[i * 3 + 1] = THREE.MathUtils.clamp(
      sparkPositions[i * 3 + 1],
      -1.2,
      1.2
    );

    if (sparkLife[i] <= 0) {
      sparkPositions[i * 3 + 2] = -10;
    }
  }

  positions.needsUpdate = true;
  sparkGeometry.computeBoundingSphere();
}

function applyQualityPreset(preset: QualityPreset) {
  activeQuality = preset;
  toy.updateRendererSettings({
    maxPixelRatio: preset.maxPixelRatio,
    renderScale: preset.renderScale,
  });

  activeSparkCount = getSparkCount();
  sparkGeometry.setDrawRange(0, activeSparkCount);
  for (let i = 0; i < BASE_SPARK_COUNT; i += 1) {
    sparkLife[i] = 0;
    sparkPositions[i * 3 + 2] = -10;
  }
  for (let i = 0; i < activeSparkCount; i += 1) {
    resetSpark(i);
  }

  if (blobs.length > getBlobCap()) {
    blobs.length = getBlobCap();
  }

  handleResize();
}

function setupSettingsPanel() {
  settingsPanel.configure({
    title: 'Bioluminescent tidepools',
    description:
      'Quality presets update DPI caps, blob limits, and spark counts without reloading.',
  });
  settingsPanel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: activeQuality.id,
    onChange: applyQualityPreset,
  });
}

function computeHighBandEnergy(data: Uint8Array) {
  if (!data.length) return 0;
  const start = Math.floor(data.length * 0.65);
  let sum = 0;
  for (let i = start; i < data.length; i += 1) {
    sum += data[i];
  }
  const average = sum / Math.max(data.length - start, 1);
  return average / 255;
}

function animate(ctx: AnimationContext) {
  const delta = clock.getDelta();
  const data = getContextFrequencyData(ctx);
  const highBand = computeHighBandEnergy(data);

  uniforms.u_time.value += delta;
  uniforms.u_audioGlow.value = THREE.MathUtils.lerp(
    uniforms.u_audioGlow.value,
    0.25 + highBand * 1.5,
    0.08
  );
  uniforms.u_audioSpark.value = THREE.MathUtils.lerp(
    uniforms.u_audioSpark.value,
    highBand,
    0.15
  );

  updateBlobs(delta);
  updateSparks(delta, highBand);
  toy.render();
}

function handleResize() {
  uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
}

setupSettingsPanel();
initializeScene();
handleResize();
window.addEventListener('resize', handleResize);

async function startAudio(useSynthetic = false) {
  try {
    return await startToyAudio(toy, animate, {
      fftSize: 1024,
      smoothingTimeConstant: 0.8,
      fallbackToSynthetic: true,
      preferSynthetic: useSynthetic,
    });
  } catch (error) {
    console.warn('Falling back to silent animation', error);
    const ctx: AnimationContext = { toy, analyser: null };

    if (toy.rendererReady) {
      await toy.rendererReady;
    }

    toy.renderer?.setAnimationLoop(() => animate(ctx));
    return ctx;
  }
}

(window as unknown as Record<string, unknown>).startAudio = startAudio;
(window as unknown as Record<string, unknown>).startAudioFallback = () =>
  startAudio(true);

export {}; // Ensure this module is treated as an ES module
