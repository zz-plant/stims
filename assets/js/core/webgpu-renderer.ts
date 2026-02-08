// @ts-expect-error - 'three/webgpu' requires moduleResolution: "bundler" or "nodenext", but project uses "node".
import { WebGPURenderer } from 'three/webgpu';

export type WebGPURendererType = typeof WebGPURenderer;

export { WebGPURenderer };
