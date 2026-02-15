import { Window } from 'happy-dom';

const windowInstance = new Window();

globalThis.window = windowInstance as unknown as Window &
  typeof globalThis.window;
globalThis.document = windowInstance.document as unknown as Document;
globalThis.navigator = windowInstance.navigator as unknown as Navigator;
globalThis.localStorage = windowInstance.localStorage;
globalThis.sessionStorage = windowInstance.sessionStorage;

// Align commonly used globals
globalThis.HTMLElement =
  windowInstance.HTMLElement as unknown as typeof HTMLElement;
globalThis.Event = windowInstance.Event as unknown as typeof Event;
globalThis.CustomEvent =
  windowInstance.CustomEvent as unknown as typeof CustomEvent;
globalThis.DOMParser = windowInstance.DOMParser as unknown as typeof DOMParser;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  // biome-ignore lint/suspicious/noExplicitAny: polyfill mismatch
  setTimeout(() => callback(Date.now()), 16) as any as number;
// biome-ignore lint/suspicious/noExplicitAny: polyfill mismatch
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id as any);

// WebGPU stubs for Three.js
const GPU_STAGE = {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
};
globalThis.GPUShaderStage = GPU_STAGE;
globalThis.GPUBufferUsage = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
  QUERY_RESOLVE: 512,
};
globalThis.GPUTextureUsage = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
  TRANSIENT_ATTACHMENT: 32,
  // Some WebGPU type versions include TRANSIENT_ATTACHMENT while others do not.
} as unknown as GPUTextureUsage;
globalThis.GPUMapMode = {
  READ: 1,
  WRITE: 2,
};
