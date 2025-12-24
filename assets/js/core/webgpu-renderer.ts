import type { WebGPURenderer as ExamplesWebGPURenderer } from 'three/examples/jsm/renderers/webgpu/WebGPURenderer.js';

export type WebGPURendererType = ExamplesWebGPURenderer;

let WebGPURenderer: typeof import('three/src/renderers/webgpu/WebGPURenderer.js').default;

try {
  const module = await import('three/examples/jsm/renderers/webgpu/WebGPURenderer.js');
  WebGPURenderer = module.WebGPURenderer ?? (module.default as typeof WebGPURenderer);
} catch {
  const module = await import('three/src/renderers/webgpu/WebGPURenderer.js');
  WebGPURenderer = module.WebGPURenderer ?? (module.default as typeof WebGPURenderer);
}

export { WebGPURenderer };
