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
import type { AudioHandle } from './services/audio-service.ts';
import type { RendererHandle } from './services/render-service.ts';
import { createToyAudioSession } from './toy-audio-session.ts';
import { defaultToyLifecycle } from './toy-lifecycle.ts';
import { createToyRendererSession } from './toy-renderer-session.ts';
import {
  createToyViewportSession,
  type ToyViewportState,
} from './toy-viewport-session.ts';

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
  viewportCssWidth: number;
  viewportCssHeight: number;
  resizeFrameId: number | null;
  private viewportSession: ReturnType<typeof createToyViewportSession> | null;
  private rendererSession: ReturnType<typeof createToyRendererSession>;
  private audioSession: ReturnType<typeof createToyAudioSession>;

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
    this.rendererSession = createToyRendererSession({
      host: this.container,
      canvas: this.canvas,
      options: rendererOptions,
      onReady: (handle) => {
        this.rendererHandle = handle;
        this.renderer = handle?.renderer ?? null;
        this.rendererBackend = handle?.backend ?? null;
        this.rendererInfo = handle?.info ?? null;
        this.canvas = handle?.canvas ?? this.canvas;
        if (handle) {
          this.applyRendererSettings();
        }
      },
    });
    this.rendererReady = this.rendererSession.ready;

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
    this.audioSession = createToyAudioSession({ camera: this.camera });
    this.resizeObserver = null;
    this.resizeHandler = null;
    this.viewportResizeHandler = null;
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;
    this.viewportCssWidth = window.innerWidth;
    this.viewportCssHeight = window.innerHeight;
    this.resizeFrameId = null;
    this.viewportSession = createToyViewportSession({
      container: this.container,
      onResize: (state) => this.handleViewportResize(state),
    });

    defaultToyLifecycle.adoptActiveToy(this);
  }

  scheduleResize() {
    this.viewportSession?.scheduleResize();
  }

  private handleViewportResize(state: ToyViewportState) {
    if (
      state.width === this.viewportWidth &&
      state.height === this.viewportHeight &&
      state.cssWidth === this.viewportCssWidth &&
      state.cssHeight === this.viewportCssHeight
    ) {
      return;
    }

    this.viewportWidth = state.width;
    this.viewportHeight = state.height;
    this.viewportCssWidth = state.cssWidth;
    this.viewportCssHeight = state.cssHeight;

    this.camera.aspect = state.width / state.height;
    this.camera.updateProjectionMatrix();
    this.rendererSession.setViewport(state);
    this.applyRendererSettings();
  }

  applyRendererSettings() {
    this.rendererSession.applySettings(this.rendererOptions, {
      width: this.viewportWidth,
      height: this.viewportHeight,
      cssWidth: this.viewportCssWidth,
      cssHeight: this.viewportCssHeight,
    });
  }

  updateRendererSettings(options: Partial<RendererInitConfig>) {
    this.rendererOptions = { ...this.rendererOptions, ...options };
    this.rendererSession.updateOptions(options);
  }

  async initAudio(options = {}) {
    const audio = await this.audioSession.initAudio(options);
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
    this.viewportSession?.dispose();
    this.viewportSession = null;

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

    this.audioSession.dispose();
    this.audioHandle = null;
    this.analyser = null;
    this.audioListener = null;
    this.audio = null;
    this.audioStream = null;

    this.rendererSession.dispose();
    this.rendererHandle = null;
    this.renderer = null;
    this.rendererInfo = null;
    this.rendererBackend = null;

    defaultToyLifecycle.unregisterActiveToy(this);
  }
}
