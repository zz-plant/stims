import * as THREE from 'three';
import WebToy from '../core/web-toy';
import { registerToyGlobals } from '../core/toy-globals';
import { startToyAudio } from '../utils/start-audio';
import { resolveToyAudioOptions, type ToyAudioRequest } from '../utils/audio-start';
import { getContextFrequencyData, type AnimationContext } from '../core/animation-loop';
import FeedbackManager from '../utils/feedback-manager';
import WarpShader from '../utils/warp-shader';
import { getSettingsPanel, DEFAULT_QUALITY_PRESETS } from '../core/settings-panel';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const toy = new WebToy({
    cameraOptions: { position: { x: 0, y: 0, z: 5 } },
    rendererOptions: { antialias: true },
    canvas: container?.querySelector('canvas'),
  });

  let feedback: FeedbackManager | null = null;
  let warpMaterial: THREE.ShaderMaterial | null = null;
  let warpMesh: THREE.Mesh | null = null;
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Main scene elements
  const particles = new THREE.Group();
  toy.scene.add(particles);

  const particleCount = 100;
  const particleGeometry = new THREE.SphereGeometry(0.05, 8, 8);
  const particleMaterials: THREE.MeshBasicMaterial[] = [];

  for (let i = 0; i < particleCount; i++) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(particleGeometry, material);
    mesh.position.set(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 5
    );
    particles.add(mesh);
    particleMaterials.push(material);
  }

  function initFeedback() {
    toy.rendererReady.then((handle) => {
      if (!handle) return;
      const renderer = handle.renderer as THREE.WebGLRenderer;
      feedback = new FeedbackManager({ renderer });

      warpMaterial = new THREE.ShaderMaterial({
        ...WarpShader,
        uniforms: THREE.UniformsUtils.clone(WarpShader.uniforms),
      });
      warpMaterial.uniforms.tDiffuse.value = feedback.texture;
      warpMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

      warpMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warpMaterial);
      overlayScene.add(warpMesh);
    });
  }

  function animate(ctx: AnimationContext) {
    const data = getContextFrequencyData(ctx);
    const time = ctx.time;

    // Multi-band analysis
    const energy = ctx.analyser ? ctx.analyser.getMultiBandEnergy() : { bass: 0, mid: 0, treble: 0 };
    const averages = ctx.analyser ? ctx.analyser.getEnergyAverages() : { bass: 0, mid: 0, treble: 0 };

    // Update particles based on audio
    particles.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const speed = 0.01 + energy.bass * 0.1;
      mesh.position.y -= speed;
      if (mesh.position.y < -5) mesh.position.y = 5;

      const scale = 1 + energy.mid * 2;
      mesh.scale.setScalar(scale);

      const hue = (i / particleCount + time * 0.1) % 1;
      (mesh.material as THREE.MeshBasicMaterial).color.setHSL(hue, 0.8, 0.5 + energy.treble * 0.5);
    });

    // Feedback and Warp
    if (feedback && warpMaterial && toy.renderer) {
      const renderer = toy.renderer as THREE.WebGLRenderer;

      // 1. Update warp uniforms
      warpMaterial.uniforms.uTime.value = time;
      warpMaterial.uniforms.uAudioIntensity.value = energy.bass;
      warpMaterial.uniforms.uZoom.value = 1.0 + Math.sin(time * 0.5) * 0.02;
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
      
      const writeTarget = (feedback as any).writeBuffer;
      renderer.setRenderTarget(writeTarget);
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
      ctx.toy.render();
    }
  }

  async function startAudio(request: ToyAudioRequest = false) {
    return startToyAudio(
      toy,
      animate,
      resolveToyAudioOptions(request, { fftSize: 512 }),
    );
  }

  // Initialize
  initFeedback();

  const settingsPanel = getSettingsPanel();
  settingsPanel.configure({
    title: 'MilkDrop Proto',
    description: 'A prototype of MilkDrop-style feedback engine.',
  });
  settingsPanel.setQualityPresets({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: 'medium',
    onChange: (preset) => {
      toy.updateRendererSettings({ renderScale: preset.renderScale });
    },
  });

  const unregisterGlobals = registerToyGlobals(container, startAudio);

  return {
    dispose: () => {
      toy.dispose();
      feedback?.dispose();
      particleGeometry.dispose();
      particleMaterials.forEach(m => m.dispose());
      warpMaterial?.dispose();
      warpMesh?.geometry.dispose();
      unregisterGlobals();
    },
  };
}
