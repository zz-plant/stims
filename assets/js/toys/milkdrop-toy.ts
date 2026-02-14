import * as THREE from 'three';
import type { ToyStartOptions } from '../core/toy-interface';
import FeedbackManager from '../utils/feedback-manager';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';
import WarpShader from '../utils/warp-shader';

export function start({ container }: ToyStartOptions = {}) {
  let feedback: FeedbackManager | null = null;
  let warpMaterial: THREE.ShaderMaterial | null = null;
  let warpMesh: THREE.Mesh | null = null;
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

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
            const renderer = handle.renderer as THREE.WebGLRenderer;
            feedback = new FeedbackManager({ renderer });

            warpMaterial = new THREE.ShaderMaterial({
              ...WarpShader,
              uniforms: THREE.UniformsUtils.clone(WarpShader.uniforms),
            });
            warpMaterial.uniforms.tDiffuse.value = feedback.texture;
            warpMaterial.uniforms.uResolution.value.set(
              window.innerWidth,
              window.innerHeight,
            );

            warpMesh = new THREE.Mesh(
              new THREE.PlaneGeometry(2, 2),
              warpMaterial,
            );
            overlayScene.add(warpMesh);
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
          if (feedback && warpMaterial && toy.renderer) {
            const renderer = toy.renderer as THREE.WebGLRenderer;

            // 1. Update warp uniforms
            warpMaterial.uniforms.uTime.value = time;
            warpMaterial.uniforms.uAudioIntensity.value = energy.bass;
            warpMaterial.uniforms.uZoom.value =
              1.0 + Math.sin(time * 0.5) * 0.02;
            warpMaterial.uniforms.uRotation.value = Math.sin(time * 0.2) * 0.01;

            // 2. Render main scene + feedback into write buffer
            // In MilkDrop, we render the PREVIOUS frame (distorted) and then overlay new graphics
            renderer.setRenderTarget(null); // Clear default

            // Actually, we need to render the warped texture BACK into the feedback buffer
            // or render the scene ON TOP of the warped texture.

            // Sequence:
            // a. Render overlay (warpMesh showing feedback.texture) into writeBuffer
            // b. Render main scene (particles) into writeBuffer (no clear)
            // c. Render writeBuffer to screen
            // d. Swap

            renderer.setRenderTarget(feedback.writeTarget);
            renderer.clear();
            renderer.render(overlayScene, overlayCamera); // Draw the warped previous frame
            renderer.autoClear = false;
            renderer.render(toy.scene, toy.camera); // Draw new elements on top
            renderer.autoClear = true;

            renderer.setRenderTarget(null);
            renderer.render(overlayScene, overlayCamera); // Final output to screen

            feedback.swap();
            warpMaterial.uniforms.tDiffuse.value = feedback.texture;
          } else {
            toy.render();
          }
        },
        dispose: () => {
          feedback?.dispose();
          disposeGeometry(particleGeometry);
          particleMaterials.forEach((material) => disposeMaterial(material));
          disposeMaterial(warpMaterial);
          disposeGeometry(warpMesh?.geometry ?? undefined);
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
