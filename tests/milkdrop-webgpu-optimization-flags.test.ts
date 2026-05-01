import { describe, expect, test } from 'bun:test';
import type { MilkdropWebGpuDescriptorPlan } from '../assets/js/milkdrop/types.ts';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  MILKDROP_WEBGPU_OPTIMIZATION_SEARCH_PARAMS,
  MILKDROP_WEBGPU_OPTIMIZATION_STORAGE_KEYS,
  resolveMilkdropWebGpuOptimizationFlags,
} from '../assets/js/milkdrop/webgpu-optimization-flags.ts';

const basePlan: MilkdropWebGpuDescriptorPlan = {
  routing: 'descriptor-plan',
  proceduralWaves: [
    {
      kind: 'procedural-wave',
      target: 'main-wave',
      slotIndex: null,
      sampleSource: 'waveform',
    },
    {
      kind: 'procedural-wave',
      target: 'trail-waves',
      slotIndex: null,
      sampleSource: 'waveform',
    },
    {
      kind: 'procedural-wave',
      target: 'custom-wave',
      slotIndex: 0,
      sampleSource: 'spectrum',
    },
  ],
  proceduralMesh: {
    kind: 'procedural-mesh',
    requiresPerPixelProgram: false,
    fieldProgram: null,
  },
  proceduralMotionVectors: {
    kind: 'procedural-motion-vectors',
    requiresPerPixelProgram: false,
    fieldProgram: null,
  },
  feedback: {
    kind: 'feedback-post-effect',
    shaderExecution: 'direct',
    usesFeedbackTexture: false,
    usesVideoEcho: false,
    usesPostEffects: false,
    targetResolution: 'adaptive',
    fallbackToLegacyFeedback: false,
  },
  unsupported: [],
};

describe('milkdrop webgpu optimization flag resolution', () => {
  test('defaults every rollout flag to enabled', () => {
    expect(resolveMilkdropWebGpuOptimizationFlags()).toEqual(
      DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    );
  });

  test('prefers query params over storage for individual rollout flags', () => {
    const flags = resolveMilkdropWebGpuOptimizationFlags({
      location: {
        search: `?${MILKDROP_WEBGPU_OPTIMIZATION_SEARCH_PARAMS.proceduralMesh}=0&${MILKDROP_WEBGPU_OPTIMIZATION_SEARCH_PARAMS.directFeedbackShaders}=false`,
      },
      storage: {
        getItem(key: string) {
          if (
            key === MILKDROP_WEBGPU_OPTIMIZATION_STORAGE_KEYS.proceduralMesh
          ) {
            return 'enabled';
          }
          if (
            key ===
            MILKDROP_WEBGPU_OPTIMIZATION_STORAGE_KEYS.directFeedbackShaders
          ) {
            return 'enabled';
          }
          return null;
        },
      },
    });

    expect(flags.proceduralMesh).toBe(false);
    expect(flags.directFeedbackShaders).toBe(false);
    expect(flags.proceduralMainWave).toBe(true);
  });
});

describe('milkdrop webgpu descriptor gating', () => {
  test('can disable each descriptor path independently without disturbing the others', () => {
    const gated = applyMilkdropWebGpuOptimizationFlags(basePlan, {
      ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      proceduralMainWave: false,
      proceduralTrailWaves: false,
      directFeedbackShaders: false,
      renderBundles: false,
    });

    expect(gated.routing).toBe('descriptor-plan');
    expect(gated.proceduralWaves).toEqual([
      expect.objectContaining({ target: 'custom-wave', slotIndex: 0 }),
    ]);
    expect(gated.proceduralMesh).not.toBeNull();
    expect(gated.proceduralMotionVectors).not.toBeNull();
    expect(gated.feedback).toBeNull();
  });

  test('downgrades to the generic payload path when every descriptor optimization is disabled', () => {
    const gated = applyMilkdropWebGpuOptimizationFlags(basePlan, {
      proceduralMainWave: false,
      proceduralTrailWaves: false,
      proceduralCustomWaves: false,
      proceduralMesh: false,
      proceduralMotionVectors: false,
      directFeedbackShaders: false,
      descriptorFallbackToWebgl: true,
      gpuComputeVM: true,
      renderBundles: false,
    });

    expect(gated).toEqual({
      routing: 'generic-frame-payload',
      proceduralWaves: [],
      proceduralMesh: null,
      proceduralMotionVectors: null,
      feedback: null,
      unsupported: [],
    });
  });
});
