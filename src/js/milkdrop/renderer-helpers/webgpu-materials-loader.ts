/**
 * Lazy accessor for the WebGPU material toolkit the shared renderer helpers
 * use: `NodeMaterial` + `TSL` from 'three/webgpu' and the procedural material
 * factories from renderer-backends/webgpu-procedural-materials.ts.
 *
 * The shared helpers (shape/mesh/particle-field/procedural-wave/motion-vector
 * renderers) run on BOTH backends but previously imported 'three/webgpu'
 * statically, which pulled the whole WebGPU three.js bundle (600KB+) into the
 * boot-path adapter chunk for WebGL-only browsers (Firefox, default Safari)
 * that can never execute it — the same leak renderer-bundles.ts fixed for
 * BundleGroup.
 *
 * Registration keeps the helpers' synchronous material-construction contract
 * intact with no async gap: webgpu-procedural-materials.ts (which statically
 * imports 'three/webgpu' and now lives only in the lazily-loaded WebGPU
 * adapter graph) calls `registerWebGpuHelperMaterials()` at module scope, and
 * the WebGPU adapter statically imports that module, so the toolkit is
 * registered before the adapter can construct any helper material. A prefetch
 * on WebGPU-capable browsers additionally warms the chunk; browsers without
 * WebGPU never fetch it.
 */

import type { NodeMaterial, TSL } from 'three/webgpu';
import type {
  createProceduralCustomWaveMaterial,
  createProceduralMeshMaterial,
  createProceduralMotionVectorMaterial,
  createProceduralWaveMaterial,
} from '../renderer-backends/webgpu-procedural-materials';

export type WebGpuHelperMaterials = {
  NodeMaterial: typeof NodeMaterial;
  TSL: typeof TSL;
  createProceduralMeshMaterial: typeof createProceduralMeshMaterial;
  createProceduralMotionVectorMaterial: typeof createProceduralMotionVectorMaterial;
  createProceduralWaveMaterial: typeof createProceduralWaveMaterial;
  createProceduralCustomWaveMaterial: typeof createProceduralCustomWaveMaterial;
};

let registeredMaterials: WebGpuHelperMaterials | null = null;

/**
 * Called at module scope by webgpu-procedural-materials.ts so any graph that
 * loads the WebGPU adapter (or that module directly, e.g. unit tests) has the
 * toolkit synchronously available.
 */
export function registerWebGpuHelperMaterials(
  materials: WebGpuHelperMaterials,
): void {
  registeredMaterials = materials;
}

/**
 * Synchronous accessor for the WebGPU-only material creation branches of the
 * shared helpers. Those branches only execute under the WebGPU adapter, whose
 * module graph registers the toolkit before adapter construction.
 */
export function getWebGpuHelperMaterialsSync(): WebGpuHelperMaterials {
  if (!registeredMaterials) {
    throw new Error(
      '[Stims] WebGPU helper materials are not loaded; the WebGPU adapter registers them before any WebGPU material is constructed.',
    );
  }
  return registeredMaterials;
}

/**
 * `value instanceof NodeMaterial` without forcing 'three/webgpu' into the
 * shared chunk. When the toolkit has not loaded, no NodeMaterial can exist,
 * so the answer is false.
 */
/**
 * Type predicate, not a bare boolean: callers immediately reach for
 * `.userData` on the narrowed value, and `material` on a three Object3D is
 * `Material | Material[]`. Returning `boolean` left that union intact, so
 * every guarded access was unchecked — which went unnoticed while this whole
 * layer was untyped.
 */
export function isWebGpuNodeMaterial(
  value: unknown,
): value is InstanceType<typeof NodeMaterial> {
  return registeredMaterials
    ? value instanceof registeredMaterials.NodeMaterial
    : false;
}
