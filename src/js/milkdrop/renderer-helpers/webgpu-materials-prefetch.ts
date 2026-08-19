/**
 * Prefetch half of the WebGPU helper-material registry, split from
 * webgpu-materials-loader.ts to break a registration cycle: the materials
 * module imports the registry (to register itself at module scope), so the
 * dynamic import that WARMS that module cannot live in the registry too —
 * dependency-cruiser rightly flags registry -> materials -> registry.
 *
 * This is a pure warm-ahead optimization, never a correctness requirement:
 * renderer-adapter-webgpu.ts statically imports the materials module, so a
 * WebGPU session always gets the toolkit registered before any helper
 * material is constructed whether or not this prefetch ever runs.
 *
 * Imported for its side effect by the renderer adapter factory, which sits on
 * the engine-mount path for both backends.
 */

import { scheduleIdleTask } from '../../utils/browser/idle-task.ts';
import { shouldPrefetchWebGpuModules } from '../webgpu-prefetch-policy.ts';
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

if (shouldPrefetchWebGpuModules()) {
  // Real idle, not setTimeout(0). The factory imports this module during
  // engine mount, when the critical path is still busy — an immediate
  // dynamic import of a 648KB chunk competes for bandwidth with the work
  // the user is actually waiting on (and starved the backend capability
  // probe outright in constrained environments, observed as a silent WebGL
  // fallback under Playwright's Chromium). requestIdleCallback yields until
  // the browser is genuinely free; the timeout bounds the wait so the
  // warm-ahead still lands before a user opens anything WebGPU-specific.
  scheduleIdleTask(
    () => {
      void prefetchWebGpuHelperMaterials().catch(() => {});
    },
    { idleTimeout: 3000, fallbackDelay: 1200 },
  );
}
