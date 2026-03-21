import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  shouldFallbackMilkdropPresetToWebgl,
} from '../assets/js/milkdrop/webgpu-optimization-flags.ts';

const FIXTURE_DIR = join(
  process.cwd(),
  'tests',
  'fixtures',
  'milkdrop',
  'webgpu-rollout',
);

function compileFixture(file: string) {
  const raw = readFileSync(join(FIXTURE_DIR, file), 'utf8');
  return compileMilkdropPresetSource(raw, {
    id: file.replace(/\.milk$/, ''),
    title: file,
    fileName: file,
    origin: 'user',
  });
}

describe('milkdrop webgpu rollout fixture matrix', () => {
  test('keeps supported procedural fixtures on descriptor plans', () => {
    const compiled = compileFixture('supported-procedural.milk');
    const effective = applyMilkdropWebGpuOptimizationFlags(
      compiled.ir.compatibility.gpuDescriptorPlans.webgpu,
      DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    );

    expect(effective.routing).toBe('descriptor-plan');
    expect(effective.proceduralWaves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'main-wave' }),
        expect.objectContaining({ target: 'trail-waves' }),
        expect.objectContaining({ target: 'custom-wave', slotIndex: 1 }),
      ]),
    );
    expect(effective.proceduralMesh).not.toBeNull();
    expect(effective.proceduralMotionVectors).not.toBeNull();
  });

  test('keeps unsupported fixtures on fallback-to-webgl only when the rollout guard is enabled', () => {
    const compiled = compileFixture('unsupported-fallback.milk');
    const descriptorPlan = compiled.ir.compatibility.gpuDescriptorPlans.webgpu;

    expect(descriptorPlan.routing).toBe('fallback-webgl');
    expect(
      shouldFallbackMilkdropPresetToWebgl({
        backend: 'webgpu',
        compatibilityMode: false,
        descriptorPlan,
        flags: DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      }),
    ).toBe(true);

    const disabledFallbackPlan = applyMilkdropWebGpuOptimizationFlags(
      descriptorPlan,
      {
        ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
        descriptorFallbackToWebgl: false,
      },
    );

    expect(disabledFallbackPlan.routing).toBe('generic-frame-payload');
    expect(disabledFallbackPlan.unsupported).toHaveLength(1);
    expect(
      shouldFallbackMilkdropPresetToWebgl({
        backend: 'webgpu',
        compatibilityMode: false,
        descriptorPlan,
        flags: {
          ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
          descriptorFallbackToWebgl: false,
        },
      }),
    ).toBe(false);
  });

  test('preserves mixed fixtures on the supported descriptor subset and falls back cleanly when that subset is disabled', () => {
    const compiled = compileFixture('mixed-legacy-motion.milk');
    const descriptorPlan = compiled.ir.compatibility.gpuDescriptorPlans.webgpu;

    expect(descriptorPlan).toEqual(
      expect.objectContaining({
        routing: 'descriptor-plan',
        proceduralMesh: expect.objectContaining({ kind: 'procedural-mesh' }),
        proceduralMotionVectors: null,
        unsupported: [],
      }),
    );

    const meshOnlyDisabled = applyMilkdropWebGpuOptimizationFlags(
      descriptorPlan,
      {
        ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
        proceduralMainWave: false,
        proceduralTrailWaves: false,
        proceduralCustomWaves: false,
        proceduralMesh: false,
      },
    );

    expect(meshOnlyDisabled).toEqual({
      routing: 'generic-frame-payload',
      proceduralWaves: [],
      proceduralMesh: null,
      proceduralMotionVectors: null,
      feedback: null,
      unsupported: [],
    });
  });
});
