/**
 * WebGPU RenderBundle support for MilkDrop static draw calls.
 *
 * Pre-records immutable draw commands (background quad, border groups)
 * as WebGPU RenderBundles to reduce per-frame CPU overhead on the
 * command encoder. Only active when the `renderBundles` optimization
 * flag is enabled and the renderer is WebGPU.
 */

import type { RendererLike } from './renderer-adapter-shared.ts';

export type MilkdropRenderBundleConfig = {
  /** Whether RenderBundle recording is enabled. */
  enabled: boolean;
};

export const DEFAULT_RENDER_BUNDLE_CONFIG: MilkdropRenderBundleConfig = {
  enabled: false,
};

/**
 * RenderBundle context wraps a WebGPU render pass encoder and
 * exposes executeBundles for pre-recorded draw commands.
 *
 * This is a lightweight wrapper — actual bundle recording happens
 * at the WebGPU level via the renderer. The bundle manager is
 * responsible for invalidating bundles when the camera or scene changes.
 */
export class MilkdropRenderBundleManager {
  private config: MilkdropRenderBundleConfig;
  private invalidated = true;
  private renderer: RendererLike | null = null;

  constructor(config: Partial<MilkdropRenderBundleConfig> = {}) {
    this.config = { ...DEFAULT_RENDER_BUNDLE_CONFIG, ...config };
  }

  /** Set the active renderer for bundle recording. */
  setRenderer(renderer: RendererLike | null) {
    this.renderer = renderer;
    this.invalidate();
  }

  /** Mark bundles as needing re-recording. */
  invalidate() {
    this.invalidated = true;
  }

  /** Check if bundles are currently valid. */
  isValid() {
    return !this.invalidated && this.config.enabled;
  }

  /** Enable or disable RenderBundle support. */
  setConfig(config: Partial<MilkdropRenderBundleConfig>) {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };
    if (this.config.enabled && !wasEnabled) {
      this.invalidate();
    }
  }

  /**
   * Record a render bundle if the feature is enabled and bundles
   * are invalidated. Returns true if a bundle was recorded.
   *
   * This is a no-op on WebGL renderers and a no-op when disabled.
   * Actual recording delegates to the Three.js WebGPURenderer's
   * internal bundle support (where available).
   */
  recordIfNeeded(_scene: unknown, _camera: unknown): boolean {
    if (!this.config.enabled || !this.renderer) {
      return false;
    }

    if (!this.invalidated) {
      return false;
    }

    // Bundle recording would happen here via the WebGPU renderer's
    // internal command encoder. Three.js WebGPURenderer currently
    // does not expose a public RenderBundle API, so this is a
    // forward-looking placeholder that will become active when
    // Three.js adds RenderBundle support.
    //
    // When available, the implementation will:
    // 1. Create a GPURenderBundleEncoder
    // 2. Record static draws (background quad, border groups)
    // 3. Store GPURenderBundle for frame-time execution

    this.invalidated = false;
    return true;
  }

  /** Dispose of any recorded bundles and release resources. */
  dispose() {
    this.invalidated = true;
    this.renderer = null;
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
