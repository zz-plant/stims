import * as THREE from 'three';
import { initScene } from './core/scene-setup.ts';
import { initCamera } from './core/camera-setup.ts';
import { initRenderer } from './core/renderer-setup.ts';
import { setupMicrophonePermissionFlow } from './core/microphone-flow.ts';
import { ensureWebGL } from './utils/webgl-check.ts';
import { initLighting, initAmbientLight } from './lighting/lighting-setup';
import {
  createSyntheticAudioStream,
  initAudio,
  getFrequencyData,
} from './utils/audio-handler.ts';
import {
  applyAudioRotation,
  applyAudioScale,
} from './utils/animation-utils.ts';
import PatternRecognizer from './utils/patternRecognition.ts';

const DEFAULT_RENDERER_OPTIONS = { maxPixelRatio: 2 };

class VisualizationController {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.rendererBackend = null;
    this.cube = null;
    this.analyser = null;
    this.patternRecognizer = null;
    this.audioCleanup = null;
    this.syntheticCleanup = null;
    this.rendererReadyPromise = null;
    this.currentLightType = document.getElementById('light-type')?.value || 'PointLight';
    this.animationFrameId = null;
    this.isAnimating = false;
    this.audioListener = null;
    this.hasRequestedAudio = false;
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.isReducedMotionPreferred = this.prefersReducedMotion.matches;

    this.handleResize = this.handleResize.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleReducedMotionChange = this.handleReducedMotionChange.bind(this);
    this.handleLightChange = this.handleLightChange.bind(this);
    this.handlePageHide = this.handlePageHide.bind(this);
    this.animate = this.animate.bind(this);
  }

  init() {
    this.rendererReadyPromise = this.initVisualization();

    this.prefersReducedMotion.addEventListener('change', this.handleReducedMotionChange);
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHide);
    const lightTypeSelect = document.getElementById('light-type');
    lightTypeSelect?.addEventListener('change', this.handleLightChange);

    setupMicrophonePermissionFlow({
      startButton: document.getElementById('start-audio-btn'),
      fallbackButton: document.getElementById('use-sample-audio'),
      statusElement: document.getElementById('audio-status'),
      requestMicrophone: () => this.startAudioAndAnimation(false),
      requestSampleAudio: () => this.startAudioAndAnimation(true),
      analytics: {
        log: (event, detail) => console.info(`[audio-flow] ${event}`, detail ?? {}),
      },
      onSuccess: () => {
        const startButton = document.getElementById('start-audio-btn');
        if (startButton instanceof window.HTMLButtonElement) {
          startButton.style.display = 'none';
        }

        const fallbackButton = document.getElementById('use-sample-audio');
        if (fallbackButton instanceof window.HTMLButtonElement) {
          fallbackButton.hidden = true;
        }
      },
    });
  }

  async initVisualization() {
    if (!ensureWebGL()) {
      this.displayError('WebGL support is required to render this visual.');
      return null;
    }

    this.stopAnimationLoop();
    this.disposeScene();

    const canvas = document.getElementById('toy-canvas');
    if (!canvas) {
      this.displayError('Canvas element not found.');
      return null;
    }

    this.scene = initScene();
    this.camera = initCamera();

    const rendererResult = await initRenderer(canvas, DEFAULT_RENDERER_OPTIONS);
    if (!rendererResult) {
      this.displayError('Unable to initialize a renderer on this device.');
      return null;
    }

    this.renderer = rendererResult.renderer;
    this.rendererBackend = rendererResult.backend;
    console.info(`Using renderer backend: ${this.rendererBackend}`);

    initLighting(this.scene, {
      type: this.currentLightType,
      color: 0xffffff,
      intensity: 1,
      position: { x: 10, y: 10, z: 20 },
    });
    initAmbientLight(this.scene, { color: 0x404040, intensity: 0.5 });

    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    this.cube = new THREE.Mesh(geometry, material);
    this.scene.add(this.cube);

    this.renderSceneOnce();

    if (this.analyser && !this.isReducedMotionPreferred) {
      this.startAnimationLoop();
    }

    return this.renderer;
  }

  disposeScene() {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    if (this.scene) {
      this.scene.traverse((object) => {
        if (object.isMesh) {
          object.geometry?.dispose?.();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose?.());
          } else {
            object.material?.dispose?.();
          }
        }
      });

      while (this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }

      this.scene = null;
    }

    this.camera = null;
    this.cube = null;
    this.rendererBackend = null;
  }

  startAnimationLoop() {
    if (this.isAnimating || this.isReducedMotionPreferred) return;

    this.isAnimating = true;
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  stopAnimationLoop() {
    if (!this.isAnimating) return;

    this.isAnimating = false;
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  cleanupAudio() {
    if (this.audioCleanup) {
      this.audioCleanup();
    }
    if (this.syntheticCleanup) {
      this.syntheticCleanup();
    }

    this.audioCleanup = null;
    this.syntheticCleanup = null;
    this.analyser = null;
    this.patternRecognizer = null;
    this.audioListener = null;
  }

  async startAudioAndAnimation(useSampleAudio = false) {
    this.hasRequestedAudio = true;
    try {
      if (this.rendererReadyPromise) {
        await this.rendererReadyPromise;
      }
      if (!this.renderer) {
        throw new Error('Unable to start because no renderer is available.');
      }

      this.cleanupAudio();
      const syntheticStream = useSampleAudio ? createSyntheticAudioStream() : null;
      const audioData = await initAudio({ stream: syntheticStream?.stream });
      this.analyser = audioData.analyser;
      this.audioListener = audioData.listener ?? null;
      this.audioCleanup = () => audioData.cleanup();
      this.syntheticCleanup = syntheticStream?.cleanup ?? null;
      this.patternRecognizer = new PatternRecognizer(this.analyser);

      if (this.isReducedMotionPreferred) {
        this.renderSceneOnce();
      } else {
        this.startAnimationLoop();
      }
      return true;
    } catch (error) {
      console.error('initAudio failed:', error);
      this.syntheticCleanup?.();
      this.syntheticCleanup = null;
      throw error;
    }
  }

  animate() {
    if (!this.isAnimating) return;

    if (this.analyser && this.cube) {
      const audioData = getFrequencyData(this.analyser);

      if (!this.isReducedMotionPreferred) {
        applyAudioRotation(this.cube, audioData, 0.05);
        applyAudioScale(this.cube, audioData, 50);
      }

      this.patternRecognizer?.updatePatternBuffer();
      const detectedPattern = this.patternRecognizer?.detectPattern();

      if (detectedPattern) {
        this.cube.material.color.setHex(0xff0000); // Detected pattern color
      } else {
        this.cube.material.color.setHex(0x00ff00); // Normal color
      }
    }

    this.renderer?.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  handleResize() {
    if (!this.camera || !this.renderer) return;

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  renderSceneOnce() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  displayError(message) {
    const errorElement = document.getElementById('audio-status');
    if (!errorElement) return;

    errorElement.innerText = message;
    errorElement.dataset.variant = 'error';
    errorElement.hidden = !message;
  }

  handleLightChange(event) {
    this.currentLightType = event.target?.value || this.currentLightType;
    this.rendererReadyPromise = this.initVisualization();
  }

  async handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.stopAnimationLoop();

      if (this.audioListener?.context?.state === 'running') {
        try {
          await this.audioListener.context.suspend();
        } catch (error) {
          console.error('Error suspending audio context:', error);
        }
      } else {
        this.cleanupAudio();
      }

      return;
    }

    if (document.visibilityState === 'visible') {
      if (this.audioListener?.context?.state === 'suspended') {
        try {
          await this.audioListener.context.resume();
        } catch (error) {
          console.error('Error resuming audio context:', error);
        }
      } else if (this.hasRequestedAudio && !this.analyser) {
        try {
          await this.startAudioAndAnimation();
        } catch (error) {
          this.displayError(
            'Microphone access is required for the visualization to work. Please allow microphone access.',
          );
          console.error('Unable to restart audio after visibility change', error);
        }
      }

      if (this.analyser) {
        this.startAnimationLoop();
      }
    }
  }

  handleReducedMotionChange(event) {
    this.isReducedMotionPreferred = event.matches;

    if (this.isReducedMotionPreferred) {
      this.stopAnimationLoop();
      this.renderSceneOnce();
    } else if (this.analyser) {
      this.startAnimationLoop();
    }
  }

  handlePageHide() {
    this.cleanupAudio();
    this.stopAnimationLoop();
  }
}

const controller = new VisualizationController();
controller.init();
