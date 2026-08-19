/**
 * WebGPU RenderBundle support for MilkDrop static draw calls.
 *
 * Uses Three.js `BundleGroup` (available since r169) to automatically
 * record static geometry draws as WebGPU RenderBundles. Objects added
 * to the BundleGroup are bundled by the renderer, reducing per-frame
 * CPU overhead on the command encoder.
 *
 * Only active when the `renderBundles` optimization flag is enabled
 * and the renderer is WebGPU.
 */

import type { Object3D } from 'three';
import { recordRendererOptimizationTelemetry } from '../core/renderer-capabilities.ts';
import { scheduleIdleTask } from '../utils/browser/idle-task.ts';
import { shouldPrefetchWebGpuModules } from './webgpu-prefetch-policy.ts';

type BundleGroupLike = Object3D & {
  needsUpdate: boolean;
  clear(): void;
};

type BundleGroupConstructor = new () => BundleGroupLike;

export type MilkdropRenderBundleConfig = {
  /** Whether RenderBundle recording is enabled. */
  enabled: boolean;
};

const DEFAULT_RENDER_BUNDLE_CONFIG: MilkdropRenderBundleConfig = {
  enabled: false,
};

// Lazy-loaded: a static `import 'three/webgpu'` here pulled the whole WebGPU
// three.js bundle (600KB+) into the shared adapter-core chunk, which sits on
// the boot path for WebGL-only browsers (Firefox, default Safari) that never
// use it. The constructor is fetched on demand, and pre-fetched on
// WebGPU-capable browsers so the WebGPU adapter can still build its
// BundleGroup synchronously during construction.
let webGpuBundleGroupCtor: BundleGroupConstructor | null = null;
let webGpuBundleGroupCtorPromise: Promise<BundleGroupConstructor> | null = null;

function loadWebGpuBundleGroupCtor(): Promise<BundleGroupConstructor> {
  if (!webGpuBundleGroupCtorPromise) {
    // @ts-expect-error - 'three/webgpu' resolves at runtime via the bundler but not under moduleResolution: "node".
    webGpuBundleGroupCtorPromise = import('three/webgpu')
      .then((module: { BundleGroup: BundleGroupConstructor }) => {
        webGpuBundleGroupCtor = module.BundleGroup;
        return module.BundleGroup;
      })
      .catch((error) => {
        webGpuBundleGroupCtor = null;
        webGpuBundleGroupCtorPromise = null;
        throw error;
      });
  }
  return webGpuBundleGroupCtorPromise;
}

// Pre-fetch so the ctor is resolved by the time the WebGPU adapter
// constructs (construction waits on the renderer, which imports the same
// module).
//
// Gated on the backend the app actually chose, not on `navigator.gpu`
// alone: capability answers "can this browser do WebGPU", not "will this
// session use it". Chrome exposes navigator.gpu, so `?renderer=webgl`, a
// preset pinned to WebGL, and post-fallback reloads all still pulled the
// whole 648KB three/webgpu bundle they can never execute — measured on a
// production build with the renderer explicitly pinned to WebGL.
//
// Scheduled at real idle rather than immediately: this module is evaluated
// during engine mount, when the critical path is still busy, and a 648KB
// dynamic import there competes for bandwidth with the visuals the user is
// waiting on.
if (shouldPrefetchWebGpuModules()) {
  scheduleIdleTask(
    () => {
      void loadWebGpuBundleGroupCtor().catch(() => {});
    },
    { idleTimeout: 3000, fallbackDelay: 1200 },
  );
}

/**
 * Manages a Three.js BundleGroup for pre-recording static draw calls
 * as WebGPU RenderBundles. Objects added via `add()` are automatically
 * bundled by the Three.js WebGPURenderer when the BundleGroup is
 * added to the scene.
 */
class MilkdropRenderBundleManager {
  private config: MilkdropRenderBundleConfig;
  private bundleGroup: BundleGroupLike | null = null;

  constructor(config: Partial<MilkdropRenderBundleConfig> = {}) {
    this.config = { ...DEFAULT_RENDER_BUNDLE_CONFIG, ...config };
  }

  /** Get the underlying BundleGroup (null if disabled). */
  getGroup(): BundleGroupLike | null {
    return this.bundleGroup;
  }

  /** Enable or disable RenderBundle support. Creates or destroys the BundleGroup. */
  setConfig(config: Partial<MilkdropRenderBundleConfig>) {
    const hadGroup = this.bundleGroup !== null;
    this.config = { ...this.config, ...config };

    if (this.config.enabled && !hadGroup) {
      recordRendererOptimizationTelemetry({ counter: 'renderBundlesUsage' });
      this.enableBundleGroup();
    } else if (!this.config.enabled && hadGroup) {
      this.bundleGroup = null;
    }
  }

  private enableBundleGroup() {
    const ctor = webGpuBundleGroupCtor;
    if (ctor) {
      this.createBundleGroup(ctor);
      return;
    }
    void loadWebGpuBundleGroupCtor()
      .then((loadedCtor) => {
        if (this.config.enabled) {
          this.createBundleGroup(loadedCtor);
        }
      })
      .catch(() => {
        recordRendererOptimizationTelemetry({
          counter: 'renderBundleUnavailable',
        });
      });
  }

  private createBundleGroup(ctor: BundleGroupConstructor) {
    this.bundleGroup = new ctor() as BundleGroupLike;
    this.bundleGroup.userData.stimsBundleKind = 'milkdrop-static';
  }

  /** Add a static object to the BundleGroup for bundled rendering. */
  add(object: Object3D): boolean {
    if (!this.config.enabled || !this.bundleGroup) return false;
    this.bundleGroup.add(object);
    return true;
  }

  /** Remove an object from the BundleGroup. */
  remove(object: Object3D): boolean {
    if (!this.config.enabled || !this.bundleGroup) return false;
    this.bundleGroup.remove(object);
    return true;
  }

  /** Clear all objects from the BundleGroup. */
  clear() {
    this.bundleGroup?.clear();
  }

  /** Mark the bundle as needing re-recording (updates `needsUpdate`). */
  invalidate() {
    if (this.bundleGroup) {
      this.bundleGroup.needsUpdate = true;
    }
  }

  /** Dispose of the BundleGroup. */
  dispose() {
    this.bundleGroup?.clear();
    this.bundleGroup = null;
  }
}

export function createMilkdropStaticBundleGroup({
  enabled,
  objects,
}: {
  enabled: boolean;
  objects: Object3D[];
}): Object3D | null {
  if (!enabled) {
    return null;
  }

  const manager = new MilkdropRenderBundleManager({ enabled: true });
  manager.setConfig({ enabled: true });
  const group = manager.getGroup();
  if (!group) {
    recordRendererOptimizationTelemetry({ counter: 'renderBundleUnavailable' });
    return null;
  }

  for (const object of objects) {
    manager.add(object);
  }
  return group;
}
