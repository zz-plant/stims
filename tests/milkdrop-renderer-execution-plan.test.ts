import { describe, expect, test } from 'bun:test';
import { resolveMilkdropRendererExecutionPlan } from '../assets/js/milkdrop/renderer-execution-plan.ts';
import type { MilkdropWebGpuDescriptorPlan } from '../assets/js/milkdrop/types.ts';
import {
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from '../assets/js/milkdrop/webgpu-optimization-flags.ts';

function createDescriptorPlan(
  overrides: Partial<MilkdropWebGpuDescriptorPlan> = {},
): MilkdropWebGpuDescriptorPlan {
  return {
    routing: 'descriptor-plan',
    proceduralWaves: [
      {
        kind: 'procedural-wave',
        target: 'main-wave',
        slotIndex: null,
        sampleSource: 'waveform',
      },
    ],
    proceduralMesh: null,
    proceduralMotionVectors: null,
    feedback: {
      kind: 'feedback-post-effect',
      shaderExecution: 'direct',
      usesFeedbackTexture: true,
      usesVideoEcho: true,
      usesPostEffects: true,
      targetResolution: 'adaptive',
      fallbackToLegacyFeedback: false,
    },
    unsupported: [],
    ...overrides,
  };
}

function flags(
  overrides: Partial<MilkdropWebGpuOptimizationFlags> = {},
): MilkdropWebGpuOptimizationFlags {
  return {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    ...overrides,
  };
}

describe('milkdrop renderer execution plan', () => {
  test('keeps the safe webgpu path on webgpu while disabling feedback manager allocation', () => {
    const plan = resolveMilkdropRendererExecutionPlan({
      backend: 'webgpu',
      safeWebGpuPath: true,
      descriptorPlan: createDescriptorPlan(),
      flags: flags({ directFeedbackShaders: false }),
      compatibilityMode: false,
    });

    expect(plan.backend).toBe('webgpu');
    expect(plan.webgpuPath).toBe('safe');
    expect(plan.feedbackMode).toBe('none');
    expect(plan.effectiveWebGpuDescriptorPlan?.feedback).toBeNull();
    expect(plan.shouldFallbackToWebgl).toBe(false);
  });

  test('keeps native feedback manager disabled on the full webgpu path until browser parity is stable', () => {
    const plan = resolveMilkdropRendererExecutionPlan({
      backend: 'webgpu',
      safeWebGpuPath: false,
      descriptorPlan: createDescriptorPlan(),
      flags: flags(),
      compatibilityMode: false,
    });

    expect(plan.webgpuPath).toBe('full');
    expect(plan.feedbackMode).toBe('none');
    expect(plan.effectiveWebGpuDescriptorPlan?.feedback).toEqual(
      expect.objectContaining({ shaderExecution: 'direct' }),
    );
    expect(plan.shouldFallbackToWebgl).toBe(false);
  });

  test('routes descriptor fallback plans to webgl outside compatibility mode', () => {
    const plan = resolveMilkdropRendererExecutionPlan({
      backend: 'webgpu',
      safeWebGpuPath: false,
      descriptorPlan: createDescriptorPlan({ routing: 'fallback-webgl' }),
      flags: flags(),
      compatibilityMode: false,
    });

    expect(plan.effectiveWebGpuDescriptorPlan?.routing).toBe('fallback-webgl');
    expect(plan.shouldFallbackToWebgl).toBe(true);
    expect(plan.fallbackReason).toBe('descriptor-plan');
  });

  test('keeps descriptor fallback plans on webgpu when fallback gating is disabled', () => {
    const plan = resolveMilkdropRendererExecutionPlan({
      backend: 'webgpu',
      safeWebGpuPath: false,
      descriptorPlan: createDescriptorPlan({ routing: 'fallback-webgl' }),
      flags: flags({ descriptorFallbackToWebgl: false }),
      compatibilityMode: false,
    });

    expect(plan.effectiveWebGpuDescriptorPlan?.routing).toBe('descriptor-plan');
    expect(plan.shouldFallbackToWebgl).toBe(false);
    expect(plan.fallbackReason).toBeNull();
  });
});
