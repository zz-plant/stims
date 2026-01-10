import * as THREE from 'three';
import WebToy from '../core/web-toy';
import {
  AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import { getAverageFrequency } from '../utils/audio-handler';
import { startToyAudio } from '../utils/start-audio';
import {
  resolveToyAudioOptions,
  type ToyAudioRequest,
} from '../utils/audio-start';
import {
  DEFAULT_QUALITY_PRESETS,
  getSettingsPanel,
  getActiveQualityPreset,
  type QualityPreset,
} from '../core/settings-panel';
import { initHints } from '../../ui/hints.ts';

type GravityState = {
  vector: THREE.Vector3;
  target: THREE.Vector3;
  locked: boolean;
};

type Heightfield = {
  size: number;
  heights: Float32Array;
  velocities: Float32Array;
  textureData: Float32Array;
  texture: THREE.DataTexture;
};

const TABLE_SIZE = 52;
const GRID_SIZE = 128;
const MAX_HEIGHT = 0.42;
const DEFAULT_GRAVITY = new THREE.Vector3(0, -1, -0.28);

function createHeightfield(size: number): Heightfield {
  const cells = size * size;
  const heights = new Float32Array(cells);
  const velocities = new Float32Array(cells);
  const textureData = new Float32Array(cells).fill(0.5);

  const texture = new THREE.DataTexture(
    textureData,
    size,
    size,
    THREE.RedFormat,
    THREE.FloatType
  );
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return { size, heights, velocities, textureData, texture };
}

function bandAverage(data: Uint8Array, start: number, end: number): number {
  if (!data.length) return 0;
  const clampedStart = Math.max(0, Math.min(start, data.length - 1));
  const clampedEnd = Math.max(clampedStart + 1, Math.min(end, data.length));
  let sum = 0;
  for (let i = clampedStart; i < clampedEnd; i += 1) {
    sum += data[i];
  }
  return sum / (clampedEnd - clampedStart);
}

function mapOrientationToGravity(
  event: DeviceOrientationEvent,
  state: GravityState
) {
  if (state.locked) return;

  const gamma = THREE.MathUtils.clamp(event.gamma ?? 0, -70, 70);
  const beta = THREE.MathUtils.clamp(event.beta ?? 0, -70, 70);

  state.target.set(gamma / 70, -1, -0.2 + beta / 90).normalize();
}

export async function start() {
  const toy = new WebToy({
    cameraOptions: {
      fov: 55,
      position: { x: 0, y: 26, z: 38 },
    },
    sceneOptions: {
      background: '#0c0f16',
      fog: { color: 0x0b0e15, density: 0.022 },
    },
    rendererOptions: { maxPixelRatio: 1.8, renderScale: 1 },
    ambientLightOptions: { color: 0xf4ecdf, intensity: 0.45 },
    lightingOptions: {
      type: 'DirectionalLight',
      position: { x: -18, y: 32, z: 24 },
      intensity: 1.1,
      color: 0xffffff,
    },
  });

  const gravity: GravityState = {
    vector: DEFAULT_GRAVITY.clone(),
    target: DEFAULT_GRAVITY.clone(),
    locked: false,
  };

  const heightfield = createHeightfield(GRID_SIZE);

  const sandGeometry = new THREE.PlaneGeometry(
    TABLE_SIZE,
    TABLE_SIZE,
    heightfield.size - 1,
    heightfield.size - 1
  );

  const sandMaterial = new THREE.MeshStandardMaterial({
    color: 0xe7dec9,
    roughness: 0.9,
    metalness: 0.08,
    displacementMap: heightfield.texture,
    displacementScale: 1.2,
    displacementBias: -0.25,
    normalScale: new THREE.Vector2(0.62, 0.62),
  });

  const sandMesh = new THREE.Mesh(sandGeometry, sandMaterial);
  sandMesh.rotation.x = -Math.PI / 2;
  sandMesh.position.y = -2.2;

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_SIZE + 1.6, 1.2, TABLE_SIZE + 1.6),
    new THREE.MeshStandardMaterial({
      color: 0x1b1f2a,
      metalness: 0.25,
      roughness: 0.4,
    })
  );
  rim.position.y = sandMesh.position.y - 0.6;

  const glow = new THREE.PointLight(0xffe1a8, 1.4, 72, 1.8);
  glow.position.set(0, 24, 0);

  const dustGeometry = new THREE.BufferGeometry();
  const dustCount = 360;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (TABLE_SIZE * 0.32);
    dustPositions[i * 3] = Math.cos(angle) * radius;
    dustPositions[i * 3 + 1] = THREE.MathUtils.randFloat(6, 14);
    dustPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  dustGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(dustPositions, 3)
  );
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0xf7e7c5,
      size: 0.12,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );

  const table = new THREE.Group();
  table.add(sandMesh);
  table.add(rim);
  table.add(glow);
  table.add(dust);
  toy.scene.add(table);

  const clock = new THREE.Clock();
  let damping = 0.984;
  let grainScale = 1.2;
  let rippleGain = 1;
  let activeQuality: QualityPreset = getActiveQualityPreset({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: 'balanced',
  });

  type MotionAccessState = 'prompt' | 'granted' | 'denied' | 'unavailable';
  const motionSupported =
    typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  let motionCleanup: (() => void) | null = null;
  const cleanupMotion = () => {
    motionCleanup?.();
    motionCleanup = null;
  };
  let motionAccess: MotionAccessState = motionSupported
    ? 'prompt'
    : 'unavailable';
  gravity.locked = motionAccess !== 'granted';

  (toy as WebToy & { cleanupMotion?: () => void }).cleanupMotion =
    cleanupMotion;

  const panel = getSettingsPanel();
  panel.configure({
    title: 'Tactile sand table',
    description:
      'Ripple the grains with bass and mids. Tilt your device to nudge gravity, or lock it when playing on desktop.',
  });

  panel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: activeQuality.id,
    onChange: (preset) => {
      activeQuality = preset;
      toy.updateRendererSettings({
        maxPixelRatio: preset.maxPixelRatio,
        renderScale: preset.renderScale,
      });
      rippleGain = preset.particleScale ?? 1;
    },
  });

  const grainRow = panel.addSection(
    'Grain size',
    'Scale the displacement height for taller or flatter dunes.'
  );
  const grainSlider = document.createElement('input');
  grainSlider.type = 'range';
  grainSlider.min = '0.6';
  grainSlider.max = '2.4';
  grainSlider.step = '0.02';
  grainSlider.value = grainScale.toString();
  grainSlider.setAttribute('aria-label', 'Grain size');
  grainSlider.className = 'control-panel__slider';
  grainSlider.addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    grainScale = value;
    sandMaterial.displacementScale = value;
  });
  grainRow.appendChild(grainSlider);

  const dampingRow = panel.addSection(
    'Damping',
    'Higher damping calms ripples faster; lower values keep waves lively.'
  );
  const dampingSlider = document.createElement('input');
  dampingSlider.type = 'range';
  dampingSlider.min = '0.94';
  dampingSlider.max = '0.995';
  dampingSlider.step = '0.001';
  dampingSlider.value = damping.toFixed(3);
  dampingSlider.setAttribute('aria-label', 'Ripple damping');
  dampingSlider.className = 'control-panel__slider';
  dampingSlider.addEventListener('input', (event) => {
    damping = Number((event.target as HTMLInputElement).value);
  });
  dampingRow.appendChild(dampingSlider);

  const gravityRow = panel.addSection(
    'Gravity',
    'Lock to the default downward pull on desktop, or let device tilt steer the sand.'
  );
  const gravityLock = document.createElement('input');
  gravityLock.type = 'checkbox';
  gravityLock.id = 'tactile-gravity-lock';
  const gravityToggle = document.createElement('label');
  gravityToggle.className = 'control-panel__checkbox-inline';
  gravityToggle.htmlFor = gravityLock.id;
  gravityToggle.textContent = 'Lock gravity';

  gravityLock.checked = gravity.locked;

  gravityLock.addEventListener('change', () => {
    gravity.locked = gravityLock.checked;
    if (gravity.locked) {
      gravity.target.copy(DEFAULT_GRAVITY);
    }
  });

  const recenter = document.createElement('button');
  recenter.type = 'button';
  recenter.className = 'cta-button';
  recenter.textContent = 'Re-center';
  recenter.addEventListener('click', () => {
    gravity.target.copy(DEFAULT_GRAVITY);
    gravity.vector.copy(DEFAULT_GRAVITY);
    gravityLock.checked = true;
    gravity.locked = true;
  });

  gravityToggle.prepend(gravityLock);
  gravityRow.append(gravityToggle, recenter);

  const motionStatus = document.createElement('p');
  motionStatus.className = 'control-panel__note';
  motionStatus.textContent = motionSupported
    ? 'Enable device motion to steer the sand with tilt.'
    : 'Device motion is unavailable; gravity will stay locked.';

  const motionButton = document.createElement('button');
  motionButton.type = 'button';
  motionButton.className = 'cta-button';
  motionButton.textContent = 'Enable motion control';
  motionButton.disabled = !motionSupported;

  gravityRow.append(motionStatus, motionButton);

  const syncGravityLock = (locked: boolean) => {
    gravity.locked = locked;
    gravityLock.checked = locked;
    gravityLock.disabled = motionAccess !== 'granted';
    if (locked) {
      gravity.target.copy(DEFAULT_GRAVITY);
      gravity.vector.copy(DEFAULT_GRAVITY);
    }
  };

  const updateMotionUI = () => {
    gravityLock.disabled = motionAccess !== 'granted';
    motionButton.disabled =
      motionAccess === 'granted' ||
      motionAccess === 'unavailable' ||
      motionAccess === 'denied';

    if (!motionSupported) {
      motionButton.textContent = 'Motion unsupported';
      motionStatus.textContent =
        'Device motion is unavailable; gravity will stay locked.';
      syncGravityLock(true);
      return;
    }

    if (motionAccess === 'granted') {
      motionButton.textContent = 'Motion enabled';
      motionStatus.textContent =
        'Motion control is active. Tilt to steer gravity.';
      syncGravityLock(false);
      return;
    }

    if (motionAccess === 'denied') {
      motionButton.textContent = 'Motion permission denied';
      motionStatus.textContent =
        'Motion access was denied. Gravity remains locked to default.';
      syncGravityLock(true);
      return;
    }

    motionButton.textContent = 'Enable motion control';
    motionButton.disabled = false;
    motionStatus.textContent =
      'Enable device motion to steer the sand with tilt.';
    syncGravityLock(true);
  };

  updateMotionUI();

  const registerMotionListener = () => {
    cleanupMotion();
    const handler = (event: DeviceOrientationEvent) =>
      mapOrientationToGravity(event, gravity);
    window.addEventListener('deviceorientation', handler);
    motionCleanup = () =>
      window.removeEventListener('deviceorientation', handler);
  };

  const requestMotionAccess = async () => {
    if (!motionSupported) return;

    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        'requestPermission' in DeviceOrientationEvent
      ) {
        const response = await (
          DeviceOrientationEvent as unknown as {
            requestPermission?: () => Promise<PermissionState>;
          }
        ).requestPermission?.();

        if (response !== 'granted') {
          motionAccess = response === 'denied' ? 'denied' : 'prompt';
          updateMotionUI();
          return;
        }
      }

      registerMotionListener();
      motionAccess = 'granted';
      updateMotionUI();
    } catch (error) {
      motionAccess = 'denied';
      updateMotionUI();
      console.error('Error requesting motion permission', error);
    }
  };

  motionButton.addEventListener('click', () => {
    void requestMotionAccess();
  });

  initHints({
    id: 'tactile-sand-table',
    tips: [
      'Low and mid frequencies punch deeper ripples; quiet passages leave softer dunes.',
      'Tilt your phone or tablet to steer the gravity vector.',
      'Lock gravity on desktop to keep the table steady, or unlock when using a motion-capable device.',
    ],
  });

  function addRipple(strength: number) {
    const centerJitter = 0.25 * (1 + Math.random() * 0.5);
    const x = Math.floor(
      heightfield.size / 2 +
        (Math.random() - 0.5) * heightfield.size * centerJitter
    );
    const y = Math.floor(
      heightfield.size / 2 +
        (Math.random() - 0.5) * heightfield.size * centerJitter
    );
    const radius = Math.max(2, Math.floor(3 + strength * 6));

    for (let dy = -radius; dy <= radius; dy += 1) {
      const yy = y + dy;
      if (yy <= 1 || yy >= heightfield.size - 2) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const xx = x + dx;
        if (xx <= 1 || xx >= heightfield.size - 2) continue;

        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > radius) continue;

        const falloff = 1 - distance / radius;
        const idx = yy * heightfield.size + xx;
        heightfield.velocities[idx] += strength * falloff * 0.08;
      }
    }
  }

  function updateHeightfield(delta: number) {
    const { size, heights, velocities, textureData } = heightfield;
    const waveTension = 0.22;
    const gravitySkew = new THREE.Vector2(
      gravity.vector.x,
      gravity.vector.z
    ).multiplyScalar(0.06);

    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        const idx = y * size + x;

        const laplacian =
          heights[idx - 1] +
          heights[idx + 1] +
          heights[idx - size] +
          heights[idx + size] -
          heights[idx] * 4;

        const slope =
          (heights[idx + 1] - heights[idx - 1]) * gravitySkew.x +
          (heights[idx + size] - heights[idx - size]) * gravitySkew.y;

        velocities[idx] += (laplacian * waveTension - slope) * delta;
        velocities[idx] *= damping;
        heights[idx] += velocities[idx] * delta * 60;
        heights[idx] = THREE.MathUtils.clamp(
          heights[idx],
          -MAX_HEIGHT,
          MAX_HEIGHT
        );
        textureData[idx] = 0.5 + heights[idx];
      }
    }

    textureData[0] = 0.5;
    heightfield.texture.needsUpdate = true;
  }

  function animate(ctx: AnimationContext) {
    const delta = clock.getDelta();
    const data = getContextFrequencyData(ctx);
    const avg = getAverageFrequency(data);
    const low = bandAverage(data, 0, Math.floor(data.length * 0.16));
    const mids = bandAverage(
      data,
      Math.floor(data.length * 0.16),
      Math.floor(data.length * 0.45)
    );

    const rippleIntensity = ((low * 0.65 + mids * 0.35) / 255) * rippleGain;

    if (rippleIntensity > 0.02) {
      addRipple(THREE.MathUtils.clamp(rippleIntensity * 2.4, 0.05, 2.5));
    }

    const shimmer = 0.12 + (avg / 255) * 0.3;
    (dust.material as THREE.PointsMaterial).opacity = shimmer;

    gravity.vector.lerp(gravity.target, 1 - Math.pow(0.0004, delta));
    table.rotation.x = gravity.vector.z * 0.32;
    table.rotation.z = -gravity.vector.x * 0.32;

    sandMaterial.displacementBias = -0.28 + rippleIntensity * 0.08;

    updateHeightfield(delta);
    ctx.toy.render();
  }

  async function startAudio(request: ToyAudioRequest = false) {
    return startToyAudio(
      toy,
      animate,
      resolveToyAudioOptions(request, { fftSize: 512 })
    );
  }

  const originalDispose = toy.dispose.bind(toy);
  toy.dispose = () => {
    cleanupMotion();
    originalDispose();
  };

  (window as unknown as Record<string, unknown>).startAudio = startAudio;
  (window as unknown as Record<string, unknown>).startAudioFallback = () =>
    startAudio(true);

  return toy;
}
