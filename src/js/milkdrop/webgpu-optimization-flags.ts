import {
  getRequestedCorpus,
  getRequestedRenderer,
  getWebGpuFlagParams,
} from '../core/url-params.ts';
import type {
  MilkdropGpuDescriptorRouting,
  MilkdropWebGpuDescriptorPlan,
} from './types';
import {
  type MilkdropWebGpuFeatureRouting,
  resolveMilkdropWebGpuFeatureRouting,
  shouldUseSafeMilkdropWebGpuPath,
} from './webgpu-query-override.ts';

export const MILKDROP_WEBGPU_OPTIMIZATION_SEARCH_PARAMS = {
  proceduralMainWave: 'milkdrop-webgpu-main-wave',
  proceduralTrailWaves: 'milkdrop-webgpu-trail-waves',
  proceduralCustomWaves: 'milkdrop-webgpu-custom-waves',
  proceduralMesh: 'milkdrop-webgpu-mesh',
  proceduralMotionVectors: 'milkdrop-webgpu-motion-vectors',
  directFeedbackShaders: 'milkdrop-webgpu-feedback',
  descriptorFallbackToWebgl: 'milkdrop-webgpu-fallback',
  gpuComputeVM: 'milkdrop-webgpu-compute-vm',
  renderBundles: 'milkdrop-webgpu-render-bundles',
  shaderBranchDesugar: 'milkdrop-webgpu-branch-desugar',
} as const;

export const MILKDROP_WEBGPU_OPTIMIZATION_STORAGE_KEYS = {
  proceduralMainWave: 'stims:experiments:milkdrop-webgpu-main-wave',
  proceduralTrailWaves: 'stims:experiments:milkdrop-webgpu-trail-waves',
  proceduralCustomWaves: 'stims:experiments:milkdrop-webgpu-custom-waves',
  proceduralMesh: 'stims:experiments:milkdrop-webgpu-mesh',
  proceduralMotionVectors: 'stims:experiments:milkdrop-webgpu-motion-vectors',
  directFeedbackShaders: 'stims:experiments:milkdrop-webgpu-feedback',
  descriptorFallbackToWebgl: 'stims:experiments:milkdrop-webgpu-fallback',
  gpuComputeVM: 'stims:experiments:milkdrop-webgpu-compute-vm',
  renderBundles: 'stims:experiments:milkdrop-webgpu-render-bundles',
  shaderBranchDesugar: 'stims:experiments:milkdrop-webgpu-branch-desugar',
} as const;

export type MilkdropWebGpuOptimizationFlags = {
  proceduralMainWave: boolean;
  proceduralTrailWaves: boolean;
  proceduralCustomWaves: boolean;
  proceduralMesh: boolean;
  proceduralMotionVectors: boolean;
  directFeedbackShaders: boolean;
  descriptorFallbackToWebgl: boolean;
  gpuComputeVM: boolean;
  renderBundles: boolean;
  shaderBranchDesugar: boolean;
};

export type MilkdropWebGpuOptimizationFlagName =
  keyof MilkdropWebGpuOptimizationFlags;

// descriptorFallbackToWebgl now defaults to false: every ShaderMaterial-based
// rendering path a WebGPU session can reach has been ported to three.js's
// NodeMaterial/TSL system (WebGPURenderer's NodeBuilder rejects plain
// ShaderMaterial) — wave, mesh, motion-vector, and custom-wave procedural
// materials in webgpu-procedural-materials.ts, the particle field in
// particle-field-renderer.ts, and the shape fill in shape-renderer.ts.
// Feedback/post-effect presets therefore stay on WebGPU and run through the
// native TSL feedback manager instead of reloading into WebGL. Presets whose
// plan carries genuine `unsupported` markers are the one exception: WebGL
// still renders those features, so resolveRouting keeps them on the WebGL
// fallback regardless of this flag.
export const DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS = Object.freeze({
  proceduralMainWave: true,
  proceduralTrailWaves: true,
  proceduralCustomWaves: true,
  proceduralMesh: true,
  proceduralMotionVectors: true,
  directFeedbackShaders: true,
  descriptorFallbackToWebgl: false,
  // Measured OFF. The compute VM runs a preset's per_frame block as a
  // single-workgroup dispatch, but vm.ts stepAsync needs the resulting state
  // back on the CPU to build geometry, so every frame pays upload + dispatch
  // + readback. Against the CPU JIT on the same blocks
  // (`bun run lab:vm-tier-bench`, 2026-08-22):
  //
  //     per_frame stmts     CPU JIT     compute VM     ratio
  //          13              0.05us        0.9ms      18000x
  //          49              0.25us        1.1ms       4400x
  //         111              0.75us        0.9ms       1200x
  //          21 (megabuf)    0.10us        8.0ms      80000x
  //
  // (An earlier run of that harness reported CPU as 0.000us because it fed
  // whole source lines to the statement parser, where a trailing ';' is a
  // parse error -- it was timing an empty program. The harness now splits
  // statements the way the compiler does and prints src/compiled counts so
  // an empty program cannot masquerade as a fast one. The conclusion did not
  // change; the ratios did.)
  //
  // The cost is CPU/GPU sync latency, not compute, so no amount of readback
  // tuning closes it -- one workgroup of scalar math cannot use the GPU at
  // all. The flag and its code stay because the PER-VERTEX story is the
  // opposite: the same harness puts a per_pixel block over MilkDrop's 48x36
  // mesh at 0.38-1.34ms of CPU per frame, and the gpu-field path evaluates
  // that fused into the render shader with no dispatch or readback at all.
  // Thousands of invocations is where the GPU wins; one is where it cannot.
  // Opt in with ?milkdrop-webgpu-compute-vm=1.
  gpuComputeVM: false,
  renderBundles: false,
  // Measured OFF (2026-08-22). Flattening `if`/`else` into masked assignments
  // and unrolling bounded `for` loops moves ~150 shader bodies off the
  // uniform-only approximation and onto direct WebGPU execution. The rewrite
  // itself is sound — see the module docstring in
  // compiler/shader-branch-desugar.ts — but it hands those bodies to the
  // WebGPU node executor for the first time, and the executor still has gaps.
  // The worst of them is closed: flexi-lorenz-chaser-...-discombobule-lose
  // killed the GPU process with no WebGPU error emitted, because every
  // texture read in a directly executed body went through the aux sampler's
  // runtime slot-select chain, which TSL inlines at each call site. Six reads
  // became 451 `textureSample` calls and 367 KB of WGSL, and Dawn's shader
  // compiler died on it. What is left is wrong pixels on a handful of presets
  // (six named in that docstring), not a crash, so this stays off until those
  // are closed rather than because anything is unsafe.
  // Opt in with ?milkdrop-webgpu-branch-desugar=1.
  shaderBranchDesugar: false,
}) satisfies MilkdropWebGpuOptimizationFlags;

export function applyNativeWebGpuMaterialCompatibilityFlags(
  flags: MilkdropWebGpuOptimizationFlags,
  featureRouting?: MilkdropWebGpuFeatureRouting,
): MilkdropWebGpuOptimizationFlags {
  const routing = featureRouting ?? resolveMilkdropWebGpuFeatureRouting();
  const safeMode = shouldUseSafeMilkdropWebGpuPath();
  return {
    ...flags,
    proceduralMainWave:
      routing.proceduralMainWave.enabled && flags.proceduralMainWave,
    proceduralTrailWaves:
      routing.proceduralTrailWaves.enabled && flags.proceduralTrailWaves,
    proceduralCustomWaves:
      routing.proceduralCustomWaves.enabled && flags.proceduralCustomWaves,
    proceduralMesh: routing.proceduralMesh.enabled && flags.proceduralMesh,
    proceduralMotionVectors:
      routing.proceduralMotionVectors.enabled && flags.proceduralMotionVectors,
    directFeedbackShaders:
      routing.directFeedbackShaders.enabled && flags.directFeedbackShaders,
    gpuComputeVM: routing.gpuComputeVM.enabled && flags.gpuComputeVM,
    renderBundles: routing.renderBundles.enabled && flags.renderBundles,
    descriptorFallbackToWebgl: safeMode
      ? false
      : flags.descriptorFallbackToWebgl,
  };
}

export function resolveMilkdropWebGpuOptimizationFlagsForBackend(
  flags: MilkdropWebGpuOptimizationFlags,
  backend: 'webgl' | 'webgpu',
): MilkdropWebGpuOptimizationFlags {
  return backend === 'webgpu'
    ? applyNativeWebGpuMaterialCompatibilityFlags(flags)
    : { ...flags };
}

const ENABLED_FLAG_VALUES = new Set(['1', 'true', 'on', 'yes', 'enabled']);
const DISABLED_FLAG_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);

function parseOptionalBooleanFlag(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (ENABLED_FLAG_VALUES.has(normalized)) {
    return true;
  }
  if (DISABLED_FLAG_VALUES.has(normalized)) {
    return false;
  }
  return null;
}

function getSearchFlag(
  location: Pick<Location, 'search'> | null | undefined,
  flagName: MilkdropWebGpuOptimizationFlagName,
) {
  if (!location?.search) {
    return null;
  }

  return getWebGpuFlagParams(location.search)[flagName];
}

function getStorageFlag(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  key: string,
) {
  return parseOptionalBooleanFlag(storage?.getItem?.(key));
}

export function resolveMilkdropWebGpuOptimizationFlags({
  location = globalThis.location,
  storage = globalThis.localStorage,
  overrides = {},
}: {
  location?: Pick<Location, 'search'> | null;
  storage?: Pick<Storage, 'getItem'> | null;
  overrides?: Partial<MilkdropWebGpuOptimizationFlags>;
} = {}): MilkdropWebGpuOptimizationFlags {
  const resolved: MilkdropWebGpuOptimizationFlags = {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  };

  for (const flagName of Object.keys(
    DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  ) as MilkdropWebGpuOptimizationFlagName[]) {
    const storageKey = MILKDROP_WEBGPU_OPTIMIZATION_STORAGE_KEYS[flagName];
    const searchValue = getSearchFlag(location, flagName);
    const storageValue = getStorageFlag(storage, storageKey);
    const overrideValue = overrides[flagName];

    resolved[flagName] =
      typeof overrideValue === 'boolean'
        ? overrideValue
        : (searchValue ?? storageValue ?? resolved[flagName]);
  }

  const searchInput = location?.search ?? '';
  const isCertificationWebGpuSession =
    getRequestedRenderer(searchInput) === 'webgpu' &&
    getRequestedCorpus(searchInput)?.toLowerCase() === 'certification';
  const hasExplicitFallbackOverride =
    getSearchFlag(location, 'descriptorFallbackToWebgl') !== null ||
    getStorageFlag(
      storage,
      MILKDROP_WEBGPU_OPTIMIZATION_STORAGE_KEYS.descriptorFallbackToWebgl,
    ) !== null ||
    typeof overrides.descriptorFallbackToWebgl === 'boolean';
  if (isCertificationWebGpuSession && !hasExplicitFallbackOverride) {
    // Certification captures must exercise the requested native backend. The
    // normal live-session fallback remains the default everywhere else.
    resolved.descriptorFallbackToWebgl = false;
  }

  return resolved;
}

function hasEnabledProceduralDescriptors(
  plan: MilkdropWebGpuDescriptorPlan,
  flags: MilkdropWebGpuOptimizationFlags,
) {
  return (
    (flags.proceduralMainWave &&
      plan.proceduralWaves.some((entry) => entry.target === 'main-wave')) ||
    (flags.proceduralTrailWaves &&
      plan.proceduralWaves.some((entry) => entry.target === 'trail-waves')) ||
    (flags.proceduralCustomWaves &&
      plan.proceduralWaves.some((entry) => entry.target === 'custom-wave')) ||
    (flags.proceduralMesh && Boolean(plan.proceduralMesh)) ||
    (flags.proceduralMotionVectors && Boolean(plan.proceduralMotionVectors)) ||
    (flags.directFeedbackShaders && Boolean(plan.feedback))
  );
}

function resolveRouting({
  plan,
  flags,
  enabledDescriptors,
}: {
  plan: MilkdropWebGpuDescriptorPlan;
  flags: MilkdropWebGpuOptimizationFlags;
  enabledDescriptors: boolean;
}): MilkdropGpuDescriptorRouting {
  if (plan.routing === 'fallback-webgl') {
    if (flags.descriptorFallbackToWebgl) {
      return 'fallback-webgl';
    }
    // With the fallback disabled, feedback-compatibility presets run natively
    // (the TSL feedback manager covers them), but genuinely unsupported
    // features still render more faithfully on WebGL — keep those there.
    if (plan.unsupported.length > 0) {
      return 'fallback-webgl';
    }
    return enabledDescriptors ? 'descriptor-plan' : 'generic-frame-payload';
  }

  return enabledDescriptors ? 'descriptor-plan' : 'generic-frame-payload';
}

export function applyMilkdropWebGpuOptimizationFlags(
  plan: MilkdropWebGpuDescriptorPlan,
  flags: MilkdropWebGpuOptimizationFlags,
): MilkdropWebGpuDescriptorPlan {
  const proceduralWaves = plan.proceduralWaves.filter((entry) => {
    switch (entry.target) {
      case 'main-wave':
        return flags.proceduralMainWave;
      case 'trail-waves':
        return flags.proceduralTrailWaves;
      case 'custom-wave':
        return flags.proceduralCustomWaves;
      default:
        return false;
    }
  });

  const proceduralMesh = flags.proceduralMesh ? plan.proceduralMesh : null;
  const proceduralMotionVectors = flags.proceduralMotionVectors
    ? plan.proceduralMotionVectors
    : null;
  const feedback = flags.directFeedbackShaders ? plan.feedback : null;
  const enabledDescriptors = hasEnabledProceduralDescriptors(plan, flags);

  return {
    routing: resolveRouting({
      plan,
      flags,
      enabledDescriptors,
    }),
    proceduralWaves,
    proceduralMesh,
    proceduralMotionVectors,
    feedback,
    unsupported: [...plan.unsupported],
  };
}

export function getDisabledMilkdropWebGpuOptimizationFlags(
  flags: MilkdropWebGpuOptimizationFlags,
) {
  return Object.entries(flags)
    .filter(([, enabled]) => !enabled)
    .map(([flagName]) => flagName) as MilkdropWebGpuOptimizationFlagName[];
}
