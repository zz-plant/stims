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
};

export type MilkdropWebGpuOptimizationFlagName =
  keyof MilkdropWebGpuOptimizationFlags;

// descriptorFallbackToWebgl defaults to true (route feedback/post-effect
// presets to plain WebGL) as a conservative rollout switch. Flipping it
// requires every ShaderMaterial-based WebGPU rendering path it would newly
// exercise to be ported to three.js's NodeMaterial/TSL system first —
// WebGPURenderer's NodeBuilder does not recognize plain ShaderMaterial and
// silently swaps in a blank default material for it. The plain wave
// material (proceduralMainWave/proceduralTrailWaves, in
// webgpu-procedural-materials.ts) has been ported and verified against
// reference renders. proceduralMesh, proceduralMotionVectors, and
// proceduralCustomWaves have not, and — subtly — disabling just those three
// isn't a safe partial flip either: for presets with none of those features
// enabled, the renderer falls through to the generic-frame-payload path's
// particle-field-renderer.ts, which *also* builds a plain ShaderMaterial
// unconditionally on both backends. descriptorFallbackToWebgl can only move
// to false once mesh, motion-vectors, custom-wave, and particle-field are
// all ported.
export const DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS = Object.freeze({
  proceduralMainWave: true,
  proceduralTrailWaves: true,
  proceduralCustomWaves: true,
  proceduralMesh: true,
  proceduralMotionVectors: true,
  directFeedbackShaders: true,
  descriptorFallbackToWebgl: true,
  gpuComputeVM: true,
  renderBundles: false,
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
    return flags.descriptorFallbackToWebgl
      ? 'fallback-webgl'
      : enabledDescriptors
        ? 'descriptor-plan'
        : 'generic-frame-payload';
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
