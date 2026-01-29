export class WebGPURenderer {
  outputColorSpace = '';
  toneMapping = 0;
  toneMappingExposure = 1;

  constructor(options: unknown = {}) {
    void options;
  }

  setPixelRatio(ratio: number) {
    void ratio;
  }

  setSize(width: number, height: number) {
    void width;
    void height;
  }

  setAnimationLoop(callback: (() => void) | null) {
    void callback;
  }

  dispose() {}
}
