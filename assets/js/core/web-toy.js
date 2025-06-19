import { initScene } from './scene-setup.js';
import { initCamera } from './camera-setup.js';
import { initRenderer } from './renderer-setup.js';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup.js';
import { initAudio } from '../utils/audio-handler.js';

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
    window.addEventListener('resize', () => this.handleResize());
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  async initAudio(options = {}) {
    const audio = await initAudio(options);
    this.analyser = audio.analyser;
    return audio;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
