import type { Camera, Scene, WebGLRenderer } from 'three';
import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { RendererBackend } from './renderer-capabilities';

export type PostprocessingPipeline = {
  composer: EffectComposer;
  bloomPass?: UnrealBloomPass;
  render: () => void;
  updateSize: () => void;
  dispose: () => void;
};

export function isWebGLRenderer(renderer: unknown): renderer is WebGLRenderer {
  return (
    !!renderer &&
    typeof renderer === 'object' &&
    'capabilities' in renderer &&
    'extensions' in renderer
  );
}

export function supportsWebGLPostprocessing(
  backend: RendererBackend | null | undefined,
): boolean {
  return backend === 'webgl';
}

export function resolveWebGLRenderer(
  backend: RendererBackend | null | undefined,
  renderer: unknown,
): WebGLRenderer | null {
  if (!supportsWebGLPostprocessing(backend)) {
    return null;
  }
  return isWebGLRenderer(renderer) ? renderer : null;
}

export function createBloomComposer({
  renderer,
  scene,
  camera,
  bloomStrength,
  bloomRadius = 0.4,
  bloomThreshold = 0.85,
}: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  bloomStrength: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}): PostprocessingPipeline {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const size = renderer.getSize(new Vector2());
  const bloomPass = new UnrealBloomPass(
    new Vector2(size.x, size.y),
    bloomStrength,
    bloomRadius,
    bloomThreshold,
  );
  composer.addPass(bloomPass);

  const lastSize = size.clone();
  const sizeScratch = new Vector2();

  const updateSize = () => {
    renderer.getSize(sizeScratch);
    if (sizeScratch.x !== lastSize.x || sizeScratch.y !== lastSize.y) {
      composer.setSize(sizeScratch.x, sizeScratch.y);
      lastSize.copy(sizeScratch);
    }
  };

  return {
    composer,
    bloomPass,
    render: () => composer.render(),
    updateSize,
    dispose: () => composer.dispose(),
  };
}
