import { describe, expect, test } from 'bun:test';
import { buildWebGpuDescriptorPlan } from '../../src/js/milkdrop/compiler/gpu-descriptor-plan.ts';
import {
  lowerGpuFieldProgram,
  PER_FRAME_FIELD_REGISTER_INPUTS,
} from '../../src/js/milkdrop/compiler/gpu-field-planner.ts';
import {
  buildBackendSupport,
  buildFeatureAnalysis,
} from '../../src/js/milkdrop/compiler/parity.ts';
import { normalizeFieldKey } from '../../src/js/milkdrop/compiler/preset-normalization.ts';
import type {
  MilkdropBackendSupportEvidence,
  MilkdropFeatureAnalysis,
  MilkdropProgramBlock,
  MilkdropShaderControls,
} from '../../src/js/milkdrop/types.ts';

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

const defaultShaderControls = (): MilkdropShaderControls => ({
  warpScale: 0,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  zoom: 1,
  saturation: 1,
  contrast: 1,
  colorScale: { r: 1, g: 1, b: 1 },
  hueShift: 0,
  mixAlpha: 0,
  brightenBoost: 0,
  invertBoost: 0,
  solarizeBoost: 0,
  tint: { r: 1, g: 1, b: 1 },
  textureLayer: {
    source: 'none' as const,
    mode: 'none' as const,
    sampleDimension: '2d' as const,
    inverted: false,
    amount: 0,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
    volumeSliceZ: null,
  },
  warpTexture: {
    source: 'none' as const,
    sampleDimension: '2d' as const,
    amount: 0,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
    volumeSliceZ: null,
  },
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

  test('flags asymmetric shader translation as partial backend evidence', () => {
    const featureAnalysis = buildFeatureAnalysis({
      programs: {
        init: { statements: [], sourceLines: [] },
        perFrame: { statements: [], sourceLines: [] },
        perPixel: { statements: [], sourceLines: [] },
      },
      customWaves: [],
      customShapes: [],
      numericFields: {},
      unsupportedShaderText: false,
      supportedShaderText: true,
      shaderTextExecution: { webgl: 'direct', webgpu: 'translated' },
      featureOrder: ['base-globals', 'unsupported-shader-text'],
      analyzeProgramRegisters: () => {},
      hasProgramStatements: (block) => block.statements.length > 0,
      hasLegacyMotionVectorControls: () => false,
    });

    const buildSupport = (backend: 'webgl' | 'webgpu') =>
      buildBackendSupport({
        backend,
        featureAnalysis,
        sharedWarnings: [],
        softUnknownKeys: [],
        hardUnsupportedFields: [],
        unsupportedVolumeSamplerWarnings: [],
        createBackendEvidence: (args) => args as MilkdropBackendSupportEvidence,
        backendPartialFeatureGaps: { webgl: {}, webgpu: {} },
        backendShaderTextGaps: { webgl: {}, webgpu: {} },
      });

    const webgl = buildSupport('webgl');
    const webgpu = buildSupport('webgpu');

    expect(webgl.status).toBe('supported');
    expect(webgpu.status).toBe('partial');
    expect(
      webgpu.evidence.some((entry) => entry.code === 'shader-text-translated'),
    ).toBe(true);
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
        darkenCenter: false,
        solarize: false,
        invert: false,
        gammaAdj: 2,
        shaderControls: defaultShaderControls(),
        shaderPrograms: { warp: null, comp: null },
      },
      lowerGpuFieldProgram: () => null,
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

  test('keeps shader-texture feedback plans at scene resolution when overlay or warp textures are active', () => {
    const shaderControls = defaultShaderControls();
    shaderControls.textureLayer.source = 'noise';
    shaderControls.textureLayer.mode = 'replace';
    shaderControls.warpTexture.source = 'pattern';
    shaderControls.warpTexture.amount = 0.08;

    const plan = buildWebGpuDescriptorPlan({
      featureAnalysis: {
        featuresUsed: ['unsupported-shader-text'],
        unsupportedShaderText: false,
        supportedShaderText: true,
        shaderTextExecution: { webgl: 'translated', webgpu: 'translated' },
        registerUsage: { q: 0, t: 0 },
      } satisfies MilkdropFeatureAnalysis,
      webgpu: {
        status: 'supported',
        reasons: [],
        evidence: [],
        requiredFeatures: [],
        unsupportedFeatures: [],
        recommendedFallback: undefined,
      },
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
        darkenCenter: false,
        solarize: false,
        invert: false,
        gammaAdj: 2,
        shaderControls,
        shaderPrograms: { warp: null, comp: null },
      },
      lowerGpuFieldProgram: () => null,
    });

    expect(plan.feedback).toEqual(
      expect.objectContaining({
        kind: 'feedback-post-effect',
        shaderExecution: 'controls',
        targetResolution: 'scene',
      }),
    );
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

    const aspectProgram = lowerGpuFieldProgram({
      statements: [
        {
          target: 'zoom',
          expression: { type: 'identifier', name: 'aspect' },
          line: 1,
          source: 'zoom = aspect',
        },
      ],
      sourceLines: ['zoom = aspect'],
    });
    expect(aspectProgram?.statements[0]?.expression).toEqual({
      type: 'identifier',
      name: 'aspect',
    });
  });

  describe('lowerGpuFieldProgram temporaries', () => {
    const statement = (target: string, source: string, expression: unknown) =>
      ({
        target,
        expression,
        line: 1,
        source,
      }) as never;

    test('lowers scratch locals with arbitrary names, not just q/t-numbered ones', () => {
      const lowered = lowerGpuFieldProgram({
        statements: [
          statement('thresh', 'thresh = 0.5', {
            type: 'literal',
            value: 0.5,
          }),
          statement('zoom', 'zoom = thresh', {
            type: 'identifier',
            name: 'thresh',
          }),
        ],
        sourceLines: ['thresh = 0.5', 'zoom = thresh'],
      });

      expect(lowered).not.toBeNull();
      expect(lowered?.temporaries).toEqual(['thresh']);
      expect(lowered?.statements[1]?.expression).toEqual({
        type: 'identifier',
        name: 'thresh',
      });
    });

    test('allows a local to be read before its first assignment (MilkDrop zero-init)', () => {
      const lowered = lowerGpuFieldProgram({
        statements: [
          statement('zoom', 'zoom = thresh', {
            type: 'identifier',
            name: 'thresh',
          }),
          statement('thresh', 'thresh = 1', { type: 'literal', value: 1 }),
        ],
        sourceLines: ['zoom = thresh', 'thresh = 1'],
      });

      expect(lowered).not.toBeNull();
      expect(lowered?.temporaries).toEqual(['thresh']);
    });

    test('still bails on an identifier that is never assigned anywhere', () => {
      expect(
        lowerGpuFieldProgram({
          statements: [
            statement('zoom', 'zoom = nosuchthing', {
              type: 'identifier',
              name: 'nosuchthing',
            }),
          ],
          sourceLines: ['zoom = nosuchthing'],
        }),
      ).toBeNull();
    });

    test('refuses to turn a signal into a local', () => {
      expect(
        lowerGpuFieldProgram({
          statements: [
            statement('bass', 'bass = 1', { type: 'literal', value: 1 }),
          ],
          sourceLines: ['bass = 1'],
        }),
      ).toBeNull();
    });

    test('writes caller-injected state in place instead of shadowing it', () => {
      // The custom-wave path passes sample/value1 as state: they must be
      // assigned directly, never redeclared as a zero-initialised local.
      const lowered = lowerGpuFieldProgram(
        {
          statements: [
            statement('value1', 'value1 = sample', {
              type: 'identifier',
              name: 'sample',
            }),
          ],
          sourceLines: ['value1 = sample'],
        },
        { additionalStateIdentifiers: ['sample', 'value1'] },
      );

      expect(lowered).not.toBeNull();
      expect(lowered?.temporaries).toEqual([]);
      expect(lowered?.statements[0]?.target).toBe('value1');
    });

    test('lowers reads of the full q1..q32 register bank as frame-constant inputs', () => {
      const lowered = lowerGpuFieldProgram(
        {
          statements: [
            statement('zoom', 'zoom = q20 + q32', {
              type: 'binary',
              operator: '+',
              left: { type: 'identifier', name: 'q20' },
              right: { type: 'identifier', name: 'q32' },
            }),
          ],
          sourceLines: ['zoom = q20 + q32'],
        },
        { registerInputs: PER_FRAME_FIELD_REGISTER_INPUTS },
      );
      expect(lowered?.registerInputs).toEqual(['q20', 'q32']);
    });

    test('lowers aspectx/aspecty reads to the derived aspect signal aliases', () => {
      const lowered = lowerGpuFieldProgram({
        statements: [
          statement('zoom', 'zoom = aspectx * aspecty', {
            type: 'binary',
            operator: '*',
            left: { type: 'identifier', name: 'aspectx' },
            right: { type: 'identifier', name: 'aspecty' },
          }),
        ],
        sourceLines: ['zoom = aspectx * aspecty'],
      });
      expect(lowered?.statements[0]?.expression).toEqual({
        type: 'binary',
        operator: '*',
        left: { type: 'identifier', name: 'aspectX' },
        right: { type: 'identifier', name: 'aspectY' },
      });
    });

    test('lowers log10 calls', () => {
      const lowered = lowerGpuFieldProgram({
        statements: [
          statement('zoom', 'zoom = log10(rad)', {
            type: 'call',
            name: 'log10',
            args: [{ type: 'identifier', name: 'rad' }],
          }),
        ],
        sourceLines: ['zoom = log10(rad)'],
      });
      expect(lowered).not.toBeNull();
    });

    test('does not reclassify a caller-injected read-only binding as a local', () => {
      expect(
        lowerGpuFieldProgram(
          {
            statements: [
              statement('mystery', 'mystery = 1', {
                type: 'literal',
                value: 1,
              }),
            ],
            sourceLines: ['mystery = 1'],
          },
          { additionalAllowedIdentifiers: ['mystery'] },
        ),
      ).toBeNull();
    });
  });
});
