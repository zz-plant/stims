export class Vector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export class BaseLight {
  position = new Vector3();
  set castShadow(_value: boolean) {}
}

export class Camera {
  add(obj: unknown) {
    void obj;
  }
  remove(obj: unknown) {
    void obj;
  }
}

export class Object3D {
  add(obj: unknown) {
    void obj;
  }
  remove(obj: unknown) {
    void obj;
  }
}

export class DirectionalLight extends BaseLight {}
export class SpotLight extends BaseLight {}
export class HemisphereLight extends BaseLight {}
export class PointLight extends BaseLight {}
export class AmbientLight extends BaseLight {}
export class Light extends BaseLight {}

export class AudioListener {
  context = { close: () => {} };
  add(obj: unknown) {
    void obj;
  }
}

export class Audio {
  constructor(public listener: AudioListener) {}
  setMediaStreamSource(stream: unknown) {
    void stream;
  }
  stop() {}
  disconnect() {}
}

export class PositionalAudio extends Audio {}

export class AudioAnalyser {
  analyser = { disconnect: () => {} };
  frequencyBinCount: number;

  constructor(_audio: Audio | PositionalAudio, fftSize = 256) {
    this.frequencyBinCount = fftSize / 2;
  }

  getFrequencyData() {
    return new Uint8Array(this.frequencyBinCount);
  }
}

export class Scene {
  children: unknown[] = [];

  add(light: unknown) {
    this.children.push(light);
  }
}

export class WebGLRenderer {
  outputColorSpace: unknown = null;
  toneMapping: unknown = null;
  toneMappingExposure = 1;

  constructor() {}

  setPixelRatio() {}

  setSize() {}

  dispose() {}
}

export const SRGBColorSpace = 'srgb';
export const ACESFilmicToneMapping = 'aces';
