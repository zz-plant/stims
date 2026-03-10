import * as THREE from 'three';
import {
  createBloomComposer,
  type PostprocessingPipeline,
  resolveWebGLRenderer,
} from '../core/postprocessing';
import type { ToyStartOptions } from '../core/toy-interface';
import { createFeedbackWarpEffect } from '../utils/feedback-warp-effect';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

export function start({ container }: ToyStartOptions = {}) {
  let feedbackEffect: ReturnType<typeof createFeedbackWarpEffect> | null = null;
  let postprocessing: PostprocessingPipeline | null = null;
  let webglRenderer: THREE.WebGLRenderer | null = null;

  const particleCount = 100;
  const particleGeometry = new THREE.SphereGeometry(0.05, 8, 8);
  const particleMaterials: THREE.MeshBasicMaterial[] = [];

  const particles = new THREE.Group();

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 5 } },
      rendererOptions: { antialias: true },
    },
    audio: { fftSize: 512 },
    plugins: [
      {
        name: 'milkdrop-core',
        setup: ({ toy }) => {
          toy.scene.add(particles);
          for (let i = 0; i < particleCount; i += 1) {
            const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const mesh = new THREE.Mesh(particleGeometry, material);
            mesh.position.set(
              (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 5,
            );
            particles.add(mesh);
            particleMaterials.push(material);
          }

          toy.rendererReady.then((handle) => {
            if (!handle) return;
            webglRenderer = resolveWebGLRenderer(
              handle.backend,
              handle.renderer,
            );
            if (!webglRenderer) {
              return;
            }

            feedbackEffect = createFeedbackWarpEffect(webglRenderer);
            postprocessing = createBloomComposer({
              renderer: webglRenderer,
              scene: toy.scene,
              camera: toy.camera,
              bloomStrength: 0.95,
              bloomRadius: 0.5,
              bloomThreshold: 0.85,
            });
          });
        },
        update: ({ time, analyser, toy }) => {
          // Multi-band analysis
          const energy = analyser
            ? analyser.getMultiBandEnergy()
            : { bass: 0, mid: 0, treble: 0 };

          // Update particles based on audio
          particles.children.forEach((child, i) => {
            const mesh = child as THREE.Mesh;
            const speed = 0.01 + energy.bass * 0.1;
            mesh.position.y -= speed;
            if (mesh.position.y < -5) mesh.position.y = 5;

            const scale = 1 + energy.mid * 2;
            mesh.scale.setScalar(scale);

            const hue = (i / particleCount + time * 0.1) % 1;
            (mesh.material as THREE.MeshBasicMaterial).color.setHSL(
              hue,
              0.8,
              0.5 + energy.treble * 0.5,
            );
          });

          // Feedback and Warp
          if (feedbackEffect && webglRenderer) {
            feedbackEffect.render({
              scene: toy.scene,
              camera: toy.camera,
              time,
              intensity: energy.bass,
            });
            postprocessing?.updateSize();
          } else {
            postprocessing?.updateSize();
            postprocessing?.render();
          }
        },
        dispose: () => {
          feedbackEffect?.dispose();
          postprocessing?.dispose();
          disposeGeometry(particleGeometry);
          particleMaterials.forEach((material) => disposeMaterial(material));
        },
      },
    ],
  });

  const runtime = startRuntime({ container });

  const { configurePanel } = createToyQualityControls({
    title: 'MilkDrop Proto',
    description: 'A prototype of MilkDrop-style feedback engine.',
    defaultPresetId: 'medium',
    getRuntime: () => runtime,
    getRendererSettings: (preset) => ({ renderScale: preset.renderScale }),
  });
  configurePanel();

  return runtime;
}
