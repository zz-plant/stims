import * as THREE from 'three';
import { initScene } from './scene-setup.ts';
import { initCamera } from './camera-setup.ts';
import {
  initRenderer,
  type RendererInitConfig,
  type RendererInitResult,
} from './renderer-setup.ts';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup';
import { initAudio } from '../utils/audio-handler.ts';
import { ensureWebGL } from '../utils/webgl-check.js';

export default class WebToy {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: RendererInitResult['renderer'] | null;
  rendererBackend: RendererInitResult['backend'] | null;
  rendererInfo: RendererInitResult | null;
  rendererReady: Promise<RendererInitResult | null>;
  rendererOptions: RendererInitConfig;
  analyser: THREE.AudioAnalyser | null;
  audioListener: THREE.AudioListener | null;
  audio: THREE.Audio | THREE.PositionalAudio | null;
  audioStream: MediaStream | null;
  audioCleanup: (() => void) | null;
  resizeHandler: (() => void) | null;

  constructor({
    cameraOptions = {},
    sceneOptions = {},
    rendererOptions = {},
    lightingOptions = null,
    ambientLightOptions = null,
    canvas = null,
  } = {}) {
    if (!ensureWebGL()) {
      throw new Error('WebGL not supported');
    }

    this.canvas = canvas || document.createElement('canvas');

    const host =
      document.getElementById('active-toy-container') || document.body;
    host.appendChild(this.canvas);

    this.scene = initScene(sceneOptions);
    this.camera = initCamera(cameraOptions);
    this.renderer = null;
    this.rendererBackend = null;
    this.rendererInfo = null;
    this.rendererOptions = rendererOptions;
    this.rendererReady = initRenderer(this.canvas, rendererOptions);
    this.rendererReady
      .then((result) => {
        this.rendererInfo = result;
        this.renderer = result?.renderer ?? null;
        this.rendererBackend = result?.backend ?? null;
        if (result) {
          this.rendererOptions = {
            ...this.rendererOptions,
            maxPixelRatio: result.maxPixelRatio,
            renderScale: result.renderScale,
            exposure: result.exposure,
          };
          this.applyRendererSettings();
        }
      })
      .catch((error) => {
        console.warn('Renderer initialization failed.', error);
      });

    if (ambientLightOptions) {
      initAmbientLight(this.scene, ambientLightOptions);
    }
    if (lightingOptions) {
      initLighting(this.scene, lightingOptions);
    }

    this.analyser = null;
    this.audioListener = null;
    this.audio = null;
    this.audioStream = null;
    this.audioCleanup = null;
    this.resizeHandler = () => this.handleResize();
    window.addEventListener('resize', this.resizeHandler);

    (globalThis as Record<string, unknown>).__activeWebToy = this;
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyRendererSettings();
  }

  applyRendererSettings() {
    if (!this.renderer) return;

    const maxPixelRatio = this.rendererOptions.maxPixelRatio ?? 2;
    const renderScale = this.rendererOptions.renderScale ?? 1;
    const exposure = this.rendererOptions.exposure ?? 1;

    const effectivePixelRatio = Math.min(
      (window.devicePixelRatio || 1) * renderScale,
      maxPixelRatio
    );

    this.renderer.setPixelRatio(effectivePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMappingExposure = exposure;

    if (this.rendererInfo) {
      this.rendererInfo.maxPixelRatio = maxPixelRatio;
      this.rendererInfo.renderScale = renderScale;
      this.rendererInfo.exposure = exposure;
    }
  }

  updateRendererSettings(options: Partial<RendererInitConfig>) {
    this.rendererOptions = { ...this.rendererOptions, ...options };
    this.applyRendererSettings();
  }

  async initAudio(options = {}) {
    if (this.audioCleanup) {
      this.audioCleanup();
      this.audioCleanup = null;
      this.analyser = null;
      this.audioListener = null;
      this.audio = null;
      this.audioStream = null;
    }

    const audio = await initAudio({ ...options, camera: this.camera });
    this.analyser = audio.analyser;
    this.audioListener = audio.listener;
    this.audio = audio.audio;
    this.audioStream = audio.stream ?? null;
    this.audioCleanup = audio.cleanup;
    return audio;
  }

  render() {
    this.renderer?.render(this.scene, this.camera);
  }

  dispose() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }

    if (this.renderer?.setAnimationLoop) {
      this.renderer.setAnimationLoop(null);
    }

    if (this.renderer?.dispose) {
      this.renderer.dispose();
    }

    if (this.scene) {
      this.scene.traverse((object: THREE.Object3D) => {
        const mesh = object as THREE.Mesh;
        if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((material) => material?.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        }
      });

      while (this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }
    }

    if (this.audioCleanup) {
      this.audioCleanup();
      this.audioCleanup = null;
      this.analyser = null;
      this.audioListener = null;
      this.audio = null;
      this.audioStream = null;
    }

    if (this.canvas?.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }

    if ((globalThis as Record<string, unknown>).__activeWebToy === this) {
      delete (globalThis as Record<string, unknown>).__activeWebToy;
    }
  }
}
