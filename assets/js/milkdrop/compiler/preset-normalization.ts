import {
  aliasMap,
  normalizeFieldSuffix,
  normalizeProgramAssignmentTarget,
} from '../field-normalization.ts';
import type {
  MilkdropDiagnostic,
  MilkdropDiagnosticSeverity,
  MilkdropPresetField,
  MilkdropProgramBlock,
  MilkdropShapeDefinition,
  MilkdropVideoEchoOrientation,
  MilkdropWaveDefinition,
} from '../types.ts';
import { MAX_CUSTOM_SHAPES, MAX_CUSTOM_WAVES } from './default-state.ts';

const waveformSectionNames = new Set(['wave', 'waveform']);
const rootProgramPattern = /^(init|per_frame|per_frame_init|per_pixel)_(\d+)$/u;
const customWaveProgramPattern =
  /^wave_(\d+)_(init|per_frame|per_point)(\d+)?$/u;
const customShapeProgramPattern = /^shape_(\d+)_(init|per_frame)(\d+)?$/u;
const shapeSectionPattern = /^shape_(\d+)$/u;
const wavecodeFieldPattern = /^wavecode_(\d+)_(.+)$/u;
const shapecodeFieldPattern = /^shapecode_(\d+)_(.+)$/u;

const legacyCustomWaveSuffixMap: Record<string, string | null> = {
  mode: 'spectrum',
  bspectrum: 'spectrum',
  bdrawthick: 'thick',
  badditive: 'additive',
};

const legacyCustomShapeSuffixMap: Record<string, string | null> = {
  badditive: 'additive',
  thickoutline: 'thickoutline',
  thick_outline: 'thickoutline',
  bthickoutline: 'thickoutline',
  bthick_outline: 'thickoutline',
};

export function normalizeBlockedConstructValue(value: string) {
  return value.trim().replace(/\s+/gu, ' ');
}

export function toBlockedFieldConstruct(key: string) {
  return `field:${normalizeBlockedConstructValue(key)}`;
}

export function toBlockedShaderConstruct(line: string) {
  return `shader:${normalizeBlockedConstructValue(line)}`;
}

export function normalizeVideoEchoOrientation(value: number) {
  const truncated = Math.trunc(value);
  return (((truncated % 4) + 4) % 4) as MilkdropVideoEchoOrientation;
}

export function resolveLegacyCustomSlotIndex(
  rawIndex: number,
  maxSlots: number,
) {
  if (!Number.isFinite(rawIndex)) {
    return null;
  }
  if (rawIndex >= 0 && rawIndex < maxSlots) {
    return rawIndex + 1;
  }
  if (rawIndex === maxSlots) {
    return maxSlots;
  }
  return null;
}

export function defaultSourceId(rawTitle: string) {
  return (
    rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'milkdrop-preset'
  );
}

export function normalizeString(rawValue: string) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizeShaderFieldChunk(rawValue: string) {
  const normalized = normalizeString(rawValue).replace(/^`+/u, '').trim();
  if (
    normalized.length === 0 ||
    normalized === '{' ||
    normalized === '}' ||
    normalized.toLowerCase() === 'shader_body'
  ) {
    return null;
  }
  return normalized;
}

function normalizeLegacyCustomWaveSuffix(value: string) {
  const normalized = normalizeFieldSuffix(value);
  if (normalized in legacyCustomWaveSuffixMap) {
    return legacyCustomWaveSuffixMap[normalized];
  }
  return normalized;
}

function normalizeLegacyCustomShapeSuffix(value: string) {
  const normalized = normalizeFieldSuffix(value);
  if (normalized in legacyCustomShapeSuffixMap) {
    return legacyCustomShapeSuffixMap[normalized];
  }
  return normalized;
}

export function createProgramBlock(): MilkdropProgramBlock {
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

export function addDiagnostic(
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

export function getProgramBlock(
  programType:
    | 'init'
    | 'per_frame'
    | 'per_frame_init'
    | 'per_pixel'
    | 'per_point',
  blocks: {
    init: MilkdropProgramBlock;
    perFrame: MilkdropProgramBlock;
    perPixel?: MilkdropProgramBlock;
    perPoint?: MilkdropProgramBlock;
  },
) {
  if (programType === 'init' || programType === 'per_frame_init') {
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

export function normalizeFieldKey(field: MilkdropPresetField) {
  const rawKey = normalizeFieldSuffix(field.key);
  if (field.section) {
    if (waveformSectionNames.has(field.section)) {
      return `wave_${rawKey}`;
    }
    if (shapeSectionPattern.test(field.section)) {
      return `${field.section}_${rawKey}`;
    }
  }

  const wavecodeMatch = rawKey.match(wavecodeFieldPattern);
  if (wavecodeMatch) {
    const index = resolveLegacyCustomSlotIndex(
      Number.parseInt(wavecodeMatch[1] ?? '0', 10),
      MAX_CUSTOM_WAVES,
    );
    if (index !== null) {
      const suffix = normalizeLegacyCustomWaveSuffix(wavecodeMatch[2] ?? '');
      if (suffix !== null) {
        return `custom_wave_${index}_${suffix}`;
      }
    }
  }

  const shapecodeMatch = rawKey.match(shapecodeFieldPattern);
  if (shapecodeMatch) {
    const index = resolveLegacyCustomSlotIndex(
      Number.parseInt(shapecodeMatch[1] ?? '0', 10),
      MAX_CUSTOM_SHAPES,
    );
    if (index !== null) {
      const suffix = normalizeLegacyCustomShapeSuffix(shapecodeMatch[2] ?? '');
      if (suffix !== null) {
        return `shape_${index}_${suffix}`;
      }
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

export function ensureWaveDefinition(
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

export function ensureShapeDefinition(
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

export function normalizeProgramTarget(target: string) {
  return normalizeProgramAssignmentTarget(target);
}

export const presetProgramPatterns = {
  rootProgramPattern,
  customWaveProgramPattern,
  customShapeProgramPattern,
};
