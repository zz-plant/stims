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
import {
  type ControlPanelState,
  createControlPanel,
} from '../utils/control-panel';
import { createIdleDetector } from '../utils/idle-detector';
import { startToyAudio } from '../utils/start-audio';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  let errorElement: HTMLElement | null = null;
  const settingsPanel = getSettingsPanel();
  let activeQuality: QualityPreset = getActiveQualityPreset();

  const toy = new WebToy({
    cameraOptions: { position: { x: 0, y: 0, z: 80 } },
    lightingOptions: {
      type: 'PointLight',
      color: 0xff00ff,
      intensity: 2,
      position: { x: 20, y: 30, z: 20 },
    },
    ambientLightOptions: { color: 0x404040, intensity: 0.8 },
    rendererOptions: {
      maxPixelRatio: activeQuality.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    },
    canvas: container?.querySelector('canvas'),
  } as ToyConfig);

  let torusKnot: THREE.Mesh | null = null;
  let particles: THREE.Points | null = null;
  const shapes: THREE.Mesh[] = [];
  let paletteHue = 0.6;
  let idleBlend = 0;
  let controlState: ControlPanelState;
  const idleDetector = createIdleDetector();
  const clock = new THREE.Clock();

  function getCounts() {
    const scale = activeQuality.particleScale ?? 1;
    return {
      particleCount: Math.max(600, Math.floor(1500 * scale)),
      shapeCount: Math.max(3, Math.round(7 * scale)),
      torusSegments: Math.max(40, Math.round(100 * scale)),
      torusTubularSegments: Math.max(10, Math.round(16 * Math.sqrt(scale))),
    };
  }

  function disposeMesh(mesh: THREE.Mesh | null) {
    if (!mesh) return;
    toy.scene.remove(mesh);
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => material?.dispose());
    } else {
      mesh.material?.dispose();
    }
  }

  function createRandomShape() {
    const shapeType = Math.floor(Math.random() * 3);
    let geometry: THREE.BufferGeometry;
    const material = new THREE.MeshStandardMaterial({
      color: Math.random() * 0xffffff,
      emissive: Math.random() * 0x444444,
      metalness: 0.8,
      roughness: 0.4,
    });

    switch (shapeType) {
      case 0:
        geometry = new THREE.SphereGeometry(5, 32, 32);
        break;
      case 1:
        geometry = new THREE.BoxGeometry(7, 7, 7);
        break;
      default:
        geometry = new THREE.TetrahedronGeometry(6, 0);
        break;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      Math.random() * 120 - 60,
      Math.random() * 120 - 60,
      Math.random() * -800,
    );
    toy.scene.add(mesh);
    shapes.push(mesh);
  }

  function rebuildSceneContents() {
    disposeMesh(torusKnot);
    disposeMesh(particles as unknown as THREE.Mesh);
    shapes.splice(0).forEach((shape) => disposeMesh(shape));
    torusKnot = null;
    particles = null;

    const { particleCount, shapeCount, torusSegments, torusTubularSegments } =
      getCounts();

    torusKnot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(10, 3, torusSegments, torusTubularSegments),
      new THREE.MeshStandardMaterial({
        color: 0x00ffcc,
        metalness: 0.7,
        roughness: 0.4,
      }),
    );
    toy.scene.add(torusKnot);

    const particlesGeometry = new THREE.BufferGeometry();
    const particlesPosition = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
      particlesPosition[i] = (Math.random() - 0.5) * 800;
    }
    particlesGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(particlesPosition, 3),
    );
    const particlesMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.8,
    });
    particles = new THREE.Points(particlesGeometry, particlesMaterial);
    toy.scene.add(particles);

    for (let i = 0; i < shapeCount; i++) {
      createRandomShape();
    }
  }

  function showError(message: string) {
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.id = 'error-message';
      errorElement.style.position = 'absolute';
      errorElement.style.top = '20px';
      errorElement.style.left = '20px';
      errorElement.style.color = '#ff0000';
      errorElement.style.background = 'rgba(0, 0, 0, 0.7)';
      errorElement.style.padding = '10px';
      errorElement.style.borderRadius = '5px';
      errorElement.style.zIndex = '10';
      (container || document.body).appendChild(errorElement);
    }
    errorElement.textContent = message;
    errorElement.style.display = 'block';
  }

  function hideError() {
    if (errorElement) {
      errorElement.style.display = 'none';
    }
  }

  function animate(ctx: AnimationContext) {
    if (!torusKnot || !particles) return;
    const dataArray = getContextFrequencyData(ctx);
    const avgFrequency = getAverageFrequency(dataArray);

    const { idle, idleProgress } = idleDetector.update(dataArray);
    const idleTarget = controlState.idleEnabled ? idleProgress : 0;
    idleBlend = THREE.MathUtils.lerp(idleBlend, idleTarget, 0.05);
    const idleStrength = controlState.mobilePreset ? 0.55 : 1;
    const idleOffset = idleBlend * idleStrength;

    const time = clock.getElapsedTime();
    const paletteEnabled = controlState.paletteCycle;
    const paletteSpeedBase = controlState.mobilePreset ? 0.003 : 0.006;
    const activityDamp = idle ? 1 : 0.2;
    const paletteSpeed = paletteEnabled
      ? paletteSpeedBase * (idleBlend + activityDamp)
      : 0;
    paletteHue = (paletteHue + paletteSpeed) % 1;

    const backgroundColor = new THREE.Color().setHSL(
      paletteHue,
      0.4,
      0.08 + idleBlend * 0.1,
    );
    toy.scene.background = backgroundColor;
    const body = (container?.ownerDocument ?? document).body;
    body.style.backgroundImage = `radial-gradient(circle at 20% 20%, hsla(${
      (paletteHue + 0.08) * 360
    }, 70%, ${25 + idleBlend * 15}%, 0.9), hsla(${
      (paletteHue + 0.26) * 360
    }, 60%, ${6 + idleBlend * 10}%, 0.95))`;

    torusKnot.rotation.x += avgFrequency / 5000;
    torusKnot.rotation.y += avgFrequency / 7000;

    const wobble = 1 + Math.sin(time * 0.6) * 0.15 * idleOffset;
    const wobbleVec = new THREE.Vector3(wobble, wobble, wobble);
    torusKnot.scale.lerp(wobbleVec, 0.08);

    particles.rotation.y += 0.001 + avgFrequency / 15000;

    shapes.forEach((shape) => {
      shape.rotation.x += Math.random() * 0.03;
      shape.rotation.y += Math.random() * 0.03;
      shape.position.z += 1.5 + avgFrequency / 50;
      if (shape.position.z > 20) {
        shape.position.z = -800;
        shape.position.x = Math.random() * 120 - 60;
        shape.position.y = Math.random() * 120 - 60;
        (shape.material as THREE.MeshStandardMaterial).color.set(
          Math.random() * 0xffffff,
        );
      }
      const wobbleAmt =
        1 + Math.sin(time * 0.9 + shape.position.x) * 0.08 * idleOffset;
      shape.scale.lerp(new THREE.Vector3(wobbleAmt, wobbleAmt, wobbleAmt), 0.1);
    });

    const randomScale =
      1 + Math.sin(Date.now() * 0.001) * (controlState.mobilePreset ? 0.15 : 0.3);
    torusKnot.scale.set(randomScale, randomScale, randomScale);

    const driftAmount = idleOffset * (controlState.mobilePreset ? 2.5 : 4.2);
    toy.camera.position.x = Math.sin(time * 0.25) * driftAmount;
    toy.camera.position.y = Math.cos(time * 0.2) * driftAmount * 0.6;
    toy.camera.lookAt(0, 0, 0);

    ctx.toy.render();
  }

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    toy.updateRendererSettings({
      maxPixelRatio: preset.maxPixelRatio,
      renderScale: preset.renderScale,
    });
    rebuildSceneContents();
  }

  function setupSettingsPanel() {
    settingsPanel.configure({
      title: '3D soundscape',
      description: 'Resolution and particle density follow the preset you pick.',
    });
    settingsPanel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });
  }

  async function startAudio(request: ToyAudioRequest = false) {
    try {
      await startToyAudio(toy, animate, resolveToyAudioOptions(request));
      hideError();
      return true;
    } catch (e) {
      showError('Microphone access was denied. Please allow access and reload.');
      throw e;
    }
  }

  setupSettingsPanel();
  const controlPanel = createControlPanel();
  controlState = controlPanel.getState();
  const controlPanelUnsub = controlPanel.onChange((state) => {
    controlState = state;
  });
  rebuildSceneContents();

  // Register globals for toy.html buttons
  const win = (container?.ownerDocument.defaultView ?? window) as any;
  win.startAudio = startAudio;
  win.startAudioFallback = () => startAudio(true);

  return {
    dispose: () => {
      toy.dispose();
      errorElement?.remove();
      win.startAudio = undefined;
      win.startAudioFallback = undefined;
    },
  };
}
