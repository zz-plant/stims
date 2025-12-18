import * as THREE from 'three';
import { initScene } from './scene-setup.ts';
import { initCamera } from './camera-setup.ts';
import { initRenderer } from './renderer-setup.ts';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup';
import { initAudio } from '../utils/audio-handler.ts';
import { ensureWebGL } from '../utils/webgl-check.ts';

export default class WebToy {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: ReturnType<typeof initRenderer>;
  analyser: THREE.AudioAnalyser | null;
  audioListener: THREE.AudioListener | null;
  audio: THREE.Audio | THREE.PositionalAudio | null;
  audioStream: MediaStream | null;
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
    this.renderer = initRenderer(this.canvas, rendererOptions);

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
    this.resizeHandler = () => this.handleResize();
    window.addEventListener('resize', this.resizeHandler);

    (globalThis as Record<string, unknown>).__activeWebToy = this;
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  async initAudio(options = {}) {
    const audio = await initAudio({ ...options, camera: this.camera });
    this.analyser = audio.analyser;
    this.audioListener = audio.listener;
    this.audio = audio.audio;
    this.audioStream = audio.stream ?? null;
    return audio;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
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

    if (this.audio) {
      if ('stop' in this.audio && typeof this.audio.stop === 'function') {
        this.audio.stop();
      }
      if (
        'disconnect' in this.audio &&
        typeof this.audio.disconnect === 'function'
      ) {
        this.audio.disconnect();
      }
    }

    if (this.audioListener && 'remove' in this.camera) {
      (
        this.camera as THREE.Camera & { remove?: (obj: THREE.Object3D) => void }
      ).remove(this.audioListener);
    }

    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
    }

    if (this.analyser?.analyser) {
      this.analyser.analyser.disconnect();
    }

    if (this.canvas?.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }

    if ((globalThis as Record<string, unknown>).__activeWebToy === this) {
      delete (globalThis as Record<string, unknown>).__activeWebToy;
    }
  }
}
