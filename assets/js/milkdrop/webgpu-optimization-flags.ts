import type {
  MilkdropGpuDescriptorRouting,
  MilkdropRenderBackend,
  MilkdropWebGpuDescriptorPlan,
} from './types';

export const MILKDROP_WEBGPU_OPTIMIZATION_SEARCH_PARAMS = {
  proceduralMainWave: 'milkdrop-webgpu-main-wave',
  proceduralTrailWaves: 'milkdrop-webgpu-trail-waves',
  proceduralCustomWaves: 'milkdrop-webgpu-custom-waves',
  proceduralMesh: 'milkdrop-webgpu-mesh',
  proceduralMotionVectors: 'milkdrop-webgpu-motion-vectors',
  directFeedbackShaders: 'milkdrop-webgpu-feedback',
  descriptorFallbackToWebgl: 'milkdrop-webgpu-fallback',
  gpuComputeVM: 'milkdrop-webgpu-compute-vm',
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
};

export type MilkdropWebGpuOptimizationFlagName =
  keyof MilkdropWebGpuOptimizationFlags;

export const DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS = Object.freeze({
  proceduralMainWave: true,
  proceduralTrailWaves: true,
  proceduralCustomWaves: true,
  proceduralMesh: true,
  proceduralMotionVectors: true,
  directFeedbackShaders: true,
  descriptorFallbackToWebgl: true,
  gpuComputeVM: true,
}) satisfies MilkdropWebGpuOptimizationFlags;

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
  param: string,
) {
  if (!location?.search) {
    return null;
  }

  return parseOptionalBooleanFlag(
    new URLSearchParams(location.search).get(param),
  );
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
    const searchParam = MILKDROP_WEBGPU_OPTIMIZATION_SEARCH_PARAMS[flagName];
    const storageKey = MILKDROP_WEBGPU_OPTIMIZATION_STORAGE_KEYS[flagName];
    const searchValue = getSearchFlag(location, searchParam);
    const storageValue = getStorageFlag(storage, storageKey);
    const overrideValue = overrides[flagName];

    resolved[flagName] =
      typeof overrideValue === 'boolean'
        ? overrideValue
        : (searchValue ?? storageValue ?? resolved[flagName]);
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

export function shouldFallbackMilkdropPresetToWebgl({
  backend,
  compatibilityMode,
  descriptorPlan,
  flags,
}: {
  backend: MilkdropRenderBackend;
  compatibilityMode: boolean;
  descriptorPlan: MilkdropWebGpuDescriptorPlan;
  flags: MilkdropWebGpuOptimizationFlags;
}) {
  return (
    backend === 'webgpu' &&
    !compatibilityMode &&
    applyMilkdropWebGpuOptimizationFlags(descriptorPlan, flags).routing ===
      'fallback-webgl'
  );
}

export function getDisabledMilkdropWebGpuOptimizationFlags(
  flags: MilkdropWebGpuOptimizationFlags,
) {
  return Object.entries(flags)
    .filter(([, enabled]) => !enabled)
    .map(([flagName]) => flagName) as MilkdropWebGpuOptimizationFlagName[];
}
