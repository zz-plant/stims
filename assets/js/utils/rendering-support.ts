import WebGL from 'three/examples/jsm/capabilities/WebGL.js';

export type RenderingSupport = {
  hasWebGPU: boolean;
  hasWebGL: boolean;
};

export const getRenderingSupport = (): RenderingSupport => {
  const hasWebGPU = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
  const hasWebGL =
    typeof WebGL !== 'undefined' &&
    (WebGL as { isWebGLAvailable?: () => boolean }).isWebGLAvailable?.();

  return { hasWebGPU, hasWebGL: Boolean(hasWebGL) };
};
