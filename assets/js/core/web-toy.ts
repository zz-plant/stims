import {
  type AudioListener,
  Mesh,
  type Object3D,
  type PerspectiveCamera,
  type PositionalAudio,
  type Scene,
  type Audio as ThreeAudio,
} from 'three';
import type {
  AmbientLightConfig,
  LightConfig,
} from '../lighting/lighting-setup';
import { initAmbientLight, initLighting } from '../lighting/lighting-setup';
import type { FrequencyAnalyser } from '../utils/audio-handler';
import { ensureWebGL } from '../utils/webgl-check';
import { initCamera } from './camera-setup.ts';
import type { RendererInitConfig } from './renderer-setup.ts';
import { initScene, type SceneConfig } from './scene-setup.ts';
import {
  type AudioHandle,
  acquireAudioHandle,
} from './services/audio-service.ts';
import {
  type RendererHandle,
  requestRenderer,
} from './services/render-service.ts';
import { defaultToyLifecycle } from './toy-lifecycle.ts';

type CameraOptions = NonNullable<Parameters<typeof initCamera>[0]>;
type SceneOptions = SceneConfig & Record<string, unknown>;

export type WebToyOptions = {
  cameraOptions?: CameraOptions;
  sceneOptions?: SceneOptions;
  rendererOptions?: Partial<RendererInitConfig>;
  lightingOptions?: LightConfig | null;
  ambientLightOptions?: AmbientLightConfig | null;
  canvas?: HTMLCanvasElement | null;
  container?: HTMLElement | null;
};

export default class WebToy {
  container: HTMLElement | null;
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: RendererHandle['renderer'] | null;
  rendererBackend: RendererHandle['backend'] | null;
  rendererInfo: RendererHandle['info'] | null;
  rendererReady: Promise<RendererHandle | null>;
  rendererOptions: Partial<RendererInitConfig>;
  analyser: FrequencyAnalyser | null;
  audioListener: AudioListener | null;
  audio: ThreeAudio | PositionalAudio | null;
  audioStream: MediaStream | null;
  audioHandle: AudioHandle | null;
  audioCleanup: (() => void) | null;
  resizeObserver: ResizeObserver | null;
  resizeHandler: (() => void) | null;
  rendererHandle: RendererHandle | null;
  viewportResizeHandler: (() => void) | null;
  viewportWidth: number;
  viewportHeight: number;

  constructor({
    cameraOptions = {},
    sceneOptions = {},
    rendererOptions = {},
    lightingOptions = null,
    ambientLightOptions = null,
    canvas = null,
    container = null,
  }: WebToyOptions = {}) {
    if (!ensureWebGL()) {
      throw new Error('WebGL not supported');
    }

    this.container =
      container ||
      document.getElementById('active-toy-container') ||
      document.body;
    this.canvas = canvas || document.createElement('canvas');

    this.scene = initScene(sceneOptions);
    this.camera = initCamera(cameraOptions);
    this.renderer = null;
    this.rendererBackend = null;
    this.rendererInfo = null;
    this.rendererHandle = null;
    this.rendererOptions = rendererOptions;

    this.rendererReady = requestRenderer({
      host: this.container,
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
        this.handleResize();
        return handle;
      })
      .catch((error) => {
        console.warn('Renderer initialization failed.', error);
        return null;
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
    this.audioHandle = null;
    this.audioCleanup = null;
    this.resizeObserver = null;
    this.resizeHandler = null;
    this.viewportResizeHandler = null;
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;

    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    } else {
      this.resizeHandler = () => this.handleResize();
      window.addEventListener('resize', this.resizeHandler);
    }

    if (window.visualViewport) {
      this.viewportResizeHandler = () => this.handleResize();
      window.visualViewport.addEventListener(
        'resize',
        this.viewportResizeHandler,
      );
      window.visualViewport.addEventListener(
        'scroll',
        this.viewportResizeHandler,
      );
    }

    defaultToyLifecycle.adoptActiveToy(this);
  }

  handleResize() {
    const visualViewport = window.visualViewport;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    let width = viewportWidth;
    let height = viewportHeight;

    if (this.container && this.container !== document.body) {
      width = this.container.clientWidth;
      height = this.container.clientHeight;
    }

    document.documentElement.style.setProperty(
      '--app-height',
      `${viewportHeight}px`,
    );
    document.documentElement.style.setProperty(
      '--app-width',
      `${viewportWidth}px`,
    );

    this.viewportWidth = width;
    this.viewportHeight = height;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyRendererSettings();
  }

  applyRendererSettings() {
    if (!this.renderer) return;

    this.rendererHandle?.applySettings(this.rendererOptions, {
      width: this.viewportWidth,
      height: this.viewportHeight,
    });
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
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.viewportResizeHandler && window.visualViewport) {
      window.visualViewport.removeEventListener(
        'resize',
        this.viewportResizeHandler,
      );
      window.visualViewport.removeEventListener(
        'scroll',
        this.viewportResizeHandler,
      );
      this.viewportResizeHandler = null;
    }

    this.renderer?.setAnimationLoop?.(null);

    if (this.scene) {
      this.scene.traverse((object: Object3D) => {
        if (object instanceof Mesh) {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((material) => material?.dispose());
            } else {
              object.material.dispose();
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
