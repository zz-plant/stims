import * as THREE from 'three';
import { registerToyGlobals } from '../core/toy-globals';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import type { ToyAudioRequest } from '../utils/audio-start';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';
import type { UnifiedInputState, UnifiedPointer } from '../utils/unified-input';

type TideBlob = {
  position: THREE.Vector2;
  velocity: THREE.Vector2;
  life: number;
  radius: number;
  strength: number;
};

type TidePalette = {
  name: string;
  deep: THREE.ColorRepresentation;
  pool: THREE.ColorRepresentation;
  crest: THREE.ColorRepresentation;
  bloom: THREE.ColorRepresentation;
  foam: THREE.ColorRepresentation;
  spark: THREE.ColorRepresentation;
};

const MAX_BLOBS = 28;
const BASE_SPARK_COUNT = 200;

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const { quality, configurePanel } = createToyQualityControls({
    title: 'Bioluminescent tidepools',
    description:
      'Quality presets update DPI caps, blob limits, and spark counts without reloading. Pinch to shape the currents, rotate to swap moods, and nudge with arrow keys.',
    getRuntime: () => runtime,
    onChange: () => {
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
    },
  });
  let runtime: ToyRuntimeInstance;

  const controls = {
    trailLength: 2.4,
    glowStrength: 1.2,
    currentSpeed: 1,
  };

  const palettes: TidePalette[] = [
    {
      name: 'Nocturne',
      deep: '#021018',
      pool: '#073145',
      crest: '#3ab4c9',
      bloom: '#94f6ff',
      foam: '#2e7f88',
      spark: '#b5f7ff',
    },
    {
      name: 'Lagoon',
      deep: '#031b1e',
      pool: '#0e4a4f',
      crest: '#4fe6c6',
      bloom: '#d4fff5',
      foam: '#36b08e',
      spark: '#bafbee',
    },
    {
      name: 'Ember',
      deep: '#18070c',
      pool: '#3a1018',
      crest: '#ff6b6b',
      bloom: '#ffd6a5',
      foam: '#d94c4c',
      spark: '#ffe0b2',
    },
    {
      name: 'Aurora',
      deep: '#050b1f',
      pool: '#122063',
      crest: '#8a7dff',
      bloom: '#f2d7ff',
      foam: '#6d5cff',
      spark: '#d9d2ff',
    },
  ];
  let activePaletteIndex = 0;

  function getSparkCount() {
    const scale = quality.activeQuality.particleScale ?? 1;
    return Math.max(80, Math.floor(BASE_SPARK_COUNT * scale));
  }

  function getBlobCap() {
    const scale = quality.activeQuality.particleScale ?? 1;
    return Math.max(10, Math.min(MAX_BLOBS, Math.round(MAX_BLOBS * scale)));
  }

  const blobs: TideBlob[] = [];
  const blobUniforms = Array.from(
    { length: MAX_BLOBS },
    () => new THREE.Vector4(),
  );

  const uniforms = {
    u_time: { value: 0 },
    u_resolution: {
      value: new THREE.Vector2(window.innerWidth, window.innerHeight),
    },
    u_blobs: { value: blobUniforms },
    u_blobCount: { value: 0 },
    u_threshold: { value: 0.9 },
    u_glowStrength: { value: controls.glowStrength },
    u_currentSpeed: { value: controls.currentSpeed },
    u_audioGlow: { value: 0 },
    u_audioSpark: { value: 0 },
    u_paletteDeep: { value: new THREE.Color() },
    u_palettePool: { value: new THREE.Color() },
    u_paletteCrest: { value: new THREE.Color() },
    u_paletteBloom: { value: new THREE.Color() },
    u_paletteFoam: { value: new THREE.Color() },
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
    uniform vec3 u_paletteDeep;
    uniform vec3 u_palettePool;
    uniform vec3 u_paletteCrest;
    uniform vec3 u_paletteBloom;
    uniform vec3 u_paletteFoam;

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

      vec3 deepSea = u_paletteDeep;
      vec3 pool = u_palettePool;
      vec3 crest = u_paletteCrest;
      vec3 bloom = u_paletteBloom;

      vec2 warp = vec2(
        fbm(uv * 3.2 + u_time * 0.12),
        fbm(uv * 3.2 - u_time * 0.18)
      );
      vec2 warpedUv = uv + (warp - 0.5) * 0.08;
      float foam = fbm(warpedUv * 6.2 + u_time * 0.08) * 0.35;
      float caustics = pow(fbm(warpedUv * 10.0 + u_time * 0.4), 2.4);
      float glowStrength = (u_glowStrength + u_audioGlow * 1.4);

      vec3 color = mix(deepSea, pool, shoreline + foam * 0.2);
      color = mix(color, crest, shell);
      color += pow(max(field - u_threshold, 0.0), 1.4) * bloom * glowStrength;
      color += caustics * u_paletteFoam * (0.18 + u_audioGlow * 0.35);

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
    }),
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
  const lastPointerPositions = new Map<number, UnifiedPointer>();
  const clock = new THREE.Clock();
  let targetGlowStrength = controls.glowStrength;
  let targetCurrentSpeed = controls.currentSpeed;
  let targetTrailLength = controls.trailLength;
  let targetThreshold = uniforms.u_threshold.value;
  let gestureRotation = 0;
  let rotationLatch = 0;

  function applyPalette(index: number) {
    const palette = palettes[index];
    uniforms.u_paletteDeep.value.set(palette.deep);
    uniforms.u_palettePool.value.set(palette.pool);
    uniforms.u_paletteCrest.value.set(palette.crest);
    uniforms.u_paletteBloom.value.set(palette.bloom);
    uniforms.u_paletteFoam.value.set(palette.foam);
    sparkMaterial.color.set(palette.spark);
  }

  function resetSpark(index: number, anchor?: TideBlob) {
    const uv =
      anchor?.position ?? new THREE.Vector2(Math.random(), Math.random());
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
    runtime.toy.scene.add(plane);
    runtime.toy.scene.add(sparks);

    sparkGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(sparkPositions, 3),
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
      blob.position.addScaledVector(
        blob.velocity,
        delta * 0.35 * controls.currentSpeed,
      );

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
      blobUniforms[i].set(
        blob.position.x,
        blob.position.y,
        blob.radius,
        blob.strength,
      );
    }
  }

  function spawnBlobFromPointer(pointer: UnifiedPointer, intensity = 1) {
    const last = lastPointerPositions.get(pointer.id);
    const current = new THREE.Vector2(
      pointer.normalizedX * 0.5 + 0.5,
      pointer.normalizedY * 0.5 + 0.5,
    );

    const velocity = last
      ? new THREE.Vector2(
          current.x - (last.normalizedX * 0.5 + 0.5),
          current.y - (last.normalizedY * 0.5 + 0.5),
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

  function handlePointerUpdate(state: UnifiedInputState) {
    if (!state.pointers.length) {
      lastPointerPositions.clear();
      gestureRotation = 0;
      rotationLatch = 0;
      return;
    }

    const centroid = state.normalizedCentroid;
    targetGlowStrength = THREE.MathUtils.clamp(
      1.1 + (centroid.y + 1) * 0.3,
      0.85,
      1.9,
    );
    targetThreshold = THREE.MathUtils.clamp(
      0.88 + centroid.x * 0.08,
      0.78,
      1.05,
    );

    state.pointers.forEach((pointer) => {
      spawnBlobFromPointer(pointer, 0.9);
    });

    const gesture = state.gesture;
    if (!gesture || gesture.pointerCount < 2) return;

    targetCurrentSpeed = THREE.MathUtils.clamp(
      1 + (gesture.scale - 1) * 1.6,
      0.6,
      2.6,
    );
    targetTrailLength = THREE.MathUtils.clamp(
      2.4 + (gesture.scale - 1) * 1.4,
      1.4,
      3.8,
    );
    targetGlowStrength = THREE.MathUtils.clamp(
      1.15 + Math.abs(gesture.rotation) * 1.3,
      0.9,
      2.5,
    );
    targetThreshold = THREE.MathUtils.clamp(
      0.88 + gesture.translation.y * 0.2,
      0.7,
      1.05,
    );

    gestureRotation = gesture.rotation;
    if (rotationLatch <= 0.45 && gestureRotation > 0.45) {
      activePaletteIndex = (activePaletteIndex + 1) % palettes.length;
      applyPalette(activePaletteIndex);
    } else if (rotationLatch >= -0.45 && gestureRotation < -0.45) {
      activePaletteIndex =
        (activePaletteIndex - 1 + palettes.length) % palettes.length;
      applyPalette(activePaletteIndex);
    }
    rotationLatch = gestureRotation;
  }

  function updateSparks(delta: number, energy: number) {
    const positions = sparkGeometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const respawnBudget = Math.min(
      activeSparkCount,
      Math.floor(4 + energy * 24),
    );
    let respawned = 0;

    for (let i = 0; i < activeSparkCount; i += 1) {
      const life = sparkLife[i];
      if (life <= 0 && respawned < respawnBudget) {
        resetSpark(
          i,
          blobs[THREE.MathUtils.randInt(0, Math.max(blobs.length - 1, 0))],
        );
        respawned += 1;
      }
    }

    for (let i = 0; i < activeSparkCount; i += 1) {
      if (sparkLife[i] <= 0) continue;

      sparkLife[i] -= delta * (0.6 + energy * 0.8);
      sparkPositions[i * 3] += sparkVelocities[i * 3] * delta * 0.4;
      sparkPositions[i * 3 + 1] += sparkVelocities[i * 3 + 1] * delta * 0.4;

      sparkPositions[i * 3] = THREE.MathUtils.clamp(
        sparkPositions[i * 3],
        -1.2,
        1.2,
      );
      sparkPositions[i * 3 + 1] = THREE.MathUtils.clamp(
        sparkPositions[i * 3 + 1],
        -1.2,
        1.2,
      );

      if (sparkLife[i] <= 0) {
        sparkPositions[i * 3 + 2] = -10;
      }
    }

    positions.needsUpdate = true;
    sparkGeometry.computeBoundingSphere();
  }

  function handleResize() {
    uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
  }

  function setupSettingsPanel() {
    configurePanel();
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

  function animate(data: Uint8Array) {
    const delta = clock.getDelta();
    const highBand = computeHighBandEnergy(data);

    controls.glowStrength = THREE.MathUtils.lerp(
      controls.glowStrength,
      targetGlowStrength,
      0.08,
    );
    controls.currentSpeed = THREE.MathUtils.lerp(
      controls.currentSpeed,
      targetCurrentSpeed,
      0.06,
    );
    controls.trailLength = THREE.MathUtils.lerp(
      controls.trailLength,
      targetTrailLength,
      0.06,
    );
    uniforms.u_threshold.value = THREE.MathUtils.lerp(
      uniforms.u_threshold.value,
      targetThreshold,
      0.08,
    );
    uniforms.u_glowStrength.value = controls.glowStrength;
    uniforms.u_currentSpeed.value = controls.currentSpeed;

    uniforms.u_time.value += delta;
    uniforms.u_audioGlow.value = THREE.MathUtils.lerp(
      uniforms.u_audioGlow.value,
      0.25 + highBand * 1.5,
      0.08,
    );
    uniforms.u_audioSpark.value = THREE.MathUtils.lerp(
      uniforms.u_audioSpark.value,
      highBand,
      0.15,
    );

    updateBlobs(delta);
    updateSparks(delta, highBand);
    runtime.toy.render();
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
      targetCurrentSpeed = THREE.MathUtils.clamp(
        targetCurrentSpeed + 0.15,
        0.6,
        2.6,
      );
    } else if (event.key === 'ArrowDown') {
      targetCurrentSpeed = THREE.MathUtils.clamp(
        targetCurrentSpeed - 0.15,
        0.6,
        2.6,
      );
    }
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { fov: 50, position: { x: 0, y: 0, z: 1.6 } },
      sceneOptions: { background: '#03121c' },
      rendererOptions: {
        exposure: 1.35,
        maxPixelRatio: quality.activeQuality.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: {
      fftSize: 1024,
      options: {
        smoothingTimeConstant: 0.8,
        fallbackToSynthetic: true,
      },
    },
    input: {
      onInput: (state) => {
        if (state) handlePointerUpdate(state);
      },
    },
    plugins: [
      {
        name: 'bioluminescent-tidepools',
        setup: () => {
          setupSettingsPanel();
          initializeScene();
          applyPalette(activePaletteIndex);
          handleResize();
          window.addEventListener('resize', handleResize);
          window.addEventListener('keydown', handleKeydown);
        },
        update: ({ frequencyData }) => {
          animate(frequencyData);
        },
        dispose: () => {
          window.removeEventListener('resize', handleResize);
          window.removeEventListener('keydown', handleKeydown);
          disposeGeometry(sparkGeometry);
          disposeMaterial(sparkMaterial);
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  async function startAudio(request: ToyAudioRequest = false) {
    try {
      return await runtime.startAudio(request);
    } catch (error) {
      console.warn('Falling back to silent animation', error);
      if (runtime.toy.rendererReady) {
        await runtime.toy.rendererReady;
      }
      runtime.toy.renderer?.setAnimationLoop(() => animate(new Uint8Array()));
      return null;
    }
  }

  const unregisterGlobals = registerToyGlobals(container, startAudio);

  return {
    ...runtime,
    dispose: () => {
      unregisterGlobals();
      runtime.dispose();
    },
  };
}
