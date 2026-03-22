import { describe, expect, test } from 'bun:test';
import { buildWebGpuDescriptorPlan } from '../assets/js/milkdrop/compiler/gpu-descriptor-plan.ts';
import {
  buildBackendSupport,
  buildFeatureAnalysis,
} from '../assets/js/milkdrop/compiler/parity.ts';
import type {
  MilkdropBackendSupportEvidence,
  MilkdropProgramBlock,
} from '../assets/js/milkdrop/types.ts';

const emptyBlock = (): MilkdropProgramBlock => ({
  statements: [],
  sourceLines: [],
});

const perFrameBlock = (): MilkdropProgramBlock => ({
  statements: [
    {
      target: 'zoom',
      expression: { type: 'literal', value: 1 },
      line: 1,
      source: 'zoom = 1',
    },
  ],
  sourceLines: ['zoom = 1'],
});

describe('milkdrop compiler seams', () => {
  test('deduplicates backend parity evidence and preserves required features', () => {
    const featureAnalysis = buildFeatureAnalysis({
      programs: {
        init: emptyBlock(),
        perFrame: perFrameBlock(),
        perPixel: emptyBlock(),
      },
      customWaves: [],
      customShapes: [],
      numericFields: { video_echo_enabled: 1 },
      unsupportedShaderText: false,
      supportedShaderText: true,
      shaderTextExecution: { webgl: 'none', webgpu: 'translated' },
      featureOrder: [
        'base-globals',
        'per-frame-equations',
        'per-pixel-equations',
        'custom-waves',
        'custom-shapes',
        'borders',
        'motion-vectors',
        'video-echo',
        'post-effects',
        'unsupported-shader-text',
      ],
      analyzeProgramRegisters: () => {},
      hasProgramStatements: (block) => block.statements.length > 0,
      hasLegacyMotionVectorControls: () => false,
    });

    const support = buildBackendSupport({
      backend: 'webgpu',
      featureAnalysis,
      sharedWarnings: ['Unknown preset field "legacy" was ignored.'],
      softUnknownKeys: ['legacy'],
      hardUnsupportedFields: [],
      unsupportedVolumeSamplerWarnings: [],
      createBackendEvidence: (args) => args as MilkdropBackendSupportEvidence,
      backendPartialFeatureGaps: {
        webgl: {},
        webgpu: { 'video-echo': 'Video echo needs the legacy feedback path.' },
      },
      backendShaderTextGaps: {
        webgl: {},
        webgpu: {
          supportedSubset:
            'Translated shader text keeps control fallbacks active.',
        },
      },
    });

    expect(featureAnalysis.featuresUsed).toEqual([
      'base-globals',
      'per-frame-equations',
      'video-echo',
    ]);
    expect(support.status).toBe('partial');
    expect(support.requiredFeatures).toEqual([
      'base-globals',
      'per-frame-equations',
      'video-echo',
    ]);
    expect(support.reasons).toContain(
      'Video echo needs the legacy feedback path.',
    );
    expect(support.evidence).toHaveLength(3);
  });

  test('routes WebGPU descriptor planning to fallback when unsupported features remain', () => {
    const plan = buildWebGpuDescriptorPlan({
      featureAnalysis: {
        featuresUsed: ['motion-vectors'],
        unsupportedShaderText: false,
        supportedShaderText: true,
        shaderTextExecution: { webgl: 'none', webgpu: 'none' },
        registerUsage: { q: 0, t: 0 },
      },
      webgpu: {
        status: 'unsupported',
        reasons: ['Unsupported motion vectors'],
        evidence: [
          {
            backend: 'webgpu',
            scope: 'backend',
            status: 'unsupported',
            code: 'unsupported-hard-feature',
            message: 'Unsupported motion vectors',
            feature: 'motion-vectors',
          },
        ],
        requiredFeatures: ['motion-vectors'],
        unsupportedFeatures: ['motion-vectors'],
        recommendedFallback: 'webgl',
      },
      numericFields: {},
      programs: {
        init: emptyBlock(),
        perFrame: emptyBlock(),
        perPixel: emptyBlock(),
      },
      customWaves: [],
      post: {
        feedbackTexture: false,
        videoEchoEnabled: false,
        brighten: false,
        darken: false,
        solarize: false,
        invert: false,
        shaderPrograms: { warp: null, comp: null },
      },
      lowerGpuFieldProgram: () => null,
      hasLegacyMotionVectorControls: () => false,
    });

    expect(plan.routing).toBe('fallback-webgl');
    expect(plan.unsupported).toEqual([
      {
        kind: 'unsupported-feature',
        feature: 'motion-vectors',
        reason: 'Unsupported motion vectors',
        recommendedFallback: 'webgl',
      },
    ]);
  });
});
