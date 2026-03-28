import { describe, expect, test } from 'bun:test';
import { buildWebGpuDescriptorPlan } from '../assets/js/milkdrop/compiler/gpu-descriptor-plan.ts';
import { lowerGpuFieldProgram } from '../assets/js/milkdrop/compiler/gpu-field-planner.ts';
import {
  buildBackendSupport,
  buildFeatureAnalysis,
} from '../assets/js/milkdrop/compiler/parity.ts';
import { normalizeFieldKey } from '../assets/js/milkdrop/compiler/preset-normalization.ts';
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
        webgpu: {},
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
    expect(support.evidence).toHaveLength(2);
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

  test('normalizes legacy custom field keys and lowers GPU-safe programs', () => {
    expect(
      normalizeFieldKey({
        key: 'wavecode_0_badditive',
        rawValue: '1',
        line: 1,
        section: null,
      }),
    ).toBe('custom_wave_1_additive');
    expect(
      normalizeFieldKey({
        key: 'bAdditiveWaves',
        rawValue: '1',
        line: 2,
        section: null,
      }),
    ).toBe('wave_additive');
    expect(
      normalizeFieldKey({
        key: 'AdditiveWaves',
        rawValue: '1',
        line: 2,
        section: null,
      }),
    ).toBe('wave_additive');
    expect(
      normalizeFieldKey({
        key: 'additivewaves',
        rawValue: '1',
        line: 2,
        section: null,
      }),
    ).toBe('wave_additive');
    expect(
      normalizeFieldKey({
        key: 'waveadditive',
        rawValue: '1',
        line: 2,
        section: null,
      }),
    ).toBe('wave_additive');
    expect(
      normalizeFieldKey({
        key: 'bWaveDots',
        rawValue: '1',
        line: 3,
        section: null,
      }),
    ).toBe('wave_usedots');
    expect(
      normalizeFieldKey({
        key: 'waveDots',
        rawValue: '1',
        line: 3,
        section: null,
      }),
    ).toBe('wave_usedots');
    expect(
      normalizeFieldKey({
        key: 'wavedots',
        rawValue: '1',
        line: 3,
        section: null,
      }),
    ).toBe('wave_usedots');
    expect(
      normalizeFieldKey({
        key: 'waveusedots',
        rawValue: '1',
        line: 3,
        section: null,
      }),
    ).toBe('wave_usedots');
    expect(
      normalizeFieldKey({
        key: 'fWaveThick',
        rawValue: '2',
        line: 4,
        section: null,
      }),
    ).toBe('wave_thick');
    expect(
      normalizeFieldKey({
        key: 'waveThick',
        rawValue: '2',
        line: 4,
        section: null,
      }),
    ).toBe('wave_thick');
    expect(
      normalizeFieldKey({
        key: 'wavethick',
        rawValue: '2',
        line: 4,
        section: null,
      }),
    ).toBe('wave_thick');
    expect(
      normalizeFieldKey({
        key: 'bRedBlueStereo',
        rawValue: '1',
        line: 5,
        section: null,
      }),
    ).toBe('red_blue_stereo');

    const lowered = lowerGpuFieldProgram({
      statements: [
        {
          target: 'zoom',
          expression: {
            type: 'call',
            name: 'sin',
            args: [{ type: 'identifier', name: 'time' }],
          },
          line: 1,
          source: 'zoom = sin(time)',
        },
      ],
      sourceLines: ['zoom = sin(time)'],
    });

    expect(lowered).not.toBeNull();
    expect(lowered?.statements).toEqual([
      {
        target: 'zoom',
        expression: {
          type: 'call',
          name: 'sin',
          args: [{ type: 'identifier', name: 'time' }],
        },
      },
    ]);
  });
});
