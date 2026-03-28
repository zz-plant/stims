import { describe, expect, test } from 'bun:test';
import {
  buildBackendDivergence,
  buildCompatibilityEvidence,
  buildDegradationReasons,
  buildVisualFallbacks,
  classifyFidelity,
} from '../assets/js/milkdrop/compiler/compatibility.ts';
import type {
  MilkdropBackendSupport,
  MilkdropBlockingConstruct,
} from '../assets/js/milkdrop/types.ts';

const supportedWebgl: MilkdropBackendSupport = {
  status: 'supported',
  reasons: [],
  evidence: [],
  requiredFeatures: ['base-globals'],
  unsupportedFeatures: [],
};

const partialWebgpu: MilkdropBackendSupport = {
  status: 'partial',
  reasons: ['Video echo needs the legacy feedback path.'],
  evidence: [
    {
      backend: 'webgpu',
      scope: 'backend',
      status: 'partial',
      code: 'video-echo-gap',
      message: 'Video echo needs the legacy feedback path.',
      feature: 'video-echo',
    },
  ],
  requiredFeatures: ['base-globals', 'video-echo'],
  unsupportedFeatures: [],
};

describe('milkdrop compiler compatibility helpers', () => {
  test('derives divergence, fallbacks, degradation reasons, and fidelity together', () => {
    const blockedConstructDetails: MilkdropBlockingConstruct[] = [
      {
        kind: 'shader',
        value: 'ret = custom_expr',
        system: 'shader-text',
        allowlisted: false,
      },
    ];

    const backendDivergence = buildBackendDivergence({
      webgl: supportedWebgl,
      webgpu: partialWebgpu,
    });
    const visualFallbacks = buildVisualFallbacks({
      approximatedShaderLines: ['ret = custom_expr'],
      webgl: supportedWebgl,
      webgpu: partialWebgpu,
    });
    const degradationReasons = buildDegradationReasons({
      blockedConstructDetails,
      backendDivergence,
      visualFallbacks,
      webgl: supportedWebgl,
      webgpu: partialWebgpu,
    });

    expect(backendDivergence).toContain(
      'status:webgl=supported,webgpu=partial',
    );
    expect(visualFallbacks).toContain('shader-text-control-extraction');
    expect(degradationReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'shader-approximation',
          blocking: true,
        }),
        expect.objectContaining({ code: 'backend-partial', blocking: false }),
        expect.objectContaining({
          code: 'backend-divergence',
          blocking: false,
        }),
        expect.objectContaining({ code: 'visual-fallback', blocking: false }),
      ]),
    );
    expect(
      classifyFidelity({
        blockedConstructDetails,
        degradationReasons,
        webgl: supportedWebgl,
        webgpu: partialWebgpu,
        noBlockedConstructs: false,
      }),
    ).toBe('fallback');
  });

  test('maps diagnostics and evidence tiers into compatibility evidence summaries', () => {
    expect(
      buildCompatibilityEvidence({
        diagnostics: [],
        visualEvidenceTier: 'visual',
      }),
    ).toEqual({
      compile: 'verified',
      runtime: 'smoke-tested',
      visual: 'reference-suite',
    });

    expect(
      buildCompatibilityEvidence({
        diagnostics: [
          {
            severity: 'error',
            code: 'preset_invalid_scalar',
            message: 'boom',
          },
        ],
        visualEvidenceTier: 'none',
      }),
    ).toEqual({
      compile: 'issues',
      runtime: 'not-run',
      visual: 'not-captured',
    });
  });
});
