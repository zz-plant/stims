/**
 * Prefetch half of the WebGPU helper-material registry, split from
 * webgpu-materials-loader.ts to break a registration cycle: the materials
 * module imports the registry (to register itself at module scope), so the
 * dynamic import that WARMS that module cannot live in the registry too —
 * dependency-cruiser rightly flags registry -> materials -> registry.
 *
 * Imported for its side effect by the renderer adapter factory, which is on
 * the engine-mount path for both backends: WebGPU-capable browsers warm the
 * chunk before the WebGPU adapter needs it; browsers without WebGPU never
 * fetch the bytes (mirrors renderer-bundles.ts).
 */
import {
  getWebGpuHelperMaterialsSync,
  type WebGpuHelperMaterials,
} from './webgpu-materials-loader';

/** Load (and register, via its module-scope call) the WebGPU material toolkit. */
export function prefetchWebGpuHelperMaterials(): Promise<WebGpuHelperMaterials> {
  return import('../renderer-backends/webgpu-procedural-materials').then(() =>
    getWebGpuHelperMaterialsSync(),
  );
}

if (
  typeof navigator !== 'undefined' &&
  (navigator as { gpu?: unknown }).gpu !== undefined
) {
  // Deferred a tick rather than fired at module evaluation: the factory
  // imports this module before running its own backend capability probe,
  // and kicking a large dynamic-import at that exact moment starved the
  // probe in constrained environments (observed as a silent WebGL fallback
  // under Playwright's Chromium while real Chrome was unaffected). A
  // microtask-later start keeps the prefetch comfortably ahead of any
  // adapter construction without contending with the probe.
  void Promise.resolve().then(() => {
    setTimeout(() => {
      void prefetchWebGpuHelperMaterials().catch(() => {});
    }, 0);
  });
}
