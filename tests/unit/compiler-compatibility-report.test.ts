import { describe, expect, test } from 'bun:test';
import { buildParityReport } from '../../src/js/milkdrop/compiler/compatibility-report.ts';
import type { MilkdropDegradationReason } from '../../src/js/milkdrop/types';

describe('compiler compatibility report', () => {
  test('buildParityReport aggregates parity report fields accurately', () => {
    const degradation: MilkdropDegradationReason = {
      code: 'shader-approximation',
      category: 'unsupported-shader',
      message: 'Approximated shader function used',
      system: 'shader',
      blocking: false,
    };

    const report = buildParityReport({
      ignoredFields: ['q1_custom'],
      approximatedShaderLines: ['tex2d(...)'],
      missingAliasesOrFunctions: [],
      backendDivergence: [],
      visualFallbacks: ['software-blend'],
      blockedConstructs: [],
      blockingConstructDetails: [],
      degradationReasons: [degradation],
      fidelityClass: 'near-exact',
      evidence: {
        compile: 'verified',
        runtime: 'smoke-tested',
        visual: 'not-captured',
      },
      visualEvidenceTier: 'runtime',
      semanticSupport: {
        fidelityClass: 'near-exact',
        evidence: {
          compile: 'verified',
          runtime: 'smoke-tested',
          visual: 'not-captured',
        },
        visualEvidenceTier: 'runtime',
      },
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'near-exact',
        visualEvidenceTier: 'runtime',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: [],
      },
    });

    expect(report.fidelityClass).toBe('near-exact');
    expect(report.ignoredFields).toEqual(['q1_custom']);
    expect(report.approximatedShaderLines).toEqual(['tex2d(...)']);
    expect(report.visualFallbacks).toEqual(['software-blend']);
    expect(report.degradationReasons).toEqual([degradation]);
    expect(report.visualEvidenceTier).toBe('runtime');
  });
});
