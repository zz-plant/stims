/**
 * One answer to "should this session speculatively download WebGPU bundles?",
 * shared by every WebGPU warm-ahead prefetch (renderer-bundles.ts's
 * BundleGroup ctor and renderer-helpers/webgpu-materials-prefetch.ts's
 * material toolkit).
 *
 * Both previously gated on `navigator.gpu !== undefined`, which answers the
 * wrong question: it asks whether the browser *can* do WebGPU, not whether
 * this session *will*. Chrome exposes navigator.gpu, so `?renderer=webgl`, a
 * preset pinned to WebGL, and every post-fallback reload still pulled the
 * 648KB (182KB gzipped) three/webgpu bundle they can never execute —
 * measured on a production build with the renderer explicitly pinned.
 *
 * These are pure optimizations: renderer-adapter-webgpu.ts statically imports
 * what it needs, so a WebGPU session stays correct even when every prefetch
 * here is skipped. That makes "skip when unsure" always the safe answer.
 */
import { shouldPreferWebGLForKnownCompatibilityGaps } from '../core/renderer-query-override.ts';

export function shouldPrefetchWebGpuModules(): boolean {
  if (
    typeof navigator === 'undefined' ||
    (navigator as { gpu?: unknown }).gpu === undefined
  ) {
    return false;
  }
  try {
    return !shouldPreferWebGLForKnownCompatibilityGaps();
  } catch {
    // Preference resolution reads URL params and storage; if any of that
    // throws, skip the speculative fetch rather than guess wrong.
    return false;
  }
}
