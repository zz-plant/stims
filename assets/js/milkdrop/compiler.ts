import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
  parseMilkdropStatement,
  splitMilkdropStatements,
} from './expression';
import { formatMilkdropPreset } from './formatter';
import { parseMilkdropPreset } from './preset-parser';
import type {
  MilkdropCompatibilityReport,
  MilkdropCompiledPreset,
  MilkdropDiagnostic,
  MilkdropExpressionNode,
  MilkdropPresetAST,
  MilkdropPresetField,
  MilkdropPresetIR,
  MilkdropPresetSource,
  MilkdropProgramBlock,
} from './types';

export const DEFAULT_MILKDROP_STATE: Record<string, number> = {
  fRating: 3,
  beat_sensitivity: 0.7,
  blend_duration: 2.4,
  decay: 0.93,
  zoom: 1,
  rot: 0,
  warp: 0.08,
  wave_mode: 0,
  wave_scale: 1,
  wave_smoothing: 0.72,
  wave_a: 0.86,
  wave_r: 0.35,
  wave_g: 0.7,
  wave_b: 1,
  wave_x: 0.5,
  wave_y: 0.5,
  wave_mystery: 0.18,
  wave_thick: 1.4,
  wave_additive: 1,
  wave_usedots: 0,
  wave_brighten: 1,
  mesh_density: 18,
  mesh_alpha: 0.22,
  mesh_r: 0.3,
  mesh_g: 0.5,
  mesh_b: 0.95,
  bg_r: 0.02,
  bg_g: 0.03,
  bg_b: 0.06,
  echo_alpha: 0.18,
  shape_1_enabled: 1,
  shape_1_sides: 6,
  shape_1_x: 0.5,
  shape_1_y: 0.5,
  shape_1_rad: 0.17,
  shape_1_ang: 0,
  shape_1_a: 0.24,
  shape_1_r: 1,
  shape_1_g: 0.48,
  shape_1_b: 0.84,
  shape_1_border_a: 0.86,
  shape_1_border_r: 1,
  shape_1_border_g: 0.8,
  shape_1_border_b: 1,
  shape_1_additive: 1,
  shape_1_thickoutline: 1,
};

const metadataKeys = new Set(['title', 'author', 'description']);
const programFieldPattern = /^(init|per_frame|per_pixel)_(\d+)$/u;
const shapeSectionPattern = /^shape_(\d+)$/u;
const presetSectionNames = new Set(['preset', 'preset00']);
const waveformSectionNames = new Set(['waveform', 'wave']);
const webgpuBlockingKeys = new Set([
  'video_echo',
  'texture_wrap',
  'feedback_texture',
]);
const aliasMap: Record<string, string | null> = {
  milkdrop_preset_version: null,
  frating: 'fRating',
  fgammaadj: null,
  fdecay: 'decay',
  fvideoechozoom: null,
  fvideoechoalpha: 'echo_alpha',
  fwavealpha: 'wave_a',
  fwavescale: 'wave_scale',
  fwavesmoothing: 'wave_smoothing',
  fmodwavealphastart: null,
  fmodwavealphaend: null,
  fwarpscale: 'warp',
  fwarpanimspeed: null,
  fzoomexponent: 'zoom',
  fshader: null,
  fbrighten: 'wave_brighten',
  fdarken: null,
  fsolarize: null,
  finvert: null,
  fwaveparam: 'wave_mystery',
  fwaver: 'wave_r',
  fwaveg: 'wave_g',
  fwaveb: 'wave_b',
  fwavex: 'wave_x',
  fwavey: 'wave_y',
  fbeatsensitivity: 'beat_sensitivity',
  fblendtimeseconds: 'blend_duration',
  fouterbordersize: null,
  fouterborderr: null,
  fouterborderg: null,
  fouterborderb: null,
  finnerbordersize: null,
  finnerborderr: null,
  finnerborderg: null,
  finnerborderb: null,
  video_echo: 'video_echo',
};

function defaultSourceId(rawTitle: string) {
  return (
    rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'milkdrop-preset'
  );
}

function normalizeString(rawValue: string) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function compileScalarField(
  field: MilkdropPresetField,
  diagnostics: MilkdropDiagnostic[],
): { value: number | null; expression?: MilkdropExpressionNode } {
  const numeric = Number(field.rawValue.trim());
  if (Number.isFinite(numeric)) {
    return { value: numeric };
  }

  const expressionResult = parseMilkdropExpression(field.rawValue, field.line);
  diagnostics.push(...expressionResult.diagnostics);
  if (!expressionResult.value) {
    return { value: null };
  }

  return {
    value: evaluateMilkdropExpression(
      expressionResult.value,
      DEFAULT_MILKDROP_STATE,
    ),
    expression: expressionResult.value,
  };
}

function programBlock(): MilkdropProgramBlock {
  return {
    statements: [],
    sourceLines: [],
  };
}

function normalizeFieldKey(field: MilkdropPresetField) {
  const rawKey = field.key.trim().toLowerCase();
  if (field.section) {
    if (waveformSectionNames.has(field.section)) {
      return `wave_${rawKey}`;
    }
    if (shapeSectionPattern.test(field.section)) {
      return `${field.section}_${rawKey}`;
    }
    if (presetSectionNames.has(field.section)) {
      return rawKey;
    }
  }

  if (rawKey in aliasMap) {
    return aliasMap[rawKey];
  }
  if (rawKey === 'shapethickoutline') {
    return 'shape_1_thickoutline';
  }
  return rawKey;
}

function pushProgramStatement(
  block: MilkdropProgramBlock,
  sourceLine: string,
  line: number,
  diagnostics: MilkdropDiagnostic[],
) {
  const statements = splitMilkdropStatements(sourceLine);
  statements.forEach((statement) => {
    const parsed = parseMilkdropStatement(statement, line);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value) {
      block.statements.push(parsed.value);
      block.sourceLines.push(statement);
    }
  });
}

function compileProgramsFromField(
  field: MilkdropPresetField,
  programs: MilkdropPresetIR['programs'],
  diagnostics: MilkdropDiagnostic[],
) {
  if (field.section === 'init') {
    pushProgramStatement(
      programs.init,
      `${field.key.trim()} = ${field.rawValue.trim()}`,
      field.line,
      diagnostics,
    );
    return true;
  }

  if (field.section === 'per_frame') {
    pushProgramStatement(
      programs.perFrame,
      `${field.key.trim()} = ${field.rawValue.trim()}`,
      field.line,
      diagnostics,
    );
    return true;
  }

  if (field.section === 'per_pixel') {
    pushProgramStatement(
      programs.perPixel,
      `${field.key.trim()} = ${field.rawValue.trim()}`,
      field.line,
      diagnostics,
    );
    return true;
  }

  const match = field.key.trim().toLowerCase().match(programFieldPattern);
  if (!match) {
    return false;
  }

  const [, rawProgramName] = match;
  const block =
    rawProgramName === 'init'
      ? programs.init
      : rawProgramName === 'per_frame'
        ? programs.perFrame
        : programs.perPixel;
  pushProgramStatement(block, field.rawValue, field.line, diagnostics);
  return true;
}

function buildCompatibilityReport(
  unsupportedKeys: string[],
  programs: MilkdropPresetIR['programs'],
): MilkdropCompatibilityReport {
  const warnings = unsupportedKeys.length
    ? unsupportedKeys.map(
        (key) => `Unsupported preset field "${key}" was ignored.`,
      )
    : [];
  const blockingReasons: string[] = [];

  if (unsupportedKeys.some((key) => webgpuBlockingKeys.has(key))) {
    blockingReasons.push(
      'This preset references feedback or texture features that are not available in the WebGPU adapter yet.',
    );
  }

  const supportedFeatures = ['waveform', 'shapes', 'mesh', 'editor'];
  if (programs.init.statements.length > 0) {
    supportedFeatures.push('init-equations');
  }
  if (programs.perFrame.statements.length > 0) {
    supportedFeatures.push('per-frame-equations');
  }
  if (programs.perPixel.statements.length > 0) {
    supportedFeatures.push('per-pixel-equations');
  }

  return {
    webgl: blockingReasons.length === 0,
    webgpu: blockingReasons.length === 0,
    warnings,
    blockingReasons,
    supportedFeatures,
    unsupportedKeys,
  };
}

function createPresetSource(
  source: Partial<MilkdropPresetSource>,
  raw: string,
  title: string,
  author?: string,
): MilkdropPresetSource {
  const resolvedTitle = source.title?.trim() || title;
  return {
    id: source.id ?? defaultSourceId(resolvedTitle),
    title: resolvedTitle,
    raw,
    origin: source.origin ?? 'draft',
    author: source.author ?? author,
    fileName: source.fileName,
    path: source.path,
    updatedAt: source.updatedAt ?? Date.now(),
  };
}

function createIR(ast: MilkdropPresetAST, diagnostics: MilkdropDiagnostic[]) {
  const numericFields = { ...DEFAULT_MILKDROP_STATE };
  const stringFields: Record<string, string> = {};
  const programs = {
    init: programBlock(),
    perFrame: programBlock(),
    perPixel: programBlock(),
  };
  const unsupportedKeys: string[] = [];

  ast.fields.forEach((field) => {
    if (compileProgramsFromField(field, programs, diagnostics)) {
      return;
    }

    const normalizedKey = normalizeFieldKey(field);
    if (normalizedKey === null) {
      return;
    }

    if (metadataKeys.has(normalizedKey)) {
      stringFields[normalizedKey] = normalizeString(field.rawValue);
      return;
    }

    if (!(normalizedKey in DEFAULT_MILKDROP_STATE)) {
      unsupportedKeys.push(normalizedKey);
      diagnostics.push({
        severity: 'warning',
        code: 'preset_unsupported_field',
        line: field.line,
        field: normalizedKey,
        message: `Unsupported preset field "${normalizedKey}" was ignored.`,
      });
      return;
    }

    const compiledScalar = compileScalarField(field, diagnostics);
    if (compiledScalar.value === null) {
      diagnostics.push({
        severity: 'error',
        code: 'preset_invalid_scalar',
        line: field.line,
        field: normalizedKey,
        message: `Could not parse a numeric value for "${normalizedKey}".`,
      });
      return;
    }
    numericFields[normalizedKey] = compiledScalar.value;
  });

  const title = stringFields.title || 'MilkDrop Session';
  const author = stringFields.author;
  const description = stringFields.description;
  const compatibility = buildCompatibilityReport(unsupportedKeys, programs);

  return {
    title,
    author,
    description,
    numericFields,
    stringFields,
    programs,
    compatibility,
  } satisfies MilkdropPresetIR;
}

export function compileMilkdropPresetSource(
  raw: string,
  source: Partial<MilkdropPresetSource> = {},
): MilkdropCompiledPreset {
  const parsed = parseMilkdropPreset(raw);
  const diagnostics = [...parsed.diagnostics];
  const ir = createIR(parsed.ast, diagnostics);
  const presetSource = createPresetSource(source, raw, ir.title, ir.author);

  const compiled: MilkdropCompiledPreset = {
    source: presetSource,
    ast: parsed.ast,
    ir,
    diagnostics,
    formattedSource: '',
    title: ir.title,
    author: ir.author,
  };

  compiled.formattedSource = formatMilkdropPreset(compiled);
  return compiled;
}
