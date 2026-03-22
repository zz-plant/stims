import type {
  MilkdropDegradationReason,
  MilkdropDiagnostic,
  MilkdropExpressionNode,
  MilkdropFeatureAnalysis,
  MilkdropParityReport,
  MilkdropPresetAST,
  MilkdropPresetField,
  MilkdropPresetIR,
  MilkdropPresetSource,
  MilkdropShaderControls,
  MilkdropShaderStatement,
  MilkdropShapeDefinition,
  MilkdropVideoEchoOrientation,
  MilkdropWaveDefinition,
} from '../types';
import type { buildWebGpuDescriptorPlan } from './gpu-descriptor-plan';
import type {
  buildBackendSupport,
  buildFeatureAnalysis,
  HardUnsupportedFieldSpec,
} from './parity';

export type PendingHardUnsupportedField = HardUnsupportedFieldSpec & {
  line: number;
};

type ProgramBlock = MilkdropPresetIR['programs']['init'];

type ShaderControlAnalysis = {
  statements: MilkdropShaderStatement[];
  directProgramStatements: MilkdropShaderStatement[];
  directProgramLines: string[];
  unsupportedLines: string[];
  supported: boolean;
  controls: MilkdropShaderControls;
  expressions: MilkdropPresetIR['shaderText']['controlExpressions'];
};

type ProgramAssemblyHelpers = {
  createProgramBlock: () => ProgramBlock;
  compileProgramsFromField: (
    field: MilkdropPresetField,
    programs: MilkdropPresetIR['programs'],
    customWaveMap: Map<number, MilkdropWaveDefinition>,
    customShapeMap: Map<number, MilkdropShapeDefinition>,
    diagnostics: MilkdropDiagnostic[],
    pendingProgramSources: Map<
      ProgramBlock,
      { sourceLine: string; line: number }
    >,
  ) => boolean;
};

type FieldAssemblyHelpers = {
  normalizeFieldKey: (field: MilkdropPresetField) => string | null;
  getHardUnsupportedField: (
    key: string,
  ) =>
    | { feature: HardUnsupportedFieldSpec['feature']; message: string }
    | undefined;
  normalizeString: (rawValue: string) => string;
  normalizeShaderFieldChunk: (rawValue: string) => string | null;
  compileScalarField: (
    field: MilkdropPresetField,
    diagnostics: MilkdropDiagnostic[],
  ) => { value: number | null; expression?: MilkdropExpressionNode };
  addDiagnostic: (
    diagnostics: MilkdropDiagnostic[],
    severity: 'warning' | 'error',
    code: string,
    message: string,
    location?: { line?: number; field?: string },
  ) => void;
  ensureWaveDefinition: (
    map: Map<number, MilkdropWaveDefinition>,
    index: number,
  ) => MilkdropWaveDefinition;
  ensureShapeDefinition: (
    map: Map<number, MilkdropShapeDefinition>,
    index: number,
  ) => MilkdropShapeDefinition;
  normalizeVideoEchoOrientation: (
    value: number,
  ) => MilkdropVideoEchoOrientation;
  pushProgramStatement: (
    block: ProgramBlock,
    sourceLine: string,
    line: number,
    diagnostics: MilkdropDiagnostic[],
  ) => void;
  resolveRuntimeGlobals: (args: {
    numericFields: Record<string, number>;
    programs: MilkdropPresetIR['programs'];
  }) => Record<string, number>;
  isHardUnsupportedFieldBlocking: (
    field: PendingHardUnsupportedField,
    runtimeGlobals: Record<string, number>,
  ) => boolean;
};

type ShaderAssemblyHelpers = {
  extractShaderControls: (shaderText: string | null) => ShaderControlAnalysis;
  mergeShaderControlAnalysis: (
    warpAnalysis: ShaderControlAnalysis,
    compAnalysis: ShaderControlAnalysis,
  ) => {
    controls: MilkdropShaderControls;
    expressions: MilkdropPresetIR['shaderText']['controlExpressions'];
  };
  buildShaderProgramPayload: (args: {
    stage: 'warp' | 'comp';
    statements: MilkdropShaderStatement[];
    normalizedLines: string[];
    requiresControlFallback: boolean;
    supportedBackends: Array<'webgl' | 'webgpu'>;
  }) => NonNullable<MilkdropPresetIR['shaderText']['warpProgram']>;
  normalizeBlockedConstructValue: (value: string) => string;
  buildUnsupportedVolumeSamplerWarnings: (
    controls: MilkdropShaderControls,
  ) => string[];
};

type CompatibilityAssemblyHelpers = {
  buildBlockingConstructDetails: (args: {
    sourceId?: string;
    ignoredFields: string[];
    hardUnsupportedFields: Map<string, HardUnsupportedFieldSpec>;
    approximatedShaderLines: string[];
  }) => MilkdropParityReport['blockingConstructDetails'];
  collectExpressionsFromValue: (
    value: unknown,
    parsedExpressions: MilkdropExpressionNode[],
  ) => void;
  collectExpressionCompatibilityGaps: (
    parsedExpressions: MilkdropExpressionNode[],
    assignedTargets: Set<string>,
  ) => string[];
  buildBackendSupport: typeof buildBackendSupport;
  createBackendEvidence: Parameters<
    typeof buildBackendSupport
  >[0]['createBackendEvidence'];
  buildFeatureAnalysis: typeof buildFeatureAnalysis;
  buildWebGpuDescriptorPlan: typeof buildWebGpuDescriptorPlan;
  buildBackendDivergence: (
    backends: MilkdropPresetIR['compatibility']['backends'],
  ) => string[];
  buildVisualFallbacks: (args: {
    approximatedShaderLines: string[];
    webgl: MilkdropPresetIR['compatibility']['backends']['webgl'];
    webgpu: MilkdropPresetIR['compatibility']['backends']['webgpu'];
  }) => string[];
  buildDegradationReasons: (args: {
    blockedConstructDetails: MilkdropParityReport['blockingConstructDetails'];
    backendDivergence: string[];
    visualFallbacks: string[];
    webgl: MilkdropPresetIR['compatibility']['backends']['webgl'];
    webgpu: MilkdropPresetIR['compatibility']['backends']['webgpu'];
  }) => MilkdropDegradationReason[];
  buildCompatibilityEvidence: (args: {
    diagnostics: MilkdropDiagnostic[];
    visualEvidenceTier: MilkdropParityReport['visualEvidenceTier'];
  }) => MilkdropParityReport['evidence'];
  classifyFidelity: (args: {
    blockedConstructDetails: MilkdropParityReport['blockingConstructDetails'];
    degradationReasons: MilkdropDegradationReason[];
    webgl: MilkdropPresetIR['compatibility']['backends']['webgl'];
    webgpu: MilkdropPresetIR['compatibility']['backends']['webgpu'];
    noBlockedConstructs: boolean;
  }) => MilkdropParityReport['fidelityClass'];
  toBlockedFieldConstruct: (key: string) => string;
  toBlockedShaderConstruct: (line: string) => string;
};

export function createMilkdropIr({
  ast,
  diagnostics,
  source = {},
  defaultState,
  metadataKeys,
  shaderFieldPattern,
  maxCustomWaves,
  maxCustomShapes,
  featureOrder,
  backendPartialFeatureGaps,
  backendShaderTextGaps,
  lowerGpuFieldProgram,
  hasLegacyMotionVectorControls,
  analyzeProgramRegisters,
  hasProgramStatements,
  programHelpers,
  fieldHelpers,
  shaderHelpers,
  compatibilityHelpers,
}: {
  ast: MilkdropPresetAST;
  diagnostics: MilkdropDiagnostic[];
  source?: Partial<MilkdropPresetSource>;
  defaultState: Record<string, number>;
  metadataKeys: Set<string>;
  shaderFieldPattern: RegExp;
  maxCustomWaves: number;
  maxCustomShapes: number;
  featureOrder: Parameters<typeof buildFeatureAnalysis>[0]['featureOrder'];
  backendPartialFeatureGaps: Parameters<
    typeof buildBackendSupport
  >[0]['backendPartialFeatureGaps'];
  backendShaderTextGaps: Parameters<
    typeof buildBackendSupport
  >[0]['backendShaderTextGaps'];
  lowerGpuFieldProgram: Parameters<
    typeof buildWebGpuDescriptorPlan
  >[0]['lowerGpuFieldProgram'];
  hasLegacyMotionVectorControls: Parameters<
    typeof buildFeatureAnalysis
  >[0]['hasLegacyMotionVectorControls'];
  analyzeProgramRegisters: Parameters<
    typeof buildFeatureAnalysis
  >[0]['analyzeProgramRegisters'];
  hasProgramStatements: Parameters<
    typeof buildFeatureAnalysis
  >[0]['hasProgramStatements'];
  programHelpers: ProgramAssemblyHelpers;
  fieldHelpers: FieldAssemblyHelpers;
  shaderHelpers: ShaderAssemblyHelpers;
  compatibilityHelpers: CompatibilityAssemblyHelpers;
}): MilkdropPresetIR {
  const numericFields = { ...defaultState };
  const stringFields: Record<string, string> = {};
  const parsedExpressions: MilkdropExpressionNode[] = [];
  const assignedTargets = new Set<string>();
  const programs = {
    init: programHelpers.createProgramBlock(),
    perFrame: programHelpers.createProgramBlock(),
    perPixel: programHelpers.createProgramBlock(),
  };
  const customWaveMap = new Map<number, MilkdropWaveDefinition>();
  const customShapeMap = new Map<number, MilkdropShapeDefinition>();
  const softUnknownKeys = new Set<string>();
  const hardUnsupportedFields = new Map<string, HardUnsupportedFieldSpec>();
  const pendingHardUnsupportedFields = new Map<
    string,
    PendingHardUnsupportedField
  >();
  const pendingProgramSources = new Map<
    ProgramBlock,
    { sourceLine: string; line: number }
  >();
  let unsupportedShaderText = false;
  let supportedShaderText = false;
  let warpShaderText: string | null = null;
  let compShaderText: string | null = null;

  ast.fields.forEach((field) => {
    if (
      programHelpers.compileProgramsFromField(
        field,
        programs,
        customWaveMap,
        customShapeMap,
        diagnostics,
        pendingProgramSources,
      )
    ) {
      return;
    }

    const normalizedKey = fieldHelpers.normalizeFieldKey(field);
    if (normalizedKey === null) {
      return;
    }

    const hardUnsupportedField =
      fieldHelpers.getHardUnsupportedField(normalizedKey);

    if (metadataKeys.has(normalizedKey)) {
      stringFields[normalizedKey] = fieldHelpers.normalizeString(
        field.rawValue,
      );
      return;
    }

    if (shaderFieldPattern.test(normalizedKey)) {
      const rawValue = fieldHelpers.normalizeShaderFieldChunk(field.rawValue);
      if (!rawValue) {
        return;
      }
      if (
        normalizedKey === 'warp_shader' ||
        normalizedKey === 'warp_code' ||
        normalizedKey.startsWith('warp_')
      ) {
        warpShaderText = warpShaderText
          ? `${warpShaderText}; ${rawValue}`
          : rawValue;
      } else {
        compShaderText = compShaderText
          ? `${compShaderText}; ${rawValue}`
          : rawValue;
      }
      return;
    }

    const customWaveFieldMatch = normalizedKey.match(
      /^custom_wave_(\d+)_(.+)$/u,
    );
    if (customWaveFieldMatch) {
      const index = Number.parseInt(customWaveFieldMatch[1] ?? '0', 10);
      const suffix = customWaveFieldMatch[2] ?? '';
      if (index < 1 || index > maxCustomWaves) {
        softUnknownKeys.add(normalizedKey);
        return;
      }
      const compiledScalar = fieldHelpers.compileScalarField(
        field,
        diagnostics,
      );
      if (compiledScalar.value === null) {
        fieldHelpers.addDiagnostic(
          diagnostics,
          'error',
          'preset_invalid_scalar',
          `Could not parse a numeric value for "${normalizedKey}".`,
          {
            line: field.line,
            field: normalizedKey,
          },
        );
        return;
      }
      if (compiledScalar.expression) {
        parsedExpressions.push(compiledScalar.expression);
      }
      numericFields[normalizedKey] = compiledScalar.value;
      fieldHelpers.ensureWaveDefinition(customWaveMap, index).fields[suffix] =
        compiledScalar.value;
      return;
    }

    const customShapeFieldMatch = normalizedKey.match(/^shape_(\d+)_(.+)$/u);
    if (customShapeFieldMatch) {
      const index = Number.parseInt(customShapeFieldMatch[1] ?? '0', 10);
      const suffix = customShapeFieldMatch[2] ?? '';
      if (index < 1 || index > maxCustomShapes) {
        softUnknownKeys.add(normalizedKey);
        return;
      }
      if (!(normalizedKey in defaultState)) {
        if (hardUnsupportedField) {
          pendingHardUnsupportedFields.set(normalizedKey, {
            key: normalizedKey,
            feature: hardUnsupportedField.feature,
            message: hardUnsupportedField.message,
            line: field.line,
          });
          return;
        }
        softUnknownKeys.add(normalizedKey);
        fieldHelpers.addDiagnostic(
          diagnostics,
          'warning',
          'preset_unknown_field',
          `Unknown preset field "${normalizedKey}" was ignored.`,
          {
            line: field.line,
            field: normalizedKey,
          },
        );
        return;
      }
      const compiledScalar = fieldHelpers.compileScalarField(
        field,
        diagnostics,
      );
      if (compiledScalar.value === null) {
        fieldHelpers.addDiagnostic(
          diagnostics,
          'error',
          'preset_invalid_scalar',
          `Could not parse a numeric value for "${normalizedKey}".`,
          {
            line: field.line,
            field: normalizedKey,
          },
        );
        return;
      }
      if (compiledScalar.expression) {
        parsedExpressions.push(compiledScalar.expression);
      }
      numericFields[normalizedKey] = compiledScalar.value;
      fieldHelpers.ensureShapeDefinition(customShapeMap, index).fields[suffix] =
        compiledScalar.value;
      return;
    }

    if (!(normalizedKey in defaultState)) {
      if (hardUnsupportedField) {
        pendingHardUnsupportedFields.set(normalizedKey, {
          key: normalizedKey,
          feature: hardUnsupportedField.feature,
          message: hardUnsupportedField.message,
          line: field.line,
        });
        return;
      }
      softUnknownKeys.add(normalizedKey);
      fieldHelpers.addDiagnostic(
        diagnostics,
        'warning',
        'preset_unknown_field',
        `Unknown preset field "${normalizedKey}" was ignored.`,
        {
          line: field.line,
          field: normalizedKey,
        },
      );
      return;
    }

    const compiledScalar = fieldHelpers.compileScalarField(field, diagnostics);
    if (compiledScalar.value === null) {
      fieldHelpers.addDiagnostic(
        diagnostics,
        'error',
        'preset_invalid_scalar',
        `Could not parse a numeric value for "${normalizedKey}".`,
        {
          line: field.line,
          field: normalizedKey,
        },
      );
      return;
    }
    if (compiledScalar.expression) {
      parsedExpressions.push(compiledScalar.expression);
    }
    numericFields[normalizedKey] =
      normalizedKey === 'video_echo_orientation'
        ? fieldHelpers.normalizeVideoEchoOrientation(compiledScalar.value)
        : compiledScalar.value;
  });

  pendingProgramSources.forEach(({ sourceLine, line }, block) => {
    fieldHelpers.pushProgramStatement(block, sourceLine, line, diagnostics);
  });

  const runtimeGlobals = fieldHelpers.resolveRuntimeGlobals({
    numericFields,
    programs,
  });

  pendingHardUnsupportedFields.forEach((pendingField, normalizedKey) => {
    if (
      !fieldHelpers.isHardUnsupportedFieldBlocking(pendingField, runtimeGlobals)
    ) {
      return;
    }
    hardUnsupportedFields.set(normalizedKey, {
      key: normalizedKey,
      feature: pendingField.feature,
      message: pendingField.message,
    });
    fieldHelpers.addDiagnostic(
      diagnostics,
      'warning',
      'preset_unsupported_field',
      `Unsupported MilkDrop feature "${pendingField.feature}" uses preset field "${normalizedKey}". ${pendingField.message}`,
      {
        line: pendingField.line,
        field: normalizedKey,
      },
    );
  });

  const customWaves = [...customWaveMap.values()].sort(
    (left, right) => left.index - right.index,
  );
  const customShapes = [...customShapeMap.values()].sort(
    (left, right) => left.index - right.index,
  );
  const shaderWarpAnalysis =
    shaderHelpers.extractShaderControls(warpShaderText);
  const shaderCompAnalysis =
    shaderHelpers.extractShaderControls(compShaderText);
  const mergedShaderControls = shaderHelpers.mergeShaderControlAnalysis(
    shaderWarpAnalysis,
    shaderCompAnalysis,
  );
  const warpShaderProgram =
    shaderWarpAnalysis.directProgramStatements.length > 0
      ? shaderHelpers.buildShaderProgramPayload({
          stage: 'warp',
          statements: shaderWarpAnalysis.directProgramStatements,
          normalizedLines: shaderWarpAnalysis.directProgramLines,
          requiresControlFallback:
            shaderWarpAnalysis.directProgramStatements.length !==
            shaderWarpAnalysis.statements.length,
          supportedBackends:
            shaderWarpAnalysis.unsupportedLines.length === 0
              ? ['webgl', 'webgpu']
              : [],
        })
      : null;
  const compShaderProgram =
    shaderCompAnalysis.directProgramStatements.length > 0
      ? shaderHelpers.buildShaderProgramPayload({
          stage: 'comp',
          statements: shaderCompAnalysis.directProgramStatements,
          normalizedLines: shaderCompAnalysis.directProgramLines,
          requiresControlFallback:
            shaderCompAnalysis.directProgramStatements.length !==
            shaderCompAnalysis.statements.length,
          supportedBackends:
            shaderCompAnalysis.unsupportedLines.length === 0
              ? ['webgl', 'webgpu']
              : [],
        })
      : null;
  const ignoredFields = [
    ...new Set([...softUnknownKeys, ...hardUnsupportedFields.keys()]),
  ].sort();
  const approximatedShaderLines = [
    ...shaderWarpAnalysis.unsupportedLines,
    ...shaderCompAnalysis.unsupportedLines,
  ].map(shaderHelpers.normalizeBlockedConstructValue);
  const blockingConstructDetails =
    compatibilityHelpers.buildBlockingConstructDetails({
      sourceId: source.id,
      ignoredFields,
      hardUnsupportedFields,
      approximatedShaderLines,
    });
  compatibilityHelpers.collectExpressionsFromValue(
    mergedShaderControls.expressions,
    parsedExpressions,
  );
  for (const block of [
    programs.init,
    programs.perFrame,
    programs.perPixel,
    ...customWaves.flatMap((wave) => [
      wave.programs.init,
      wave.programs.perFrame,
      wave.programs.perPoint,
    ]),
    ...customShapes.flatMap((shape) => [
      shape.programs.init,
      shape.programs.perFrame,
    ]),
  ]) {
    for (const statement of block.statements) {
      assignedTargets.add(statement.target);
      parsedExpressions.push(statement.expression);
    }
  }
  const missingAliasesOrFunctions =
    compatibilityHelpers.collectExpressionCompatibilityGaps(
      parsedExpressions,
      assignedTargets,
    );
  const hasShaderText = Boolean(warpShaderText || compShaderText);
  const hasBlockingShaderApproximation = blockingConstructDetails.some(
    (construct) => construct.kind === 'shader' && !construct.allowlisted,
  );
  supportedShaderText =
    shaderWarpAnalysis.supported ||
    shaderCompAnalysis.supported ||
    (hasShaderText && !hasBlockingShaderApproximation);
  unsupportedShaderText = hasBlockingShaderApproximation;
  if (unsupportedShaderText) {
    fieldHelpers.addDiagnostic(
      diagnostics,
      'warning',
      'preset_unsupported_shader_text',
      'Shader-text sections include lines outside the supported subset.',
    );
  }
  const shaderTextExecution: MilkdropFeatureAnalysis['shaderTextExecution'] =
    hasShaderText
      ? unsupportedShaderText
        ? { webgl: 'unsupported', webgpu: 'unsupported' }
        : {
            webgl:
              warpShaderProgram || compShaderProgram ? 'direct' : 'translated',
            webgpu:
              (warpShaderProgram === null ||
                warpShaderProgram.execution.supportedBackends.includes(
                  'webgpu',
                )) &&
              (compShaderProgram === null ||
                compShaderProgram.execution.supportedBackends.includes(
                  'webgpu',
                ))
                ? warpShaderProgram || compShaderProgram
                  ? 'direct'
                  : 'translated'
                : 'translated',
          }
      : { webgl: 'none', webgpu: 'none' };
  const featureAnalysis = compatibilityHelpers.buildFeatureAnalysis({
    programs,
    customWaves,
    customShapes,
    numericFields: runtimeGlobals,
    unsupportedShaderText,
    supportedShaderText,
    shaderTextExecution,
    featureOrder,
    analyzeProgramRegisters,
    hasProgramStatements,
    hasLegacyMotionVectorControls,
  });
  const sharedWarnings = [
    ...[...softUnknownKeys].map(
      (key) => `Unknown preset field "${key}" was ignored.`,
    ),
    ...[...hardUnsupportedFields.values()].map(
      ({ key, feature, message }) =>
        `Unsupported feature "${feature}" from preset field "${key}": ${message}`,
    ),
  ];
  const unsupportedVolumeSamplerWarnings =
    shaderHelpers.buildUnsupportedVolumeSamplerWarnings(
      mergedShaderControls.controls,
    );
  unsupportedVolumeSamplerWarnings.forEach((message) => {
    fieldHelpers.addDiagnostic(
      diagnostics,
      'warning',
      'preset_shader_volume_approximation',
      message,
    );
  });
  const backends = {
    webgl: compatibilityHelpers.buildBackendSupport({
      backend: 'webgl',
      featureAnalysis,
      sharedWarnings,
      softUnknownKeys: [...softUnknownKeys],
      hardUnsupportedFields: [...hardUnsupportedFields.values()],
      unsupportedVolumeSamplerWarnings,
      createBackendEvidence: compatibilityHelpers.createBackendEvidence,
      backendPartialFeatureGaps,
      backendShaderTextGaps,
    }),
    webgpu: compatibilityHelpers.buildBackendSupport({
      backend: 'webgpu',
      featureAnalysis,
      sharedWarnings,
      softUnknownKeys: [...softUnknownKeys],
      hardUnsupportedFields: [...hardUnsupportedFields.values()],
      unsupportedVolumeSamplerWarnings,
      createBackendEvidence: compatibilityHelpers.createBackendEvidence,
      backendPartialFeatureGaps,
      backendShaderTextGaps,
    }),
  };
  const blockedConstructs = [
    ...ignoredFields.map(compatibilityHelpers.toBlockedFieldConstruct),
    ...approximatedShaderLines.map(
      compatibilityHelpers.toBlockedShaderConstruct,
    ),
  ];
  const finalBackends = backends;
  const backendDivergence =
    compatibilityHelpers.buildBackendDivergence(finalBackends);
  const visualFallbacks = compatibilityHelpers.buildVisualFallbacks({
    approximatedShaderLines,
    webgl: finalBackends.webgl,
    webgpu: finalBackends.webgpu,
  });
  const degradationReasons = compatibilityHelpers.buildDegradationReasons({
    blockedConstructDetails: blockingConstructDetails,
    backendDivergence,
    visualFallbacks,
    webgl: finalBackends.webgl,
    webgpu: finalBackends.webgpu,
  });
  const visualEvidenceTier =
    blockedConstructs.length > 0
      ? 'compile'
      : backendDivergence.length > 0 || visualFallbacks.length > 0
        ? 'runtime'
        : 'visual';
  const evidence = compatibilityHelpers.buildCompatibilityEvidence({
    diagnostics,
    visualEvidenceTier,
  });
  const fidelityClass = compatibilityHelpers.classifyFidelity({
    blockedConstructDetails: blockingConstructDetails,
    degradationReasons,
    webgl: finalBackends.webgl,
    webgpu: finalBackends.webgpu,
    noBlockedConstructs: blockedConstructs.length === 0,
  });

  const parity: MilkdropParityReport = {
    ignoredFields,
    approximatedShaderLines,
    missingAliasesOrFunctions,
    backendDivergence,
    visualFallbacks,
    blockedConstructs,
    blockingConstructDetails,
    degradationReasons,
    fidelityClass,
    evidence,
    visualEvidenceTier,
  };

  const title = stringFields.title || 'MilkDrop Session';
  const author = stringFields.author;
  const description = stringFields.description;

  const post = {
    brighten: (numericFields.brighten ?? 0) > 0.5,
    darken: (numericFields.darken ?? 0) > 0.5,
    solarize: (numericFields.solarize ?? 0) > 0.5,
    invert: (numericFields.invert ?? 0) > 0.5,
    shaderEnabled: (numericFields.shader ?? 1) > 0.5,
    textureWrap: (numericFields.texture_wrap ?? 0) > 0.5,
    feedbackTexture: (numericFields.feedback_texture ?? 0) > 0.5,
    outerBorderStyle: (numericFields.ob_border ?? 0) > 0.5,
    innerBorderStyle: (numericFields.ib_border ?? 0) > 0.5,
    shaderControls: mergedShaderControls.controls,
    shaderControlExpressions: mergedShaderControls.expressions,
    shaderPrograms: {
      warp: warpShaderProgram,
      comp: compShaderProgram,
    },
    gammaAdj: numericFields.gammaadj ?? 1,
    videoEchoEnabled: (numericFields.video_echo_enabled ?? 0) > 0.5,
    videoEchoAlpha: numericFields.video_echo_alpha ?? 0,
    videoEchoZoom: numericFields.video_echo_zoom ?? 1,
    videoEchoOrientation: fieldHelpers.normalizeVideoEchoOrientation(
      numericFields.video_echo_orientation ?? 0,
    ),
  };
  const gpuDescriptorPlans = {
    webgpu: compatibilityHelpers.buildWebGpuDescriptorPlan({
      featureAnalysis,
      webgpu: finalBackends.webgpu,
      numericFields,
      programs,
      customWaves,
      post,
      lowerGpuFieldProgram,
      hasLegacyMotionVectorControls,
    }),
  };

  const compatibility = {
    backends: finalBackends,
    gpuDescriptorPlans,
    parity,
    featureAnalysis,
    warnings: [
      ...new Set([
        ...sharedWarnings,
        ...finalBackends.webgl.reasons,
        ...finalBackends.webgpu.reasons,
      ]),
    ],
    blockingReasons: [
      ...new Set(
        [
          ...finalBackends.webgl.reasons,
          ...finalBackends.webgpu.reasons,
        ].filter(Boolean),
      ),
    ],
    supportedFeatures: featureAnalysis.featuresUsed,
    unsupportedKeys: ignoredFields,
    softUnknownKeys: [...softUnknownKeys],
    hardUnsupportedKeys: [...hardUnsupportedFields.keys()],
    webgl: finalBackends.webgl.status === 'supported',
    webgpu: finalBackends.webgpu.status === 'supported',
  };

  const globals = Object.fromEntries(
    Object.entries(numericFields).filter(([key]) => {
      return (
        !key.startsWith('wave_') &&
        !key.startsWith('shape_') &&
        !key.startsWith('custom_wave_') &&
        !key.startsWith('ob_') &&
        !key.startsWith('ib_') &&
        key !== 'brighten' &&
        key !== 'darken' &&
        key !== 'darken_center' &&
        key !== 'solarize' &&
        key !== 'invert' &&
        key !== 'gammaadj' &&
        key !== 'video_echo_enabled' &&
        key !== 'video_echo_alpha' &&
        key !== 'video_echo_zoom' &&
        key !== 'video_echo_orientation'
      );
    }),
  );

  const mainWave = Object.fromEntries(
    Object.entries(numericFields).filter(([key]) => key.startsWith('wave_')),
  );

  return {
    title,
    author,
    description,
    numericFields,
    stringFields,
    programs,
    globals,
    mainWave,
    customWaves,
    customShapes,
    shaderText: {
      warp: warpShaderText,
      comp: compShaderText,
      warpAst: shaderWarpAnalysis.statements,
      compAst: shaderCompAnalysis.statements,
      warpProgram: warpShaderProgram,
      compProgram: compShaderProgram,
      supported: supportedShaderText && !unsupportedShaderText,
      unsupportedLines: approximatedShaderLines,
      controls: mergedShaderControls.controls,
      controlExpressions: mergedShaderControls.expressions,
    },
    borders: {
      outer: {
        size: numericFields.ob_size,
        r: numericFields.ob_r,
        g: numericFields.ob_g,
        b: numericFields.ob_b,
        a: numericFields.ob_a,
      },
      inner: {
        size: numericFields.ib_size,
        r: numericFields.ib_r,
        g: numericFields.ib_g,
        b: numericFields.ib_b,
        a: numericFields.ib_a,
      },
    },
    post: {
      brighten: (numericFields.brighten ?? 0) > 0.5,
      darken: (numericFields.darken ?? 0) > 0.5,
      darkenCenter: (numericFields.darken_center ?? 0) > 0.5,
      solarize: (numericFields.solarize ?? 0) > 0.5,
      invert: (numericFields.invert ?? 0) > 0.5,
      shaderEnabled: (numericFields.shader ?? 1) > 0.5,
      textureWrap: (numericFields.texture_wrap ?? 0) > 0.5,
      feedbackTexture: (numericFields.feedback_texture ?? 0) > 0.5,
      outerBorderStyle: (numericFields.ob_border ?? 0) > 0.5,
      innerBorderStyle: (numericFields.ib_border ?? 0) > 0.5,
      shaderControls: mergedShaderControls.controls,
      shaderControlExpressions: mergedShaderControls.expressions,
      shaderPrograms: {
        warp: warpShaderProgram,
        comp: compShaderProgram,
      },
      gammaAdj: numericFields.gammaadj ?? 1,
      videoEchoEnabled: (numericFields.video_echo_enabled ?? 0) > 0.5,
      videoEchoAlpha: numericFields.video_echo_alpha ?? 0,
      videoEchoZoom: numericFields.video_echo_zoom ?? 1,
      videoEchoOrientation: fieldHelpers.normalizeVideoEchoOrientation(
        numericFields.video_echo_orientation ?? 0,
      ),
    },
    compatibility,
  } satisfies MilkdropPresetIR;
}
