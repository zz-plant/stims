import * as THREE from 'three';
import { initScene, type SceneConfig } from './scene-setup.ts';
import { initCamera } from './camera-setup.ts';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup';
import {
  requestRenderer,
  type RendererHandle,
} from './services/render-service.ts';
import {
  acquireAudioHandle,
  type AudioHandle,
} from './services/audio-service.ts';
import type { RendererInitConfig } from './renderer-setup.ts';
import { ensureWebGL } from '../utils/webgl-check.ts';
import { defaultToyLifecycle } from './toy-lifecycle.ts';
import type { FrequencyAnalyser } from '../utils/audio-handler.ts';
import type {
  AmbientLightConfig,
  LightConfig,
} from '../lighting/lighting-setup';

type CameraOptions = NonNullable<Parameters<typeof initCamera>[0]>;
type SceneOptions = SceneConfig & Record<string, unknown>;

export type WebToyOptions = {
  cameraOptions?: CameraOptions;
  sceneOptions?: SceneOptions;
  rendererOptions?: Partial<RendererInitConfig>;
  lightingOptions?: LightConfig | null;
  ambientLightOptions?: AmbientLightConfig | null;
  canvas?: HTMLCanvasElement | null;
};

export default class WebToy {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: RendererHandle['renderer'] | null;
  rendererBackend: RendererHandle['backend'] | null;
  rendererInfo: RendererHandle['info'] | null;
  rendererReady: Promise<RendererHandle | null>;
  rendererOptions: Partial<RendererInitConfig>;
  analyser: FrequencyAnalyser | null;
  audioListener: THREE.AudioListener | null;
  audio: THREE.Audio | THREE.PositionalAudio | null;
  audioStream: MediaStream | null;
  audioHandle: AudioHandle | null;
  audioCleanup: (() => void) | null;
  resizeHandler: (() => void) | null;
  rendererHandle: RendererHandle | null;

  constructor({
    cameraOptions = {},
    sceneOptions = {},
    rendererOptions = {},
    lightingOptions = null,
    ambientLightOptions = null,
    canvas = null,
  }: WebToyOptions = {}) {
    if (!ensureWebGL()) {
      throw new Error('WebGL not supported');
    }

    const host =
      document.getElementById('active-toy-container') || document.body;
    this.canvas = canvas || document.createElement('canvas');

    this.scene = initScene(sceneOptions);
    this.camera = initCamera(cameraOptions);
    this.renderer = null;
    this.rendererBackend = null;
    this.rendererInfo = null;
    this.rendererHandle = null;
    this.rendererOptions = rendererOptions;
    this.rendererReady = requestRenderer({
      host,
      options: rendererOptions,
      canvas: this.canvas,
    })
      .then((handle) => {
        this.rendererHandle = handle;
        this.renderer = handle?.renderer ?? null;
        this.rendererBackend = handle?.backend ?? null;
        this.rendererInfo = handle?.info ?? null;
        this.canvas = handle?.canvas ?? this.canvas;
        this.applyRendererSettings();
        return handle;
      })
      .catch((error) => {
        console.warn('Renderer initialization failed.', error);
        return null;
      });

    if (ambientLightOptions) {
      initAmbientLight(this.scene, ambientLightOptions, THREE);
    }
    if (lightingOptions) {
      initLighting(this.scene, lightingOptions, THREE);
    }

    this.analyser = null;
    this.audioListener = null;
    this.audio = null;
    this.audioStream = null;
    this.audioHandle = null;
    this.audioCleanup = null;
    this.resizeHandler = () => this.handleResize();
    window.addEventListener('resize', this.resizeHandler);

    defaultToyLifecycle.adoptActiveToy(this);
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyRendererSettings();
  }

  applyRendererSettings() {
    if (!this.renderer) return;

    this.rendererHandle?.applySettings(this.rendererOptions);
  }

  updateRendererSettings(options: Partial<RendererInitConfig>) {
    this.rendererOptions = { ...this.rendererOptions, ...options };
    this.applyRendererSettings();
  }

  async initAudio(options = {}) {
    this.audioHandle?.release?.();
    this.audioHandle = null;
    this.analyser = null;
    this.audioListener = null;
    this.audio = null;
    this.audioStream = null;

    const audio = await acquireAudioHandle({ ...options, camera: this.camera });
    this.audioHandle = audio;
    this.analyser = audio.analyser;
    this.audioListener = audio.listener;
    this.audio = audio.audio;
    this.audioStream = audio.stream ?? null;
    return audio;
  }

  render() {
    this.renderer?.render(this.scene, this.camera);
  }

  dispose() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }

    this.renderer?.setAnimationLoop?.(null);

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

    if (this.audioHandle) {
      this.audioHandle.release();
      this.audioHandle = null;
      this.analyser = null;
      this.audioListener = null;
      this.audio = null;
      this.audioStream = null;
    }

    this.rendererHandle?.release();
    this.rendererHandle = null;
    this.renderer = null;
    this.rendererInfo = null;
    this.rendererBackend = null;

    defaultToyLifecycle.unregisterActiveToy(this);
  }
}
