/**
 * milkdrop-toolchain: parse, compile, analyze, format and export MilkDrop
 * `.milk` presets.
 *
 * This is the curated entry point. Every module under `src/` is also reachable
 * through the `milkdrop-toolchain/src/*` export for callers that need an
 * internal seam (the IR builder, the EEL function table, the GLSL emitter's
 * pieces, and so on).
 */

export type {
  MilkdropBuiltinDoc,
  MilkdropBuiltinGroup,
  MilkdropBuiltinKind,
} from './builtin-docs.ts';
export {
  MILKDROP_BUILTIN_DOCS,
  MILKDROP_FUNCTION_SNIPPET_TEMPLATES,
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
  MILKDROP_Q_REGISTER_COUNT,
  MILKDROP_REGISTER_WORD_PATTERN,
  MILKDROP_T_REGISTER_COUNT,
  milkdropVariableNames,
} from './builtin-docs.ts';
export {
  buildBackendDivergence,
  buildBlockingConstructDetails,
  buildCompatibilityEvidence,
  buildDegradationReasons,
  buildVisualFallbacks,
  classifyFidelity,
} from './compiler/compatibility.ts';
export type { BuildParityReportOptions } from './compiler/compatibility-report.ts';
export { buildParityReport } from './compiler/compatibility-report.ts';
export { createIR, createPresetSource } from './compiler/core.ts';
export {
  createDefaultCustomWaveSlot,
  createDefaultShapeSlot,
  MAX_CUSTOM_SHAPES,
  MAX_CUSTOM_WAVES,
} from './compiler/default-state.ts';
export type {
  EelBinaryOperatorSpec,
  EelEvalHelpers,
  EelFunctionSpec,
  EelUnaryOperatorSpec,
} from './compiler/eel-function-table.ts';
export {
  EEL_BINARY_OPERATORS,
  EEL_FUNCTIONS,
  EEL_UNARY_OPERATORS,
  evaluateEelCall,
  getEelFunctionSpec,
  toMilkdropInt,
} from './compiler/eel-function-table.ts';
export { createMilkdropIr } from './compiler/ir.ts';
export {
  clearShaderAnalysisCaches,
  extractNativeShaderBody,
  extractShaderControls,
  normalizeHlslToGlsl,
  splitShaderGlobalsAndBody,
} from './compiler/shader-analysis.ts';
export {
  createCompositeGlslEmitter,
  generateGlslFromShaderStatements,
  generateShaderVariantTag,
  injectDirectShaderGlsl,
} from './compiler/shader-analysis-glsl.ts';
export {
  desugarShaderBranches,
  isShaderBranchDesugarEnabled,
  setShaderBranchDesugarEnabled,
} from './compiler/shader-branch-desugar.ts';
export type { WgslProgramCompilation } from './compiler/wgsl-generator.ts';
export {
  buildWgslExpressionString,
  compileProgramToWgsl,
} from './compiler/wgsl-generator.ts';
// --- Fields -> IR (the compiler) -----------------------------------------
export {
  clearCompiledPresetCache,
  compileMilkdropPresetSource,
  DEFAULT_MILKDROP_STATE,
  evaluateMilkdropShaderControlExpressions,
  evaluateMilkdropShaderControlProgram,
  getCompiledPresetCacheSize,
  warmupCompiledPresetCache,
} from './compiler.ts';
// --- EEL2 expressions: parse, evaluate, JIT, WGSL -------------------------
export {
  evaluateMilkdropExpression,
  findNearestMatch,
  MILKDROP_EEL_CLOSE_FACTOR,
  MILKDROP_INTRINSIC_FUNCTIONS,
  MILKDROP_INTRINSIC_IDENTIFIERS,
  parseMilkdropExpression,
  parseMilkdropStatement,
  splitMilkdropStatements,
  walkMilkdropExpression,
} from './expression.ts';
export type { MilkdropProgramFn } from './expression-jit.ts';
export {
  compileMilkdropProgram,
  MILKDROP_GMEGABUF_SIZE,
  MILKDROP_MEGABUF_SIZE,
  prewarmMilkdropPrograms,
} from './expression-jit.ts';
export {
  aliasMap,
  normalizeFieldSuffix,
  normalizeProgramAssignmentTarget,
  resolveMilkdropIdentifier,
} from './field-normalization.ts';
export type { MilkdropFieldSpec } from './field-table.ts';
export {
  buildFieldAliasMap,
  editorFieldKey,
  IGNORED_FIELD_SPELLINGS,
  MILKDROP_FIELDS,
  MILKDROP2_FIELD_PAIRS,
  SHAPE_FIELD_ALIASES,
} from './field-table.ts';
export type { MidiGutterEntry } from './formatter.ts';
// --- Formatting, editing and export of preset text -----------------------
export {
  computeMidiGutterInfo,
  emitProgramLines,
  FALLBACK_TITLE,
  findMilkdropEquationLine,
  findMilkdropFieldLine,
  formatMilkdropPreset,
  formatNumber,
  getFieldOverwriteKind,
  isFieldShadowedByEquations,
  readMilkdropField,
  resolveFormattedTitle,
  resolveShaderText,
  serializeString,
  upsertMilkdropField,
  upsertMilkdropFields,
} from './formatter.ts';
export {
  exportMilkdrop2Preset,
  MILKDROP2_STIMS_KEYS,
} from './milkdrop2-export.ts';
export type {
  MilkdropParityAllowlist,
  MilkdropParityAllowlistEntry,
} from './parity-allowlist.ts';
export {
  isMilkdropParityConstructAllowlisted,
  loadMilkdropParityAllowlist,
} from './parity-allowlist.ts';
export type { PresetDataflow, VariableDataflow } from './preset-dataflow.ts';
// --- Static analysis -----------------------------------------------------
export {
  analyzePresetDataflow,
  controlAudio,
  dataflowSignature,
  drawnPartAudio,
  frameValueName,
} from './preset-dataflow.ts';
export {
  embedLineageFields,
  isLineageFieldKey,
  lineageFieldLines,
  lineageFromFields,
} from './preset-lineage-fields.ts';
export type { PresetMathAnalysis } from './preset-math-analyzer.ts';
export { analyzePresetMath } from './preset-math-analyzer.ts';
// --- Preset text -> fields ------------------------------------------------
export { parseMilkdropPreset } from './preset-parser.ts';
export type {
  PresetSyntaxKind,
  PresetSyntaxLine,
  PresetSyntaxTree,
} from './preset-syntax.ts';
export {
  fieldAssignments,
  isShaderSection,
  MAX_SYNTAX_LINE_CHARS,
  parsePresetSyntax,
  printPresetSyntax,
  splitInlineComment,
} from './preset-syntax.ts';
// --- HLSL shader text: parse, analyze, GLSL ------------------------------
export {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from './shader-ast.ts';
export type { MilkdropShaderExecutionMode } from './shader-execution-mode.ts';
export {
  describeShaderApproximation,
  isShaderApproximated,
  resolveShaderExecutionMode,
} from './shader-execution-mode.ts';
export {
  classifyTex3dSamplerEquivalence,
  getMilkdropShaderAuxTextureSourceId,
  isMilkdropShaderSamplerName,
  isMilkdropVolumeShaderSamplerName,
  MILKDROP_SHADER_AUX_TEXTURE_SOURCE_IDS,
  MILKDROP_SHADER_TEXTURE_SAMPLERS,
  normalizeMilkdropShaderSamplerName,
  TEX3D_NOT_EQUIVALENT_SAMPLERS,
} from './shader-samplers.ts';
export type { MilkdropShaderSource } from './shader-source.ts';
export { ensureShaderBody, extractShaderSource } from './shader-source.ts';
export type { ShaderStage, ShaderTranslation } from './shader-translation.ts';
export {
  describeExecutionMode,
  describeShaderTranslations,
} from './shader-translation.ts';
export {
  CUSTOM_TEXTURE_FILES,
  MILKDROP_TEXTURE_FILES,
} from './texture-files.ts';
// --- Types ---------------------------------------------------------------
export type * from './types.ts';
export type {
  MilkdropGpuVmSignals,
  MilkdropViewportSignalValues,
  MilkdropWgslSignalField,
} from './wgsl-signal-layout.ts';
export {
  deriveMilkdropViewportSignalValues,
  MILKDROP_WGSL_SIGNAL_ALIAS_MAP,
  MILKDROP_WGSL_SIGNAL_FIELDS,
} from './wgsl-signal-layout.ts';
