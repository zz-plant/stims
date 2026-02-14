import * as THREE from 'three';
import {
  createBloomComposer,
  isWebGLRenderer,
  type PostprocessingPipeline,
} from '../core/postprocessing';
import type { RendererBackend } from '../core/renderer-capabilities';
import { registerToyGlobals } from '../core/toy-globals';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { getWeightedAverageFrequency } from '../utils/audio-handler';
import { createRuntimeAudioStarter } from '../utils/audio-start-helpers';
import {
  type ControlPanelState,
  createControlPanel,
} from '../utils/control-panel';
import { createIdleDetector } from '../utils/idle-detector';
import { disposeGeometry, disposeMesh } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

export function start({ container }: ToyStartOptions = {}) {
  let errorElement: HTMLElement | null = null;
  const { quality, configurePanel } = createToyQualityControls({
    title: '3D soundscape',
    description: 'Resolution and particle density follow the preset you pick.',
    getRuntime: () => runtime,
    onChange: () => {
      rebuildSceneContents();
    },
  });
  let runtime: ToyRuntimeInstance;

  let torusKnot: THREE.Mesh | null = null;
  let particles: THREE.Points | null = null;
  let postprocessing: PostprocessingPipeline | null = null;
  let rendererBackend: RendererBackend | null = null;
  const instancedShapes: InstancedShapeSet[] = [];
  const instanceTempObject = new THREE.Object3D();
  const instanceScale = new THREE.Vector3();
  let paletteHue = 0.6;
  let idleBlend = 0;
  let controlState: ControlPanelState;
  const idleDetector = createIdleDetector();
  const clock = new THREE.Clock();

  function getCounts() {
    const scale = quality.activeQuality.particleScale ?? 1;
    return {
      particleCount: Math.max(600, Math.floor(1500 * scale)),
      shapeCount: Math.max(3, Math.round(7 * scale)),
      torusSegments: Math.max(40, Math.round(100 * scale)),
      torusTubularSegments: Math.max(10, Math.round(16 * Math.sqrt(scale))),
    };
  }

  type ShapeInstance = {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    rotationSpeed: THREE.Vector3;
    scale: number;
    driftSpeed: number;
    wobbleSeed: number;
    color: THREE.Color;
  };

  type InstancedShapeSet = {
    mesh: THREE.InstancedMesh;
    instances: ShapeInstance[];
  };

  function disposeInstancedShapes() {
    instancedShapes.splice(0).forEach(({ mesh }) => {
      disposeMesh(mesh);
    });
  }

  function createInstancedShapes(shapeCount: number) {
    const primaryCount = Math.ceil(shapeCount / 3);
    const secondaryCount = Math.floor(shapeCount / 3);
    const remainingCount = Math.max(
      0,
      shapeCount - primaryCount - secondaryCount,
    );
    const counts = [primaryCount, secondaryCount, remainingCount];

    const configs: Array<{
      geometry: THREE.BufferGeometry;
      count: number;
    }> = [
      { geometry: new THREE.SphereGeometry(5, 32, 32), count: counts[0] },
      { geometry: new THREE.BoxGeometry(7, 7, 7), count: counts[1] },
      { geometry: new THREE.TetrahedronGeometry(6, 0), count: counts[2] },
    ];

    configs.forEach(({ geometry, count }) => {
      if (count <= 0) {
        disposeGeometry(geometry);
        return;
      }

      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x222222,
        metalness: 0.8,
        roughness: 0.4,
        vertexColors: true,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      runtime.toy.scene.add(mesh);

      const instances: ShapeInstance[] = [];

      for (let i = 0; i < count; i++) {
        const position = new THREE.Vector3(
          Math.random() * 120 - 60,
          Math.random() * 120 - 60,
          Math.random() * -800,
        );
        const rotation = new THREE.Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        );
        const rotationSpeed = new THREE.Vector3(
          Math.random() * 0.03,
          Math.random() * 0.03,
          Math.random() * 0.03,
        );
        const scale = 0.9 + Math.random() * 0.6;
        const driftSpeed = 1.5 + Math.random() * 0.6;
        const wobbleSeed = Math.random() * 8;
        const color = new THREE.Color(Math.random() * 0xffffff);

        instances.push({
          position,
          rotation,
          rotationSpeed,
          scale,
          driftSpeed,
          wobbleSeed,
          color,
        });

        instanceTempObject.position.copy(position);
        instanceTempObject.rotation.copy(rotation);
        instanceScale.set(scale, scale, scale);
        instanceTempObject.scale.copy(instanceScale);
        instanceTempObject.updateMatrix();
        mesh.setMatrixAt(i, instanceTempObject.matrix);
        mesh.setColorAt(i, color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }

      instancedShapes.push({ mesh, instances });
    });
  }

  function rebuildSceneContents() {
    disposeMesh(torusKnot);
    disposeMesh(particles as unknown as THREE.Mesh);
    disposeInstancedShapes();
    torusKnot = null;
    particles = null;

    const { particleCount, shapeCount, torusSegments, torusTubularSegments } =
      getCounts();

    const torusMaterial =
      rendererBackend === 'webgpu'
        ? new THREE.MeshPhysicalMaterial({
            color: 0x00ffcc,
            metalness: 0.15,
            roughness: 0.1,
            clearcoat: 0.8,
            clearcoatRoughness: 0.2,
            iridescence: 0.85,
            iridescenceIOR: 1.3,
            iridescenceThicknessRange: [120, 420],
            transmission: 0.4,
            thickness: 0.8,
          })
        : new THREE.MeshStandardMaterial({
            color: 0x00ffcc,
            metalness: 0.7,
            roughness: 0.4,
          });

    torusKnot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(10, 3, torusSegments, torusTubularSegments),
      torusMaterial,
    );
    runtime.toy.scene.add(torusKnot);

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
    runtime.toy.scene.add(particles);

    createInstancedShapes(shapeCount);
  }

  function setupPostProcessing() {
    if (postprocessing) return;
    runtime.toy.rendererReady.then((result) => {
      if (!result || postprocessing) return;
      if (!isWebGLRenderer(result.renderer)) return;

      postprocessing = createBloomComposer({
        renderer: result.renderer,
        scene: runtime.toy.scene,
        camera: runtime.toy.camera,
        bloomStrength: 0.65,
        bloomRadius: 0.45,
        bloomThreshold: 0.88,
      });
    });
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

  function animate(dataArray: Uint8Array, _time: number) {
    if (!torusKnot || !particles) return;
    const avgFrequency = getWeightedAverageFrequency(dataArray);

    const { idle, idleProgress } = idleDetector.update(dataArray);
    const idleTarget = controlState.idleEnabled ? idleProgress : 0;
    idleBlend = THREE.MathUtils.lerp(idleBlend, idleTarget, 0.05);
    const idleStrength = controlState.mobilePreset ? 0.55 : 1;
    const idleOffset = idleBlend * idleStrength;

    const elapsed = clock.getElapsedTime();
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
    runtime.toy.scene.background = backgroundColor;
    const body = (container?.ownerDocument ?? document).body;
    body.style.backgroundImage = `radial-gradient(circle at 20% 20%, hsla(${
      (paletteHue + 0.08) * 360
    }, 70%, ${25 + idleBlend * 15}%, 0.9), hsla(${
      (paletteHue + 0.26) * 360
    }, 60%, ${6 + idleBlend * 10}%, 0.95))`;

    torusKnot.rotation.x += avgFrequency / 5000;
    torusKnot.rotation.y += avgFrequency / 7000;

    const wobble = 1 + Math.sin(elapsed * 0.6) * 0.15 * idleOffset;
    const wobbleVec = new THREE.Vector3(wobble, wobble, wobble);
    torusKnot.scale.lerp(wobbleVec, 0.08);

    particles.rotation.y += 0.001 + avgFrequency / 15000;

    instancedShapes.forEach(({ mesh, instances }) => {
      let colorNeedsUpdate = false;
      instances.forEach((instance, index) => {
        instance.rotation.x += instance.rotationSpeed.x;
        instance.rotation.y += instance.rotationSpeed.y;
        instance.rotation.z += instance.rotationSpeed.z;
        instance.position.z += instance.driftSpeed + avgFrequency / 50;
        if (instance.position.z > 20) {
          instance.position.z = -800;
          instance.position.x = Math.random() * 120 - 60;
          instance.position.y = Math.random() * 120 - 60;
          instance.scale = 0.9 + Math.random() * 0.6;
          instance.color.setHex(Math.random() * 0xffffff);
          mesh.setColorAt(index, instance.color);
          colorNeedsUpdate = true;
        }
        const wobbleAmt =
          1 + Math.sin(elapsed * 0.9 + instance.wobbleSeed) * 0.08 * idleOffset;
        const scaled = instance.scale * wobbleAmt;
        instanceTempObject.position.copy(instance.position);
        instanceTempObject.rotation.copy(instance.rotation);
        instanceScale.set(scaled, scaled, scaled);
        instanceTempObject.scale.copy(instanceScale);
        instanceTempObject.updateMatrix();
        mesh.setMatrixAt(index, instanceTempObject.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (colorNeedsUpdate && mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    });

    const randomScale =
      1 +
      Math.sin(Date.now() * 0.001) * (controlState.mobilePreset ? 0.15 : 0.3);
    torusKnot.scale.set(randomScale, randomScale, randomScale);

    const driftAmount = idleOffset * (controlState.mobilePreset ? 2.5 : 4.2);
    runtime.toy.camera.position.x = Math.sin(elapsed * 0.25) * driftAmount;
    runtime.toy.camera.position.y = Math.cos(elapsed * 0.2) * driftAmount * 0.6;
    runtime.toy.camera.lookAt(0, 0, 0);

    if (postprocessing) {
      postprocessing.updateSize();
      postprocessing.render();
    } else {
      runtime.toy.render();
    }
  }

  function setupSettingsPanel() {
    configurePanel();
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 80 } },
      lightingOptions: {
        type: 'PointLight',
        color: 0xff00ff,
        intensity: 2,
        position: { x: 20, y: 30, z: 20 },
      },
      ambientLightOptions: { color: 0x404040, intensity: 0.8 },
      rendererOptions: {
        maxPixelRatio: quality.activeQuality.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 512 },
    plugins: [
      {
        name: 'three-d-toy',
        setup: (runtimeInstance) => {
          runtime = runtimeInstance;
          setupSettingsPanel();
          const controlPanel = createControlPanel();
          controlState = controlPanel.getState();
          controlPanel.onChange((state) => {
            controlState = state;
          });
          rebuildSceneContents();
          runtimeInstance.toy.rendererReady.then((handle) => {
            if (!handle) return;
            rendererBackend = handle.backend;
            rebuildSceneContents();
            setupPostProcessing();
          });
        },
        update: ({ frequencyData, time }) => {
          animate(frequencyData, time);
        },
        dispose: () => {
          errorElement?.remove();
          postprocessing?.dispose();
        },
      },
    ],
  });

  runtime = startRuntime({ container });

  const startAudio = createRuntimeAudioStarter({
    runtime,
    onSuccess: () => {
      hideError();
    },
    onError: () => {
      showError(
        'Microphone access was denied. Please allow access and reload.',
      );
    },
  });

  const unregisterGlobals = registerToyGlobals(container, startAudio);

  return {
    ...runtime,
    dispose: () => {
      unregisterGlobals();
      runtime.dispose();
    },
  };
}
