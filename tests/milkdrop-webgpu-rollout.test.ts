import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  shouldFallbackMilkdropPresetToWebgl,
} from '../assets/js/milkdrop/webgpu-optimization-flags.ts';
import {
  assertCertificationSemantics,
  type ComparatorDiffResult,
  computeWebGpuCertificationStatus,
  loadWebGpuCertificationReport,
  validateCertificationReport,
  type WebGpuCertificationReport,
} from '../scripts/run-webgpu-certification-comparator.ts';

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

  test('keeps unsupported fixtures only on a descriptor plan after removing forced WebGL fallback', () => {
    const compiled = compileFixture('unsupported-fallback.milk');
    const descriptorPlan = compiled.ir.compatibility.gpuDescriptorPlans.webgpu;

    expect(descriptorPlan.routing).toBe('descriptor-plan');
    expect(
      shouldFallbackMilkdropPresetToWebgl({
        backend: 'webgpu',
        compatibilityMode: false,
        descriptorPlan,
        flags: DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
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
        proceduralMotionVectors: expect.objectContaining({
          kind: 'procedural-motion-vectors',
        }),
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
        proceduralMotionVectors: false,
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

  describe('webgpu certification comparator', () => {
    test('certification report JSON has valid structure', () => {
      const report = loadWebGpuCertificationReport(process.cwd());
      expect(report).not.toBeNull();
      expect(validateCertificationReport(report)).toBe(true);

      if (report) {
        expect(report.version).toBe(1);
        expect(report.parityTarget).toBe('webgpu-certification-comparator');
        expect(typeof report.tolerance.threshold).toBe('number');
        expect(typeof report.tolerance.failThreshold).toBe('number');
        expect(Array.isArray(report.presets)).toBe(true);
        expect(typeof report.presetCount).toBe('number');
        expect(report.presetCount).toBe(report.presets.length);

        for (const preset of report.presets) {
          expect(preset.presetId).toBeString();
          expect(preset.title).toBeString();
          expect(preset.hasProjectmReference).toBeBoolean();
          expect(typeof preset.failThreshold).toBe('number');
          expect(preset.webglDiff.status).toBeString();
          expect(preset.webgpuDiff.status).toBeString();
          expect([
            'unmeasured',
            'certified-webgl',
            'certified-native',
            'certified-both',
          ]).toContain(preset.webgpuCertificationStatus);
        }
      }
    });

    test('preset marked certified-both must have both mismatch ratios under threshold', () => {
      const passDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-1',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.01,
        status: 'pass',
        error: null,
      };

      const status = computeWebGpuCertificationStatus({
        webglDiff: passDiff,
        webgpuDiff: passDiff,
        failThreshold: 0.04,
      });

      expect(status).toBe('certified-both');
    });

    test('certified-both requires both diffs to pass — not just one', () => {
      const passDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-1',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.01,
        status: 'pass',
        error: null,
      };

      const failDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-2',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.08,
        status: 'fail',
        error: null,
      };

      const statusWebglOnly = computeWebGpuCertificationStatus({
        webglDiff: passDiff,
        webgpuDiff: failDiff,
        failThreshold: 0.04,
      });

      expect(statusWebglOnly).toBe('certified-webgl');

      const statusWebgpuOnly = computeWebGpuCertificationStatus({
        webglDiff: failDiff,
        webgpuDiff: passDiff,
        failThreshold: 0.04,
      });

      expect(statusWebgpuOnly).toBe('certified-native');
    });

    test('preset cannot be certified-native if WebGL compatibility is broken', () => {
      const passWebgpuDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-1',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.01,
        status: 'pass',
        error: null,
      };

      const brokenWebglDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-2',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.08,
        status: 'fail',
        error: null,
      };

      const status = computeWebGpuCertificationStatus({
        webglDiff: brokenWebglDiff,
        webgpuDiff: passWebgpuDiff,
        failThreshold: 0.04,
      });

      expect(status).toBe('certified-native');

      const report: WebGpuCertificationReport = {
        version: 1,
        generatedAt: new Date().toISOString(),
        parityTarget: 'webgpu-certification-comparator',
        tolerance: { threshold: 16, failThreshold: 0.04 },
        presetCount: 1,
        certifiedBothCount: 0,
        certifiedNativeCount: 1,
        certifiedWebglCount: 0,
        unmeasuredCount: 0,
        presets: [
          {
            presetId: 'test-preset',
            title: 'Test Preset',
            corpusGroup: 'projectm-upstream',
            hasProjectmReference: true,
            projectmReferenceImage: 'test.png',
            failThreshold: 0.04,
            webglDiff: brokenWebglDiff,
            webgpuDiff: passWebgpuDiff,
            webgpuCertificationStatus: status,
          },
        ],
      };

      const violations = assertCertificationSemantics(report);
      expect(violations).toHaveLength(0);
    });

    test('assertCertificationSemantics detects certified-both violations when one backend fails', () => {
      const passDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-1',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.01,
        status: 'pass',
        error: null,
      };

      const failDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-2',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.08,
        status: 'fail',
        error: null,
      };

      const report: WebGpuCertificationReport = {
        version: 1,
        generatedAt: new Date().toISOString(),
        parityTarget: 'webgpu-certification-comparator',
        tolerance: { threshold: 16, failThreshold: 0.04 },
        presetCount: 1,
        certifiedBothCount: 1,
        certifiedNativeCount: 0,
        certifiedWebglCount: 0,
        unmeasuredCount: 0,
        presets: [
          {
            presetId: 'bad-certified-both',
            title: 'Bad Certified Both',
            corpusGroup: 'projectm-upstream',
            hasProjectmReference: true,
            projectmReferenceImage: 'test.png',
            failThreshold: 0.04,
            webglDiff: failDiff,
            webgpuDiff: passDiff,
            webgpuCertificationStatus: 'certified-both',
          },
        ],
      };

      const violations = assertCertificationSemantics(report);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes('bad-certified-both'))).toBe(
        true,
      );
      expect(violations.some((v) => v.includes('WebGL'))).toBe(true);
    });

    test('unmeasured diffs do not count as passing for certification', () => {
      const unmeasuredDiff: ComparatorDiffResult = {
        stimsArtifactId: null,
        capturePath: null,
        mismatchRatio: null,
        status: 'unmeasured',
        error: null,
      };

      const status = computeWebGpuCertificationStatus({
        webglDiff: unmeasuredDiff,
        webgpuDiff: unmeasuredDiff,
        failThreshold: 0.04,
      });

      expect(status).toBe('unmeasured');
    });

    test('missing-capture diffs do not count as passing for certification', () => {
      const missingCapture: ComparatorDiffResult = {
        stimsArtifactId: null,
        capturePath: null,
        mismatchRatio: null,
        status: 'missing-capture',
        error: 'No WebGL capture exists',
      };

      const passDiff: ComparatorDiffResult = {
        stimsArtifactId: 'stims-1',
        capturePath: '/captures/preset.png',
        mismatchRatio: 0.01,
        status: 'pass',
        error: null,
      };

      const status = computeWebGpuCertificationStatus({
        webglDiff: missingCapture,
        webgpuDiff: passDiff,
        failThreshold: 0.04,
      });

      expect(status).toBe('certified-native');
    });

    test('certification report loaded from disk has every preset with a webgpuCertificationStatus', () => {
      const report = loadWebGpuCertificationReport(process.cwd());
      if (!report) {
        return;
      }
      for (const preset of report.presets) {
        expect([
          'unmeasured',
          'certified-webgl',
          'certified-native',
          'certified-both',
        ]).toContain(preset.webgpuCertificationStatus);
      }
    });
  });
});
