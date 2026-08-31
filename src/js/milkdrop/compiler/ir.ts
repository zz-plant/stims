/**
 * Assembles the compiled intermediate representation a preset runs from.
 *
 * Everything upstream (parsing, shader analysis, field lowering) produces
 * fragments; this module is where they become one `MilkdropPresetIR` and where
 * the preset's *compatibility verdict* is decided — which backends can run it,
 * which features degrade, and the fidelity class the parity pipeline reports.
 *
 * `createMilkdropIr` takes its analysis passes as injected helpers rather than
 * importing them. That keeps the assembly order readable in one place and lets
 * the compiler tests drive individual passes without standing up the whole
 * front end.
 *
 * A blocked construct here is not a crash: it is recorded as a degradation
 * reason and the preset still runs with that feature disabled. Presets in the
 * wild routinely use constructs no backend supports, and refusing to load them
 * would be worse than rendering them imperfectly.
 */
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
  MilkdropSemanticSupport,
  MilkdropShaderControls,
  MilkdropShaderStatement,
  MilkdropShapeDefinition,
  MilkdropVideoEchoOrientation,
  MilkdropVisualCertification,
  MilkdropWaveDefinition,
} from '../types';
import { foldProgramBlock } from './ast-constant-fold.ts';
import { buildParityReport } from './compatibility-report.ts';
import { extractCustomSamplerDeclarations } from './custom-samplers';
import type { buildWebGpuDescriptorPlan } from './gpu-descriptor-plan';
import type {
  buildBackendSupport,
  buildFeatureAnalysis,
  HardUnsupportedFieldSpec,
} from './parity';
import { flattenProgramStatements } from './program-assembly';
import { extractNativeShaderBody } from './shader-analysis';
import { isMilkdropShaderProgramBackendExecutable } from './shader-execution-classification';

export type PendingHardUnsupportedField = HardUnsupportedFieldSpec & {
  line: number;
};

const POST_PASS_EPSILON = 0.0001;
const DEFAULT_PROJECTM_GAMMA_ADJ = 2;

function hasNonNeutralShaderControls(controls: MilkdropShaderControls) {
  return (
    Math.abs(controls.warpScale) > POST_PASS_EPSILON ||
    Math.abs(controls.offsetX) > POST_PASS_EPSILON ||
    Math.abs(controls.offsetY) > POST_PASS_EPSILON ||
    Math.abs(controls.rotation) > POST_PASS_EPSILON ||
    Math.abs(controls.zoom - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.saturation - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.contrast - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.colorScale.r - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.colorScale.g - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.colorScale.b - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.hueShift) > POST_PASS_EPSILON ||
    Math.abs(controls.mixAlpha) > POST_PASS_EPSILON ||
    Math.abs(controls.brightenBoost) > POST_PASS_EPSILON ||
    Math.abs(controls.invertBoost) > POST_PASS_EPSILON ||
    Math.abs(controls.solarizeBoost) > POST_PASS_EPSILON ||
    Math.abs(controls.tint.r - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.tint.g - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.tint.b - 1) > POST_PASS_EPSILON ||
    controls.textureLayer.source !== 'none' ||
    controls.textureLayer.mode !== 'none' ||
    controls.textureLayer.sampleDimension !== '2d' ||
    controls.textureLayer.inverted ||
    Math.abs(controls.textureLayer.amount) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.scaleX - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.scaleY - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.offsetX) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.offsetY) > POST_PASS_EPSILON ||
    Math.abs(controls.textureLayer.volumeSliceZ ?? 0) > POST_PASS_EPSILON ||
    controls.warpTexture.source !== 'none' ||
    controls.warpTexture.sampleDimension !== '2d' ||
    Math.abs(controls.warpTexture.amount) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.scaleX - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.scaleY - 1) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.offsetX) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.offsetY) > POST_PASS_EPSILON ||
    Math.abs(controls.warpTexture.volumeSliceZ ?? 0) > POST_PASS_EPSILON
  );
}

type ProgramBlock = MilkdropPresetIR['programs']['init'];

type ShaderControlAnalysis = {
  statements: MilkdropShaderStatement[];
  directProgramStatements: MilkdropShaderStatement[];
  directProgramLines: string[];
  directProgramRequired: boolean;
  unsupportedLines: string[];
  supported: boolean;
  controls: MilkdropShaderControls;
  expressions: MilkdropPresetIR['shaderText']['controlExpressions'];
  hasNativeBody: boolean;
  nativeBodyUnparsedLines: string[];
};

/**
 * Builds the direct-execution shader program payload for one stage (warp or
 * comp). Both stages go through the same translation/fallback logic, so the
 * two near-identical call sites share this single builder.
 */
function buildShaderProgramForStage(
  shaderHelpers: Pick<ShaderAssemblyHelpers, 'buildShaderProgramPayload'>,
  analysis: ShaderControlAnalysis,
  stage: 'warp' | 'comp',
  shaderText: string | null,
  hasTranslatedDirectStatements: boolean,
) {
  if (!analysis.directProgramRequired) {
    return null;
  }
  return shaderHelpers.buildShaderProgramPayload({
    stage,
    statements: analysis.directProgramStatements,
    normalizedLines: analysis.directProgramLines,
    requiresControlFallback:
      !hasTranslatedDirectStatements ||
      analysis.directProgramStatements.length !== analysis.statements.length,
    supportedBackends:
      hasTranslatedDirectStatements &&
      (analysis.hasNativeBody
        ? analysis.nativeBodyUnparsedLines.length === 0
        : analysis.unsupportedLines.length === 0)
        ? analysis.hasNativeBody
          ? (['webgpu'] as const)
          : (['webgl', 'webgpu'] as const)
        : [],
    rawGlsl:
      analysis.hasNativeBody || !hasTranslatedDirectStatements
        ? analysis.hasNativeBody
          ? (extractNativeShaderBody(shaderText ?? '') ??
            analysis.directProgramLines
              .map((line) => (line.endsWith(';') ? line : `${line};`))
              .join('\n'))
          : analysis.directProgramLines
              .map((line) => (line.endsWith(';') ? line : `${line};`))
              .join('\n')
        : undefined,
  });
}

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
  isMilkdropMetadataFieldKey: (field: MilkdropPresetField) => boolean;
  resolveMilkdropMetadataKey: (field: MilkdropPresetField) => string | null;
};

type ShaderAssemblyHelpers = {
  extractShaderControls: (
    shaderText: string | null,
    env?: Record<string, number>,
  ) => ShaderControlAnalysis;
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
    rawGlsl?: string;
  }) => NonNullable<MilkdropPresetIR['shaderText']['warpProgram']>;
  normalizeBlockedConstructValue: (value: string) => string;
  buildUnsupportedVolumeSamplerWarnings: (
    controls: MilkdropShaderControls,
  ) => string[];
  usesVolumeTextureControls: (controls: MilkdropShaderControls) => boolean;
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
  aspect,
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
  aspect?: number;
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

    if (fieldHelpers.isMilkdropMetadataFieldKey(field)) {
      const metadataKey = fieldHelpers.resolveMilkdropMetadataKey(field);
      if (metadataKey) {
        stringFields[metadataKey] = fieldHelpers.normalizeString(
          field.rawValue,
        );
      }
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
          ? `${warpShaderText} ${rawValue}`
          : rawValue;
      } else {
        compShaderText = compShaderText
          ? `${compShaderText} ${rawValue}`
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
      if (hardUnsupportedField) {
        pendingHardUnsupportedFields.set(normalizedKey, {
          key: normalizedKey,
          feature: hardUnsupportedField.feature,
          message: hardUnsupportedField.message,
          line: field.line,
        });
      }
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
    if (hardUnsupportedField) {
      pendingHardUnsupportedFields.set(normalizedKey, {
        key: normalizedKey,
        feature: hardUnsupportedField.feature,
        message: hardUnsupportedField.message,
        line: field.line,
      });
    }
  });

  pendingProgramSources.forEach(({ sourceLine, line }, block) => {
    fieldHelpers.pushProgramStatement(block, sourceLine, line, diagnostics);
  });

  // Compile-time constant folding: collapse literal arithmetic (e.g.
  // `aspect * 2` → literal), fold all-literal pure-intrinsic calls (e.g.
  // `abs(-1.5)` → `1.5`), and reduce algebraic identities (`x*1` → `x`,
  // `x+0` → `x`). Applied here — after statement assembly but before the
  // descriptor planner and WGSL/JIT emission — so every downstream tier
  // (CPU interpreter, CPU JIT, WGSL compute VM, per-pixel field planner)
  // consumes the simplified tree.
  for (const key of ['init', 'perFrame', 'perPixel'] as const) {
    programs[key] = foldProgramBlock(programs[key]);
  }

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
  const shaderEnv = Number.isFinite(aspect)
    ? { aspect: aspect as number }
    : undefined;
  const shaderWarpAnalysis = shaderHelpers.extractShaderControls(
    warpShaderText,
    shaderEnv,
  );
  const shaderCompAnalysis = shaderHelpers.extractShaderControls(
    compShaderText,
    shaderEnv,
  );
  const mergedShaderControls = shaderHelpers.mergeShaderControlAnalysis(
    shaderWarpAnalysis,
    shaderCompAnalysis,
  );
  const warpHasTranslatedDirectStatements =
    shaderWarpAnalysis.directProgramStatements.length > 0;
  const compHasTranslatedDirectStatements =
    shaderCompAnalysis.directProgramStatements.length > 0;
  const warpShaderProgram = buildShaderProgramForStage(
    shaderHelpers,
    shaderWarpAnalysis,
    'warp',
    warpShaderText,
    warpHasTranslatedDirectStatements,
  );
  const compShaderProgram = buildShaderProgramForStage(
    shaderHelpers,
    shaderCompAnalysis,
    'comp',
    compShaderText,
    compHasTranslatedDirectStatements,
  );
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
  // Shader-control expressions are intentionally NOT fed into the unknown-
  // identifier gap check below: they carry HLSL-style temp declarations with
  // their own resolution environment, so EEL scoping rules would flag false
  // positives. The check covers the expression-VM programs, where an unknown
  // identifier really does evaluate to 0.
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
    for (const statement of flattenProgramStatements(block.statements)) {
      assignedTargets.add(statement.target);
      parsedExpressions.push(statement.expression);
    }
  }
  const missingAliasesOrFunctions =
    compatibilityHelpers.collectExpressionCompatibilityGaps(
      parsedExpressions,
      assignedTargets,
    );
  // The expression VM evaluates unrecognized functions and aliases to 0 at
  // runtime, which silently distorts the preset. Surface each gap as a
  // diagnostic so the report reflects it instead of claiming exact fidelity.
  missingAliasesOrFunctions.forEach((name) => {
    fieldHelpers.addDiagnostic(
      diagnostics,
      'warning',
      'preset_expression_unknown_function',
      `Expression references unknown function or variable "${name}", which evaluates to 0 at runtime.`,
    );
  });
  const hasShaderText = Boolean(warpShaderText || compShaderText);
  const hasBlockingShaderApproximation = blockingConstructDetails.some(
    (construct) => construct.kind === 'shader' && !construct.allowlisted,
  );
  const hasDirectShaderPrograms =
    warpShaderProgram !== null || compShaderProgram !== null;
  const webglCanRelyOnTranslatedShaderControls =
    (warpShaderProgram === null ||
      warpShaderProgram.execution.requiresControlFallback) &&
    (compShaderProgram === null ||
      compShaderProgram.execution.requiresControlFallback);
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
  const webglCanExecuteDirect =
    hasDirectShaderPrograms &&
    (warpShaderProgram === null ||
      isMilkdropShaderProgramBackendExecutable(warpShaderProgram, 'webgl')) &&
    (compShaderProgram === null ||
      isMilkdropShaderProgramBackendExecutable(compShaderProgram, 'webgl'));
  const webgpuCanExecuteDirect =
    hasDirectShaderPrograms &&
    (warpShaderProgram === null ||
      isMilkdropShaderProgramBackendExecutable(warpShaderProgram, 'webgpu')) &&
    (compShaderProgram === null ||
      isMilkdropShaderProgramBackendExecutable(compShaderProgram, 'webgpu'));
  const shaderTextExecution: MilkdropFeatureAnalysis['shaderTextExecution'] =
    hasShaderText
      ? unsupportedShaderText
        ? { webgl: 'unsupported', webgpu: 'unsupported' }
        : {
            webgl: hasDirectShaderPrograms
              ? webglCanExecuteDirect
                ? 'direct'
                : webglCanRelyOnTranslatedShaderControls
                  ? 'translated'
                  : 'unsupported'
              : 'translated',
            webgpu: hasDirectShaderPrograms
              ? webgpuCanExecuteDirect
                ? 'direct'
                : 'translated'
              : 'translated',
          }
      : { webgl: 'none', webgpu: 'none' };
  const unsupportedVolumeSamplerWarnings =
    shaderHelpers.buildUnsupportedVolumeSamplerWarnings(
      mergedShaderControls.controls,
    );
  const featureAnalysis = compatibilityHelpers.buildFeatureAnalysis({
    programs,
    customWaves,
    customShapes,
    numericFields: runtimeGlobals,
    volumeTexturesUsed: shaderHelpers.usesVolumeTextureControls(
      mergedShaderControls.controls,
    ),
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
  const customSamplers = [
    ...extractCustomSamplerDeclarations(warpShaderText),
    ...extractCustomSamplerDeclarations(compShaderText),
    ...extractCustomSamplerDeclarations(ast.source),
  ].filter(
    (sampler, index, samplers) =>
      samplers.findIndex((candidate) => candidate.name === sampler.name) ===
      index,
  );
  customSamplers
    .filter((sampler) => sampler.textureFile === null)
    .forEach((sampler) => {
      fieldHelpers.addDiagnostic(
        diagnostics,
        'warning',
        'preset_missing_custom_sampler_texture',
        `Custom shader sampler "${sampler.name}" does not match a bundled MilkDrop texture asset.`,
      );
    });
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
      missingAliasesOrFunctions,
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
      missingAliasesOrFunctions,
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
  const semanticSupport: MilkdropSemanticSupport = {
    fidelityClass,
    evidence,
    visualEvidenceTier,
  };
  const visualCertification: MilkdropVisualCertification = {
    status: 'uncertified',
    measured: false,
    source: 'inferred',
    fidelityClass:
      fidelityClass === 'exact' || fidelityClass === 'near-exact'
        ? 'partial'
        : fidelityClass,
    visualEvidenceTier:
      visualEvidenceTier === 'visual' ? 'runtime' : visualEvidenceTier,
    requiredBackend: 'webgpu',
    actualBackend: null,
    reasons: ['No measured WebGPU reference capture is recorded yet.'],
  };

  const parity: MilkdropParityReport = buildParityReport({
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
    semanticSupport,
    visualCertification,
  });

  const title = stringFields.title || 'MilkDrop Session';
  const author = stringFields.author;
  const description = stringFields.description;

  const brighten = (numericFields.brighten ?? 0) > 0.5;
  const darken = (numericFields.darken ?? 0) > 0.5;
  const darkenCenter = (numericFields.darken_center ?? 0) > 0.5;
  const solarize = (numericFields.solarize ?? 0) > 0.5;
  const invert = (numericFields.invert ?? 0) > 0.5;
  const videoEchoEnabled =
    (numericFields.video_echo_enabled ?? 0) > 0.5 ||
    (numericFields.video_echo_alpha ?? 0) > 0;
  const redBlueStereo =
    (numericFields.red_blue_stereo ?? numericFields.redbluestereo ?? 0) > 0.5;
  const gammaAdj = numericFields.gammaadj ?? 1;
  const shaderEnabled =
    (numericFields.shader ?? 1) > 0.5 ||
    videoEchoEnabled ||
    brighten ||
    darken ||
    darkenCenter ||
    solarize ||
    invert ||
    redBlueStereo ||
    Math.abs(gammaAdj - DEFAULT_PROJECTM_GAMMA_ADJ) > POST_PASS_EPSILON ||
    warpShaderText !== null ||
    compShaderText !== null ||
    warpShaderProgram !== null ||
    compShaderProgram !== null ||
    hasNonNeutralShaderControls(mergedShaderControls.controls);

  const post = {
    brighten,
    darken,
    darkenCenter,
    solarize,
    invert,
    shaderEnabled,
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
    gammaAdj,
    videoEchoEnabled,
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
      programs,
      customWaves,
      post,
      lowerGpuFieldProgram,
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

  const perPixelStatements =
    programs.perPixel.statements.length > 0
      ? programs.perPixel.statements.map((s) => ({
          target: s.target,
          source: s.source,
          expression: s.expression,
        }))
      : null;
  const customShapeIndices = new Set(customShapes.map((shape) => shape.index));

  return {
    title,
    author,
    description,
    numericFields,
    stringFields,
    programs,
    perPixelStatements,
    globals,
    mainWave,
    customWaves,
    customShapes,
    customShapeIndices,
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
      customSamplers,
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
    post,
    compatibility,
  } satisfies MilkdropPresetIR;
}
