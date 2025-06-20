import { initScene } from './scene-setup.ts';
import { initCamera } from './camera-setup.ts';
import { initRenderer } from './renderer-setup.ts';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup';
import { initAudio } from '../utils/audio-handler.ts';

export default class WebToy {
  constructor({
    cameraOptions = {},
    sceneOptions = {},
    rendererOptions = {},
    lightingOptions = null,
    ambientLightOptions = null,
    canvas = null,
  } = {}) {
    this.canvas = canvas || document.createElement('canvas');
    document.body.appendChild(this.canvas);

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
    window.addEventListener('resize', () => this.handleResize());
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
    return audio;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
