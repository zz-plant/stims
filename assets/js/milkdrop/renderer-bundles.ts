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

import { BundleGroup, type Object3D } from 'three';

export type MilkdropRenderBundleConfig = {
  /** Whether RenderBundle recording is enabled. */
  enabled: boolean;
};

export const DEFAULT_RENDER_BUNDLE_CONFIG: MilkdropRenderBundleConfig = {
  enabled: false,
};

/**
 * Manages a Three.js BundleGroup for pre-recording static draw calls
 * as WebGPU RenderBundles. Objects added via `add()` are automatically
 * bundled by the Three.js WebGPURenderer when the BundleGroup is
 * added to the scene.
 */
export class MilkdropRenderBundleManager {
  private config: MilkdropRenderBundleConfig;
  private bundleGroup: BundleGroup | null = null;

  constructor(config: Partial<MilkdropRenderBundleConfig> = {}) {
    this.config = { ...DEFAULT_RENDER_BUNDLE_CONFIG, ...config };
  }

  /** Get the underlying BundleGroup (null if disabled). */
  getGroup(): BundleGroup | null {
    return this.bundleGroup;
  }

  /** Enable or disable RenderBundle support. Creates or destroys the BundleGroup. */
  setConfig(config: Partial<MilkdropRenderBundleConfig>) {
    const wasEnabled = this.config.enabled;
    const wasBundleGroup = this.bundleGroup !== null;
    this.config = { ...this.config, ...config };

    if (this.config.enabled && !wasBundleGroup) {
      this.bundleGroup = new BundleGroup();
    } else if (!this.config.enabled && wasBundleGroup) {
      this.bundleGroup = null;
    }
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

let sharedBundleManager: MilkdropRenderBundleManager | null = null;

/**
 * Get or create the shared MilkDrop render bundle manager.
 */
export function getMilkdropRenderBundleManager(
  config?: Partial<MilkdropRenderBundleConfig>,
): MilkdropRenderBundleManager {
  if (!sharedBundleManager) {
    sharedBundleManager = new MilkdropRenderBundleManager(config);
  } else if (config) {
    sharedBundleManager.setConfig(config);
  }
  return sharedBundleManager;
}

/**
 * Dispose the shared render bundle manager (for testing and cleanup).
 */
export function disposeMilkdropRenderBundleManager() {
  sharedBundleManager?.dispose();
  sharedBundleManager = null;
}
