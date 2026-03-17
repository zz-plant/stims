import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
  parseMilkdropStatement,
  splitMilkdropStatements,
  walkMilkdropExpression,
} from './expression';
import { formatMilkdropPreset } from './formatter';
import { parseMilkdropPreset } from './preset-parser';
import type {
  MilkdropBackendSupport,
  MilkdropCompiledPreset,
  MilkdropDiagnostic,
  MilkdropDiagnosticSeverity,
  MilkdropExpressionNode,
  MilkdropFeatureAnalysis,
  MilkdropFeatureKey,
  MilkdropPresetAST,
  MilkdropPresetField,
  MilkdropPresetIR,
  MilkdropPresetSource,
  MilkdropProgramBlock,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from './types';

const MAX_CUSTOM_WAVES = 8;
const MAX_CUSTOM_SHAPES = 8;

export const DEFAULT_MILKDROP_STATE: Record<string, number> = {
  fRating: 3,
  beat_sensitivity: 0.7,
  blend_duration: 2.4,
  decay: 0.93,
  zoom: 1,
  rot: 0,
  warp: 0.08,
  warpanimspeed: 1,
  shader: 1,
  modwavealphastart: 1,
  modwavealphaend: 1,
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
  brighten: 0,
  darken: 0,
  solarize: 0,
  invert: 0,
  gammaadj: 1,
  video_echo_enabled: 0,
  video_echo_alpha: 0.18,
  video_echo_zoom: 1.02,
  ob_size: 0,
  ob_r: 0.92,
  ob_g: 0.96,
  ob_b: 1,
  ob_a: 0.8,
  ib_size: 0,
  ib_r: 0.92,
  ib_g: 0.96,
  ib_b: 1,
  ib_a: 0.76,
  texture_wrap: 0,
  feedback_texture: 0,
  ob_border: 0,
  ib_border: 0,
  motion_vectors: 0,
  motion_vectors_x: 16,
  motion_vectors_y: 12,
  mv_r: 1,
  mv_g: 1,
  mv_b: 1,
  mv_a: 0.35,
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
  shape_1_a2: 0,
  shape_1_r2: 0,
  shape_1_g2: 0,
  shape_1_b2: 0,
  shape_1_border_a: 0.86,
  shape_1_border_r: 1,
  shape_1_border_g: 0.8,
  shape_1_border_b: 1,
  shape_1_additive: 1,
  shape_1_thickoutline: 1,
  shape_2_enabled: 0,
  shape_2_sides: 5,
  shape_2_x: 0.5,
  shape_2_y: 0.5,
  shape_2_rad: 0.12,
  shape_2_ang: 0,
  shape_2_a: 0.18,
  shape_2_r: 0.8,
  shape_2_g: 0.5,
  shape_2_b: 1,
  shape_2_a2: 0,
  shape_2_r2: 0,
  shape_2_g2: 0,
  shape_2_b2: 0,
  shape_2_border_a: 0.78,
  shape_2_border_r: 0.9,
  shape_2_border_g: 0.9,
  shape_2_border_b: 1,
  shape_2_additive: 0,
  shape_2_thickoutline: 0,
  shape_3_enabled: 0,
  shape_3_sides: 4,
  shape_3_x: 0.5,
  shape_3_y: 0.5,
  shape_3_rad: 0.1,
  shape_3_ang: 0,
  shape_3_a: 0.16,
  shape_3_r: 1,
  shape_3_g: 0.7,
  shape_3_b: 0.4,
  shape_3_a2: 0,
  shape_3_r2: 0,
  shape_3_g2: 0,
  shape_3_b2: 0,
  shape_3_border_a: 0.7,
  shape_3_border_r: 1,
  shape_3_border_g: 0.9,
  shape_3_border_b: 0.5,
  shape_3_additive: 0,
  shape_3_thickoutline: 0,
  shape_4_enabled: 0,
  shape_4_sides: 8,
  shape_4_x: 0.5,
  shape_4_y: 0.5,
  shape_4_rad: 0.09,
  shape_4_ang: 0,
  shape_4_a: 0.14,
  shape_4_r: 0.6,
  shape_4_g: 0.85,
  shape_4_b: 1,
  shape_4_a2: 0,
  shape_4_r2: 0,
  shape_4_g2: 0,
  shape_4_b2: 0,
  shape_4_border_a: 0.7,
  shape_4_border_r: 0.75,
  shape_4_border_g: 0.95,
  shape_4_border_b: 1,
  shape_4_additive: 0,
  shape_4_thickoutline: 0,
  shape_5_enabled: 0,
  shape_5_sides: 7,
  shape_5_x: 0.5,
  shape_5_y: 0.5,
  shape_5_rad: 0.08,
  shape_5_ang: 0,
  shape_5_a: 0.14,
  shape_5_r: 1,
  shape_5_g: 0.8,
  shape_5_b: 0.45,
  shape_5_a2: 0,
  shape_5_r2: 0,
  shape_5_g2: 0,
  shape_5_b2: 0,
  shape_5_border_a: 0.72,
  shape_5_border_r: 1,
  shape_5_border_g: 0.9,
  shape_5_border_b: 0.6,
  shape_5_additive: 0,
  shape_5_thickoutline: 0,
  shape_6_enabled: 0,
  shape_6_sides: 3,
  shape_6_x: 0.5,
  shape_6_y: 0.5,
  shape_6_rad: 0.07,
  shape_6_ang: 0,
  shape_6_a: 0.13,
  shape_6_r: 0.8,
  shape_6_g: 1,
  shape_6_b: 0.55,
  shape_6_a2: 0,
  shape_6_r2: 0,
  shape_6_g2: 0,
  shape_6_b2: 0,
  shape_6_border_a: 0.7,
  shape_6_border_r: 0.9,
  shape_6_border_g: 1,
  shape_6_border_b: 0.7,
  shape_6_additive: 0,
  shape_6_thickoutline: 0,
  shape_7_enabled: 0,
  shape_7_sides: 9,
  shape_7_x: 0.5,
  shape_7_y: 0.5,
  shape_7_rad: 0.06,
  shape_7_ang: 0,
  shape_7_a: 0.12,
  shape_7_r: 0.7,
  shape_7_g: 0.9,
  shape_7_b: 1,
  shape_7_a2: 0,
  shape_7_r2: 0,
  shape_7_g2: 0,
  shape_7_b2: 0,
  shape_7_border_a: 0.68,
  shape_7_border_r: 0.8,
  shape_7_border_g: 0.95,
  shape_7_border_b: 1,
  shape_7_additive: 0,
  shape_7_thickoutline: 0,
  shape_8_enabled: 0,
  shape_8_sides: 5,
  shape_8_x: 0.5,
  shape_8_y: 0.5,
  shape_8_rad: 0.05,
  shape_8_ang: 0,
  shape_8_a: 0.1,
  shape_8_r: 1,
  shape_8_g: 0.65,
  shape_8_b: 0.9,
  shape_8_a2: 0,
  shape_8_r2: 0,
  shape_8_g2: 0,
  shape_8_b2: 0,
  shape_8_border_a: 0.66,
  shape_8_border_r: 1,
  shape_8_border_g: 0.75,
  shape_8_border_b: 0.95,
  shape_8_additive: 0,
  shape_8_thickoutline: 0,
  custom_wave_1_enabled: 0,
  custom_wave_1_samples: 64,
  custom_wave_1_spectrum: 0,
  custom_wave_1_additive: 0,
  custom_wave_1_usedots: 0,
  custom_wave_1_scaling: 1,
  custom_wave_1_smoothing: 0.5,
  custom_wave_1_mystery: 0,
  custom_wave_1_thick: 1,
  custom_wave_1_x: 0.5,
  custom_wave_1_y: 0.5,
  custom_wave_1_r: 1,
  custom_wave_1_g: 1,
  custom_wave_1_b: 1,
  custom_wave_1_a: 0.4,
  custom_wave_2_enabled: 0,
  custom_wave_2_samples: 64,
  custom_wave_2_spectrum: 0,
  custom_wave_2_additive: 0,
  custom_wave_2_usedots: 0,
  custom_wave_2_scaling: 1,
  custom_wave_2_smoothing: 0.5,
  custom_wave_2_mystery: 0,
  custom_wave_2_thick: 1,
  custom_wave_2_x: 0.5,
  custom_wave_2_y: 0.5,
  custom_wave_2_r: 1,
  custom_wave_2_g: 1,
  custom_wave_2_b: 1,
  custom_wave_2_a: 0.4,
  custom_wave_3_enabled: 0,
  custom_wave_3_samples: 64,
  custom_wave_3_spectrum: 0,
  custom_wave_3_additive: 0,
  custom_wave_3_usedots: 0,
  custom_wave_3_scaling: 1,
  custom_wave_3_smoothing: 0.5,
  custom_wave_3_mystery: 0,
  custom_wave_3_thick: 1,
  custom_wave_3_x: 0.5,
  custom_wave_3_y: 0.5,
  custom_wave_3_r: 1,
  custom_wave_3_g: 1,
  custom_wave_3_b: 1,
  custom_wave_3_a: 0.4,
  custom_wave_4_enabled: 0,
  custom_wave_4_samples: 64,
  custom_wave_4_spectrum: 0,
  custom_wave_4_additive: 0,
  custom_wave_4_usedots: 0,
  custom_wave_4_scaling: 1,
  custom_wave_4_smoothing: 0.5,
  custom_wave_4_mystery: 0,
  custom_wave_4_thick: 1,
  custom_wave_4_x: 0.5,
  custom_wave_4_y: 0.5,
  custom_wave_4_r: 1,
  custom_wave_4_g: 1,
  custom_wave_4_b: 1,
  custom_wave_4_a: 0.4,
  custom_wave_5_enabled: 0,
  custom_wave_5_samples: 64,
  custom_wave_5_spectrum: 0,
  custom_wave_5_additive: 0,
  custom_wave_5_usedots: 0,
  custom_wave_5_scaling: 1,
  custom_wave_5_smoothing: 0.5,
  custom_wave_5_mystery: 0,
  custom_wave_5_thick: 1,
  custom_wave_5_x: 0.5,
  custom_wave_5_y: 0.5,
  custom_wave_5_r: 1,
  custom_wave_5_g: 1,
  custom_wave_5_b: 1,
  custom_wave_5_a: 0.4,
  custom_wave_6_enabled: 0,
  custom_wave_6_samples: 64,
  custom_wave_6_spectrum: 0,
  custom_wave_6_additive: 0,
  custom_wave_6_usedots: 0,
  custom_wave_6_scaling: 1,
  custom_wave_6_smoothing: 0.5,
  custom_wave_6_mystery: 0,
  custom_wave_6_thick: 1,
  custom_wave_6_x: 0.5,
  custom_wave_6_y: 0.5,
  custom_wave_6_r: 1,
  custom_wave_6_g: 1,
  custom_wave_6_b: 1,
  custom_wave_6_a: 0.4,
  custom_wave_7_enabled: 0,
  custom_wave_7_samples: 64,
  custom_wave_7_spectrum: 0,
  custom_wave_7_additive: 0,
  custom_wave_7_usedots: 0,
  custom_wave_7_scaling: 1,
  custom_wave_7_smoothing: 0.5,
  custom_wave_7_mystery: 0,
  custom_wave_7_thick: 1,
  custom_wave_7_x: 0.5,
  custom_wave_7_y: 0.5,
  custom_wave_7_r: 1,
  custom_wave_7_g: 1,
  custom_wave_7_b: 1,
  custom_wave_7_a: 0.4,
  custom_wave_8_enabled: 0,
  custom_wave_8_samples: 64,
  custom_wave_8_spectrum: 0,
  custom_wave_8_additive: 0,
  custom_wave_8_usedots: 0,
  custom_wave_8_scaling: 1,
  custom_wave_8_smoothing: 0.5,
  custom_wave_8_mystery: 0,
  custom_wave_8_thick: 1,
  custom_wave_8_x: 0.5,
  custom_wave_8_y: 0.5,
  custom_wave_8_r: 1,
  custom_wave_8_g: 1,
  custom_wave_8_b: 1,
  custom_wave_8_a: 0.4,
};

const FEATURE_ORDER: MilkdropFeatureKey[] = [
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
];

const metadataKeys = new Set(['title', 'author', 'description']);
const presetSectionNames = new Set(['preset', 'preset00']);
const waveformSectionNames = new Set(['wave', 'waveform']);
const rootProgramPattern = /^(init|per_frame|per_pixel)_(\d+)$/u;
const customWaveProgramPattern =
  /^wave_(\d+)_(init|per_frame|per_point)(\d+)?$/u;
const customShapeProgramPattern = /^shape_(\d+)_(init|per_frame)(\d+)?$/u;
const shapeSectionPattern = /^shape_(\d+)$/u;
const wavecodeFieldPattern = /^wavecode_(\d+)_(.+)$/u;
const shapecodeFieldPattern = /^shapecode_(\d+)_(.+)$/u;
const shaderFieldPattern =
  /^(?:warp_[0-9]+|comp_[0-9]+|warp_shader|comp_shader|shader_text|warp_code|comp_code)$/u;
const hardUnsupportedKeys = new Set<string>([]);

function createDefaultShaderControls(): MilkdropShaderControls {
  return {
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
  };
}

function createDefaultShaderControlExpressions(): MilkdropShaderControlExpressions {
  return {
    warpScale: null,
    offsetX: null,
    offsetY: null,
    rotation: null,
    zoom: null,
    saturation: null,
    contrast: null,
    colorScale: { r: null, g: null, b: null },
    hueShift: null,
    mixAlpha: null,
    brightenBoost: null,
    invertBoost: null,
    solarizeBoost: null,
    tint: { r: null, g: null, b: null },
  };
}

function parseShaderScalar(rawValue: string) {
  const numeric = Number(rawValue);
  if (Number.isFinite(numeric)) {
    return {
      value: numeric,
      expression: null,
    };
  }

  const expressionResult = parseMilkdropExpression(rawValue, 1);
  if (!expressionResult.value) {
    return null;
  }

  return {
    value: evaluateMilkdropExpression(
      expressionResult.value,
      DEFAULT_MILKDROP_STATE,
    ),
    expression: expressionResult.value,
  };
}

function splitShaderListValues(rawValue: string) {
  if (rawValue.includes(',')) {
    const values: string[] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < rawValue.length; index += 1) {
      const char = rawValue[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth = Math.max(depth - 1, 0);
      } else if (char === ',' && depth === 0) {
        values.push(rawValue.slice(start, index).trim());
        start = index + 1;
      }
    }

    values.push(rawValue.slice(start).trim());
    return values.filter(Boolean);
  }

  return rawValue
    .trim()
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseShaderTintList(rawValue: string) {
  const components = splitShaderListValues(rawValue)
    .slice(0, 3)
    .map((entry) => parseShaderScalar(entry));
  if (components.length < 3 || components.some((entry) => entry === null)) {
    return null;
  }
  const values = components as Array<{
    value: number;
    expression: MilkdropExpressionNode | null;
  }>;
  return {
    value: {
      r: Math.min(Math.max(values[0]?.value ?? 1, 0), 2),
      g: Math.min(Math.max(values[1]?.value ?? 1, 0), 2),
      b: Math.min(Math.max(values[2]?.value ?? 1, 0), 2),
    },
    expressions: {
      r: values[0]?.expression ?? null,
      g: values[1]?.expression ?? null,
      b: values[2]?.expression ?? null,
    },
  };
}

function extractShaderControls(shaderText: string | null) {
  const controls = createDefaultShaderControls();
  const expressions = createDefaultShaderControlExpressions();
  const unsupportedLines: string[] = [];
  if (!shaderText) {
    return { controls, expressions, unsupportedLines, supported: false };
  }

  let supportedLineCount = 0;
  const normalized = shaderText
    .split(/[\r\n;]+/u)
    .map((line) => line.trim())
    .filter(Boolean);

  normalized.forEach((line) => {
    const assignment = line.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/iu);
    if (!assignment) {
      unsupportedLines.push(line);
      return;
    }
    const key = assignment[1]?.toLowerCase() ?? '';
    const rawValue = assignment[2]?.trim() ?? '';
    const numeric = parseShaderScalar(rawValue);
    switch (key) {
      case 'warp':
      case 'warp_scale':
        if (numeric !== null) {
          controls.warpScale = numeric.value;
          expressions.warpScale = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'dx':
      case 'offset_x':
      case 'translate_x':
        if (numeric !== null) {
          controls.offsetX = numeric.value;
          expressions.offsetX = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'dy':
      case 'offset_y':
      case 'translate_y':
        if (numeric !== null) {
          controls.offsetY = numeric.value;
          expressions.offsetY = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'rot':
      case 'rotation':
        if (numeric !== null) {
          controls.rotation = numeric.value;
          expressions.rotation = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'zoom':
      case 'scale':
        if (numeric !== null) {
          controls.zoom = numeric.value;
          expressions.zoom = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'saturation':
      case 'sat':
        if (numeric !== null) {
          controls.saturation = numeric.value;
          expressions.saturation = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'contrast':
        if (numeric !== null) {
          controls.contrast = numeric.value;
          expressions.contrast = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'r':
      case 'red':
        if (numeric !== null) {
          controls.colorScale.r = numeric.value;
          expressions.colorScale.r = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'g':
      case 'green':
        if (numeric !== null) {
          controls.colorScale.g = numeric.value;
          expressions.colorScale.g = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'b':
      case 'blue':
        if (numeric !== null) {
          controls.colorScale.b = numeric.value;
          expressions.colorScale.b = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'hue':
      case 'hue_shift':
        if (numeric !== null) {
          controls.hueShift = numeric.value;
          expressions.hueShift = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'mix':
      case 'feedback':
      case 'feedback_alpha':
        if (numeric !== null) {
          controls.mixAlpha = numeric.value;
          expressions.mixAlpha = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'brighten':
        if (numeric !== null) {
          controls.brightenBoost = numeric.value;
          expressions.brightenBoost = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'invert':
        if (numeric !== null) {
          controls.invertBoost = numeric.value;
          expressions.invertBoost = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'solarize':
        if (numeric !== null) {
          controls.solarizeBoost = numeric.value;
          expressions.solarizeBoost = numeric.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'tint': {
        const tint = parseShaderTintList(rawValue);
        if (tint) {
          controls.tint = tint.value;
          expressions.tint = tint.expressions;
          supportedLineCount += 1;
          return;
        }
        break;
      }
    }
    unsupportedLines.push(line);
  });

  return {
    controls,
    expressions,
    unsupportedLines,
    supported: supportedLineCount > 0 && unsupportedLines.length === 0,
  };
}

function pickShaderScalar(
  primaryValue: number,
  primaryExpression: MilkdropExpressionNode | null,
  secondaryValue: number,
  secondaryExpression: MilkdropExpressionNode | null,
  defaultValue: number,
) {
  if (primaryExpression || primaryValue !== defaultValue) {
    return { value: primaryValue, expression: primaryExpression };
  }
  return { value: secondaryValue, expression: secondaryExpression };
}

function mergeShaderControlAnalysis(
  warpAnalysis: ReturnType<typeof extractShaderControls>,
  compAnalysis: ReturnType<typeof extractShaderControls>,
) {
  const warpScale = pickShaderScalar(
    warpAnalysis.controls.warpScale,
    warpAnalysis.expressions.warpScale,
    compAnalysis.controls.warpScale,
    compAnalysis.expressions.warpScale,
    0,
  );
  const offsetX = pickShaderScalar(
    warpAnalysis.controls.offsetX,
    warpAnalysis.expressions.offsetX,
    compAnalysis.controls.offsetX,
    compAnalysis.expressions.offsetX,
    0,
  );
  const offsetY = pickShaderScalar(
    warpAnalysis.controls.offsetY,
    warpAnalysis.expressions.offsetY,
    compAnalysis.controls.offsetY,
    compAnalysis.expressions.offsetY,
    0,
  );
  const rotation = pickShaderScalar(
    warpAnalysis.controls.rotation,
    warpAnalysis.expressions.rotation,
    compAnalysis.controls.rotation,
    compAnalysis.expressions.rotation,
    0,
  );
  const zoom = pickShaderScalar(
    warpAnalysis.controls.zoom,
    warpAnalysis.expressions.zoom,
    compAnalysis.controls.zoom,
    compAnalysis.expressions.zoom,
    1,
  );
  const saturation = pickShaderScalar(
    compAnalysis.controls.saturation,
    compAnalysis.expressions.saturation,
    warpAnalysis.controls.saturation,
    warpAnalysis.expressions.saturation,
    1,
  );
  const contrast = pickShaderScalar(
    compAnalysis.controls.contrast,
    compAnalysis.expressions.contrast,
    warpAnalysis.controls.contrast,
    warpAnalysis.expressions.contrast,
    1,
  );
  const hueShift = pickShaderScalar(
    compAnalysis.controls.hueShift,
    compAnalysis.expressions.hueShift,
    warpAnalysis.controls.hueShift,
    warpAnalysis.expressions.hueShift,
    0,
  );
  const mixAlpha = pickShaderScalar(
    compAnalysis.controls.mixAlpha,
    compAnalysis.expressions.mixAlpha,
    warpAnalysis.controls.mixAlpha,
    warpAnalysis.expressions.mixAlpha,
    0,
  );
  const brightenBoost = pickShaderScalar(
    compAnalysis.controls.brightenBoost,
    compAnalysis.expressions.brightenBoost,
    warpAnalysis.controls.brightenBoost,
    warpAnalysis.expressions.brightenBoost,
    0,
  );
  const invertBoost = pickShaderScalar(
    compAnalysis.controls.invertBoost,
    compAnalysis.expressions.invertBoost,
    warpAnalysis.controls.invertBoost,
    warpAnalysis.expressions.invertBoost,
    0,
  );
  const solarizeBoost = pickShaderScalar(
    compAnalysis.controls.solarizeBoost,
    compAnalysis.expressions.solarizeBoost,
    warpAnalysis.controls.solarizeBoost,
    warpAnalysis.expressions.solarizeBoost,
    0,
  );
  const colorScale = {
    r: pickShaderScalar(
      compAnalysis.controls.colorScale.r,
      compAnalysis.expressions.colorScale.r,
      warpAnalysis.controls.colorScale.r,
      warpAnalysis.expressions.colorScale.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.colorScale.g,
      compAnalysis.expressions.colorScale.g,
      warpAnalysis.controls.colorScale.g,
      warpAnalysis.expressions.colorScale.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.colorScale.b,
      compAnalysis.expressions.colorScale.b,
      warpAnalysis.controls.colorScale.b,
      warpAnalysis.expressions.colorScale.b,
      1,
    ),
  };
  const tint = {
    r: pickShaderScalar(
      compAnalysis.controls.tint.r,
      compAnalysis.expressions.tint.r,
      warpAnalysis.controls.tint.r,
      warpAnalysis.expressions.tint.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.tint.g,
      compAnalysis.expressions.tint.g,
      warpAnalysis.controls.tint.g,
      warpAnalysis.expressions.tint.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.tint.b,
      compAnalysis.expressions.tint.b,
      warpAnalysis.controls.tint.b,
      warpAnalysis.expressions.tint.b,
      1,
    ),
  };

  return {
    controls: {
      warpScale: warpScale.value,
      offsetX: offsetX.value,
      offsetY: offsetY.value,
      rotation: rotation.value,
      zoom: zoom.value,
      saturation: saturation.value,
      contrast: contrast.value,
      colorScale: {
        r: colorScale.r.value,
        g: colorScale.g.value,
        b: colorScale.b.value,
      },
      hueShift: hueShift.value,
      mixAlpha: mixAlpha.value,
      brightenBoost: brightenBoost.value,
      invertBoost: invertBoost.value,
      solarizeBoost: solarizeBoost.value,
      tint: {
        r: tint.r.value,
        g: tint.g.value,
        b: tint.b.value,
      },
    },
    expressions: {
      warpScale: warpScale.expression,
      offsetX: offsetX.expression,
      offsetY: offsetY.expression,
      rotation: rotation.expression,
      zoom: zoom.expression,
      saturation: saturation.expression,
      contrast: contrast.expression,
      colorScale: {
        r: colorScale.r.expression,
        g: colorScale.g.expression,
        b: colorScale.b.expression,
      },
      hueShift: hueShift.expression,
      mixAlpha: mixAlpha.expression,
      brightenBoost: brightenBoost.expression,
      invertBoost: invertBoost.expression,
      solarizeBoost: solarizeBoost.expression,
      tint: {
        r: tint.r.expression,
        g: tint.g.expression,
        b: tint.b.expression,
      },
    },
  };
}

const aliasMap: Record<string, string | null> = {
  milkdrop_preset_version: null,
  frating: 'fRating',
  fdecay: 'decay',
  fgammaadj: 'gammaadj',
  fvideoechozoom: 'video_echo_zoom',
  fvideoechoalpha: 'video_echo_alpha',
  fwavealpha: 'wave_a',
  fwavescale: 'wave_scale',
  fwavesmoothing: 'wave_smoothing',
  fmodwavealphastart: 'modwavealphastart',
  fmodwavealphaend: 'modwavealphaend',
  fwarpscale: 'warp',
  fwarpanimspeed: 'warpanimspeed',
  fzoomexponent: 'zoom',
  fshader: 'shader',
  fbrighten: 'brighten',
  fdarken: 'darken',
  fsolarize: 'solarize',
  finvert: 'invert',
  bbrighten: 'brighten',
  bdarken: 'darken',
  bsolarize: 'solarize',
  binvert: 'invert',
  fwaveparam: 'wave_mystery',
  fwaver: 'wave_r',
  fwaveg: 'wave_g',
  fwaveb: 'wave_b',
  fwavex: 'wave_x',
  fwavey: 'wave_y',
  fbeatsensitivity: 'beat_sensitivity',
  fblendtimeseconds: 'blend_duration',
  fouterbordersize: 'ob_size',
  fouterborderr: 'ob_r',
  fouterborderg: 'ob_g',
  fouterborderb: 'ob_b',
  fouterbordera: 'ob_a',
  finnerbordersize: 'ib_size',
  finnerborderr: 'ib_r',
  finnerborderg: 'ib_g',
  finnerborderb: 'ib_b',
  finnerbordera: 'ib_a',
  video_echo: 'video_echo_enabled',
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

function normalizeFieldSuffix(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_');
}

function createProgramBlock(): MilkdropProgramBlock {
  return {
    statements: [],
    sourceLines: [],
  };
}

function createWaveDefinition(index: number): MilkdropWaveDefinition {
  return {
    index,
    fields: {},
    programs: {
      init: createProgramBlock(),
      perFrame: createProgramBlock(),
      perPoint: createProgramBlock(),
    },
  };
}

function createShapeDefinition(index: number): MilkdropShapeDefinition {
  return {
    index,
    fields: {},
    programs: {
      init: createProgramBlock(),
      perFrame: createProgramBlock(),
    },
  };
}

function addDiagnostic(
  diagnostics: MilkdropDiagnostic[],
  severity: MilkdropDiagnosticSeverity,
  code: string,
  message: string,
  options: { line?: number; field?: string } = {},
) {
  diagnostics.push({
    severity,
    code,
    message,
    line: options.line,
    field: options.field,
  });
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

function getProgramBlock(
  programType: 'init' | 'per_frame' | 'per_pixel' | 'per_point',
  blocks: {
    init: MilkdropProgramBlock;
    perFrame: MilkdropProgramBlock;
    perPixel?: MilkdropProgramBlock;
    perPoint?: MilkdropProgramBlock;
  },
) {
  if (programType === 'init') {
    return blocks.init;
  }
  if (programType === 'per_frame') {
    return blocks.perFrame;
  }
  if (programType === 'per_point' && blocks.perPoint) {
    return blocks.perPoint;
  }
  if (programType === 'per_pixel' && blocks.perPixel) {
    return blocks.perPixel;
  }
  return null;
}

function normalizeFieldKey(field: MilkdropPresetField) {
  const rawKey = normalizeFieldSuffix(field.key);
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

  const wavecodeMatch = rawKey.match(wavecodeFieldPattern);
  if (wavecodeMatch) {
    const index = Number.parseInt(wavecodeMatch[1] ?? '0', 10) + 1;
    return `custom_wave_${index}_${normalizeFieldSuffix(wavecodeMatch[2] ?? '')}`;
  }

  const shapecodeMatch = rawKey.match(shapecodeFieldPattern);
  if (shapecodeMatch) {
    const index = Number.parseInt(shapecodeMatch[1] ?? '0', 10) + 1;
    return `shape_${index}_${normalizeFieldSuffix(shapecodeMatch[2] ?? '')}`;
  }

  if (rawKey in aliasMap) {
    return aliasMap[rawKey];
  }
  if (rawKey === 'shapethickoutline') {
    return 'shape_1_thickoutline';
  }
  return rawKey;
}

function ensureWaveDefinition(
  waves: Map<number, MilkdropWaveDefinition>,
  index: number,
) {
  let definition = waves.get(index);
  if (!definition) {
    definition = createWaveDefinition(index);
    waves.set(index, definition);
  }
  return definition;
}

function ensureShapeDefinition(
  shapes: Map<number, MilkdropShapeDefinition>,
  index: number,
) {
  let definition = shapes.get(index);
  if (!definition) {
    definition = createShapeDefinition(index);
    shapes.set(index, definition);
  }
  return definition;
}

function compileProgramsFromField(
  field: MilkdropPresetField,
  programs: MilkdropPresetIR['programs'],
  customWaves: Map<number, MilkdropWaveDefinition>,
  customShapes: Map<number, MilkdropShapeDefinition>,
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

  const rawKey = normalizeFieldSuffix(field.key);
  const rootMatch = rawKey.match(rootProgramPattern);
  if (rootMatch) {
    const block = getProgramBlock(
      rootMatch[1] as 'init' | 'per_frame' | 'per_pixel',
      {
        init: programs.init,
        perFrame: programs.perFrame,
        perPixel: programs.perPixel,
      },
    );
    if (block) {
      pushProgramStatement(block, field.rawValue, field.line, diagnostics);
      return true;
    }
  }

  const waveMatch = rawKey.match(customWaveProgramPattern);
  if (waveMatch) {
    const zeroIndex = Number.parseInt(waveMatch[1] ?? '0', 10);
    const index = zeroIndex + 1;
    if (index >= 1 && index <= MAX_CUSTOM_WAVES) {
      const wave = ensureWaveDefinition(customWaves, index);
      const block = getProgramBlock(
        waveMatch[2] as 'init' | 'per_frame' | 'per_point',
        {
          init: wave.programs.init,
          perFrame: wave.programs.perFrame,
          perPoint: wave.programs.perPoint,
        },
      );
      if (block) {
        pushProgramStatement(block, field.rawValue, field.line, diagnostics);
        return true;
      }
    }
  }

  const shapeMatch = rawKey.match(customShapeProgramPattern);
  if (shapeMatch) {
    const zeroIndex = Number.parseInt(shapeMatch[1] ?? '0', 10);
    const index = zeroIndex + 1;
    if (index >= 1 && index <= MAX_CUSTOM_SHAPES) {
      const shape = ensureShapeDefinition(customShapes, index);
      const block = getProgramBlock(shapeMatch[2] as 'init' | 'per_frame', {
        init: shape.programs.init,
        perFrame: shape.programs.perFrame,
      });
      if (block) {
        pushProgramStatement(block, field.rawValue, field.line, diagnostics);
        return true;
      }
    }
  }

  return false;
}

function collectRegisterUsage(target: string, usage: { q: number; t: number }) {
  const match = target.toLowerCase().match(/^([qt])(\d+)$/u);
  if (!match) {
    return;
  }
  const bucket = match[1] as 'q' | 't';
  const index = Number.parseInt(match[2] ?? '0', 10);
  if (Number.isFinite(index)) {
    usage[bucket] = Math.max(usage[bucket], index);
  }
}

function analyzeProgramRegisters(
  block: MilkdropProgramBlock,
  usage: { q: number; t: number },
) {
  block.statements.forEach((statement) => {
    collectRegisterUsage(statement.target, usage);
    walkMilkdropExpression(statement.expression, (node) => {
      if (node.type === 'identifier') {
        collectRegisterUsage(node.name, usage);
      }
    });
  });
}

function hasProgramStatements(block: MilkdropProgramBlock) {
  return block.statements.length > 0;
}

function buildFeatureAnalysis({
  programs,
  customWaves,
  customShapes,
  numericFields,
  unsupportedShaderText,
  supportedShaderText,
}: {
  programs: MilkdropPresetIR['programs'];
  customWaves: MilkdropWaveDefinition[];
  customShapes: MilkdropShapeDefinition[];
  numericFields: Record<string, number>;
  unsupportedShaderText: boolean;
  supportedShaderText: boolean;
}): MilkdropFeatureAnalysis {
  const features = new Set<MilkdropFeatureKey>(['base-globals']);
  const registerUsage = { q: 0, t: 0 };

  analyzeProgramRegisters(programs.init, registerUsage);
  analyzeProgramRegisters(programs.perFrame, registerUsage);
  analyzeProgramRegisters(programs.perPixel, registerUsage);

  if (hasProgramStatements(programs.perFrame)) {
    features.add('per-frame-equations');
  }
  if (hasProgramStatements(programs.perPixel)) {
    features.add('per-pixel-equations');
  }

  const customWaveFeatureUsed = customWaves.some((wave) => {
    analyzeProgramRegisters(wave.programs.init, registerUsage);
    analyzeProgramRegisters(wave.programs.perFrame, registerUsage);
    analyzeProgramRegisters(wave.programs.perPoint, registerUsage);
    return (
      Object.keys(wave.fields).length > 0 ||
      hasProgramStatements(wave.programs.init) ||
      hasProgramStatements(wave.programs.perFrame) ||
      hasProgramStatements(wave.programs.perPoint)
    );
  });
  if (customWaveFeatureUsed) {
    features.add('custom-waves');
  }

  const customShapeFeatureUsed = customShapes.some((shape) => {
    analyzeProgramRegisters(shape.programs.init, registerUsage);
    analyzeProgramRegisters(shape.programs.perFrame, registerUsage);
    return (
      Object.keys(shape.fields).length > 0 ||
      hasProgramStatements(shape.programs.init) ||
      hasProgramStatements(shape.programs.perFrame)
    );
  });
  if (customShapeFeatureUsed) {
    features.add('custom-shapes');
  }

  if ((numericFields.ob_size ?? 0) > 0 || (numericFields.ib_size ?? 0) > 0) {
    features.add('borders');
  }

  if ((numericFields.motion_vectors ?? 0) > 0.5) {
    features.add('motion-vectors');
  }

  if ((numericFields.video_echo_enabled ?? 0) > 0.5) {
    features.add('video-echo');
  }

  if (
    (numericFields.brighten ?? 0) > 0.5 ||
    (numericFields.darken ?? 0) > 0.5 ||
    (numericFields.solarize ?? 0) > 0.5 ||
    (numericFields.invert ?? 0) > 0.5 ||
    Math.abs((numericFields.gammaadj ?? 1) - 1) > 0.001
  ) {
    features.add('post-effects');
  }

  if (unsupportedShaderText) {
    features.add('unsupported-shader-text');
  }

  return {
    featuresUsed: FEATURE_ORDER.filter((feature) => features.has(feature)),
    unsupportedShaderText,
    supportedShaderText,
    registerUsage,
  };
}

function buildBackendSupport({
  backend,
  featureAnalysis,
  warnings,
  unsupportedKeys,
}: {
  backend: 'webgl' | 'webgpu';
  featureAnalysis: MilkdropFeatureAnalysis;
  warnings: string[];
  unsupportedKeys: string[];
}): MilkdropBackendSupport {
  const requiredFeatures = featureAnalysis.featuresUsed.filter(
    (feature) => feature !== 'unsupported-shader-text',
  );
  const reasons = [...warnings];
  const unsupportedFeatures: MilkdropFeatureKey[] = [];

  if (featureAnalysis.unsupportedShaderText) {
    reasons.push(
      'This preset includes custom shader text that the Stims MilkDrop runtime does not execute.',
    );
    unsupportedFeatures.push('unsupported-shader-text');
  }

  if (unsupportedKeys.some((key) => hardUnsupportedKeys.has(key))) {
    reasons.push(
      'This preset depends on unsupported MilkDrop features that are outside the current runtime scope.',
    );
  }

  const uniqueReasons = [...new Set(reasons)];
  const uniqueUnsupported = [...new Set(unsupportedFeatures)];

  if (
    featureAnalysis.unsupportedShaderText ||
    unsupportedKeys.some((key) => hardUnsupportedKeys.has(key))
  ) {
    return {
      status: 'unsupported',
      reasons: uniqueReasons,
      requiredFeatures,
      unsupportedFeatures: uniqueUnsupported,
      recommendedFallback: backend === 'webgpu' ? 'webgl' : undefined,
    };
  }

  if (uniqueReasons.length > 0 || uniqueUnsupported.length > 0) {
    return {
      status: 'partial',
      reasons: uniqueReasons,
      requiredFeatures,
      unsupportedFeatures: uniqueUnsupported,
      recommendedFallback: backend === 'webgpu' ? 'webgl' : undefined,
    };
  }

  return {
    status: 'supported',
    reasons: [],
    requiredFeatures,
    unsupportedFeatures: [],
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
    init: createProgramBlock(),
    perFrame: createProgramBlock(),
    perPixel: createProgramBlock(),
  };
  const customWaveMap = new Map<number, MilkdropWaveDefinition>();
  const customShapeMap = new Map<number, MilkdropShapeDefinition>();
  const unsupportedKeys = new Set<string>();
  let unsupportedShaderText = false;
  let supportedShaderText = false;
  let warpShaderText: string | null = null;
  let compShaderText: string | null = null;

  ast.fields.forEach((field) => {
    if (
      compileProgramsFromField(
        field,
        programs,
        customWaveMap,
        customShapeMap,
        diagnostics,
      )
    ) {
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

    if (shaderFieldPattern.test(normalizedKey)) {
      const rawValue = normalizeString(field.rawValue);
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
      if (index < 1 || index > MAX_CUSTOM_WAVES) {
        unsupportedKeys.add(normalizedKey);
        return;
      }
      const compiledScalar = compileScalarField(field, diagnostics);
      if (compiledScalar.value === null) {
        addDiagnostic(
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
      numericFields[normalizedKey] = compiledScalar.value;
      ensureWaveDefinition(customWaveMap, index).fields[suffix] =
        compiledScalar.value;
      return;
    }

    const customShapeFieldMatch = normalizedKey.match(/^shape_(\d+)_(.+)$/u);
    if (customShapeFieldMatch) {
      const index = Number.parseInt(customShapeFieldMatch[1] ?? '0', 10);
      const suffix = customShapeFieldMatch[2] ?? '';
      if (index < 1 || index > MAX_CUSTOM_SHAPES) {
        unsupportedKeys.add(normalizedKey);
        return;
      }
      if (!(normalizedKey in DEFAULT_MILKDROP_STATE)) {
        unsupportedKeys.add(normalizedKey);
        addDiagnostic(
          diagnostics,
          'warning',
          'preset_unsupported_field',
          `Unsupported preset field "${normalizedKey}" was ignored.`,
          {
            line: field.line,
            field: normalizedKey,
          },
        );
        return;
      }
      const compiledScalar = compileScalarField(field, diagnostics);
      if (compiledScalar.value === null) {
        addDiagnostic(
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
      numericFields[normalizedKey] = compiledScalar.value;
      ensureShapeDefinition(customShapeMap, index).fields[suffix] =
        compiledScalar.value;
      return;
    }

    if (!(normalizedKey in DEFAULT_MILKDROP_STATE)) {
      unsupportedKeys.add(normalizedKey);
      addDiagnostic(
        diagnostics,
        'warning',
        'preset_unsupported_field',
        `Unsupported preset field "${normalizedKey}" was ignored.`,
        {
          line: field.line,
          field: normalizedKey,
        },
      );
      return;
    }

    const compiledScalar = compileScalarField(field, diagnostics);
    if (compiledScalar.value === null) {
      addDiagnostic(
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
    numericFields[normalizedKey] = compiledScalar.value;
  });

  const customWaves = [...customWaveMap.values()].sort(
    (left, right) => left.index - right.index,
  );
  const customShapes = [...customShapeMap.values()].sort(
    (left, right) => left.index - right.index,
  );
  const shaderWarpAnalysis = extractShaderControls(warpShaderText);
  const shaderCompAnalysis = extractShaderControls(compShaderText);
  const mergedShaderControls = mergeShaderControlAnalysis(
    shaderWarpAnalysis,
    shaderCompAnalysis,
  );
  supportedShaderText =
    shaderWarpAnalysis.supported || shaderCompAnalysis.supported;
  unsupportedShaderText =
    (!shaderWarpAnalysis.supported &&
      !!warpShaderText &&
      shaderWarpAnalysis.unsupportedLines.length > 0) ||
    (!shaderCompAnalysis.supported &&
      !!compShaderText &&
      shaderCompAnalysis.unsupportedLines.length > 0) ||
    shaderWarpAnalysis.unsupportedLines.length > 0 ||
    shaderCompAnalysis.unsupportedLines.length > 0;
  if (unsupportedShaderText) {
    addDiagnostic(
      diagnostics,
      'warning',
      'preset_unsupported_shader_text',
      'Shader-text sections include lines outside the supported subset.',
    );
  }
  const featureAnalysis = buildFeatureAnalysis({
    programs,
    customWaves,
    customShapes,
    numericFields,
    unsupportedShaderText,
    supportedShaderText,
  });
  const warnings = [
    ...[...unsupportedKeys].map(
      (key) => `Unsupported preset field "${key}" was ignored.`,
    ),
    ...(featureAnalysis.unsupportedShaderText
      ? ['Shader-text sections are detected but not executed.']
      : []),
  ];
  const backends = {
    webgl: buildBackendSupport({
      backend: 'webgl',
      featureAnalysis,
      warnings,
      unsupportedKeys: [...unsupportedKeys],
    }),
    webgpu: buildBackendSupport({
      backend: 'webgpu',
      featureAnalysis,
      warnings,
      unsupportedKeys: [...unsupportedKeys],
    }),
  };

  const title = stringFields.title || 'MilkDrop Session';
  const author = stringFields.author;
  const description = stringFields.description;

  const compatibility = {
    backends,
    featureAnalysis,
    warnings,
    blockingReasons: [
      ...new Set(
        [...backends.webgl.reasons, ...backends.webgpu.reasons].filter(Boolean),
      ),
    ],
    supportedFeatures: featureAnalysis.featuresUsed,
    unsupportedKeys: [...unsupportedKeys],
    webgl: backends.webgl.status === 'supported',
    webgpu: backends.webgpu.status === 'supported',
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
        key !== 'solarize' &&
        key !== 'invert' &&
        key !== 'gammaadj' &&
        key !== 'video_echo_enabled' &&
        key !== 'video_echo_alpha' &&
        key !== 'video_echo_zoom'
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
      supported: supportedShaderText && !unsupportedShaderText,
      unsupportedLines: [
        ...shaderWarpAnalysis.unsupportedLines,
        ...shaderCompAnalysis.unsupportedLines,
      ],
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
      solarize: (numericFields.solarize ?? 0) > 0.5,
      invert: (numericFields.invert ?? 0) > 0.5,
      shaderEnabled: (numericFields.shader ?? 1) > 0.5,
      textureWrap: (numericFields.texture_wrap ?? 0) > 0.5,
      feedbackTexture: (numericFields.feedback_texture ?? 0) > 0.5,
      outerBorderStyle: (numericFields.ob_border ?? 0) > 0.5,
      innerBorderStyle: (numericFields.ib_border ?? 0) > 0.5,
      shaderControls: mergedShaderControls.controls,
      shaderControlExpressions: mergedShaderControls.expressions,
      gammaAdj: numericFields.gammaadj ?? 1,
      videoEchoEnabled: (numericFields.video_echo_enabled ?? 0) > 0.5,
      videoEchoAlpha: numericFields.video_echo_alpha ?? 0,
      videoEchoZoom: numericFields.video_echo_zoom ?? 1,
    },
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
