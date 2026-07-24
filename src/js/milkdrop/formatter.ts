import type {
  MilkdropCompiledPreset,
  MilkdropProgramBlock,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from './types';

const globalOrder = [
  'fRating',
  'beat_sensitivity',
  'blend_duration',
  'decay',
  'zoom',
  'rot',
  'warp',
  'mesh_density',
  'mesh_alpha',
  'mesh_r',
  'mesh_g',
  'mesh_b',
  'bg_r',
  'bg_g',
  'bg_b',
] as const;

const mainWaveOrder = [
  'wave_mode',
  'wave_scale',
  'wave_smoothing',
  'bmodwavealphabyvolume',
  'wave_a',
  'wave_r',
  'wave_g',
  'wave_b',
  'wave_x',
  'wave_y',
  'wave_mystery',
  'wave_thick',
  'wave_additive',
  'wave_usedots',
  'wave_brighten',
] as const;

const borderOrder = [
  'ob_size',
  'ob_r',
  'ob_g',
  'ob_b',
  'ob_a',
  'ib_size',
  'ib_r',
  'ib_g',
  'ib_b',
  'ib_a',
] as const;

const postOrder = [
  'brighten',
  'darken',
  'darken_center',
  'solarize',
  'invert',
  'video_echo_enabled',
  'video_echo_alpha',
  'video_echo_zoom',
  'video_echo_orientation',
] as const;

const customWaveFieldOrder = [
  'enabled',
  'samples',
  'spectrum',
  'additive',
  'usedots',
  'scaling',
  'smoothing',
  'mystery',
  'thick',
  'x',
  'y',
  'r',
  'g',
  'b',
  'a',
] as const;

const customShapeFieldOrder = [
  'enabled',
  'sides',
  'textured',
  'x',
  'y',
  'rad',
  'ang',
  'tex_zoom',
  'tex_ang',
  'r',
  'g',
  'b',
  'a',
  'r2',
  'g2',
  'b2',
  'a2',
  'border_r',
  'border_g',
  'border_b',
  'border_a',
  'additive',
  'thickoutline',
] as const;

function serializeString(value: string) {
  return /\s/u.test(value) ? JSON.stringify(value) : value;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = Number(value.toFixed(4));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function canonicalKey(key: string) {
  if (key === 'decay') {
    return 'fDecay';
  }
  if (key === 'brighten') {
    return 'bBrighten';
  }
  if (key === 'darken') {
    return 'bDarken';
  }
  if (key === 'darken_center') {
    return 'bDarkenCenter';
  }
  if (key === 'solarize') {
    return 'bSolarize';
  }
  if (key === 'invert') {
    return 'bInvert';
  }
  return key;
}

function orderedKeys(
  values: Record<string, number>,
  preferredOrder: readonly string[],
) {
  const keys = Object.keys(values);
  return [
    ...preferredOrder.filter((key) => keys.includes(key)),
    ...keys
      .filter((key) => !preferredOrder.includes(key))
      .sort((left, right) => left.localeCompare(right)),
  ];
}

function emitNumericSection(
  lines: string[],
  values: Record<string, number>,
  preferredOrder: readonly string[],
) {
  orderedKeys(values, preferredOrder).forEach((key) => {
    lines.push(`${canonicalKey(key)}=${formatNumber(values[key] as number)}`);
  });
}

function emitProgramLines(
  lines: string[],
  prefix: string,
  block: MilkdropProgramBlock,
) {
  block.sourceLines.forEach((statement, index) => {
    lines.push(`${prefix}${index + 1}=${statement}`);
  });
}

function emitWaveDefinition(lines: string[], wave: MilkdropWaveDefinition) {
  const zeroIndex = wave.index - 1;
  orderedKeys(wave.fields, customWaveFieldOrder).forEach((key) => {
    lines.push(
      `wavecode_${zeroIndex}_${key}=${formatNumber(wave.fields[key] as number)}`,
    );
  });
  emitProgramLines(lines, `wave_${zeroIndex}_init`, wave.programs.init);
  emitProgramLines(
    lines,
    `wave_${zeroIndex}_per_frame`,
    wave.programs.perFrame,
  );
  emitProgramLines(
    lines,
    `wave_${zeroIndex}_per_point`,
    wave.programs.perPoint,
  );
}

function emitShapeDefinition(lines: string[], shape: MilkdropShapeDefinition) {
  const zeroIndex = shape.index - 1;
  orderedKeys(shape.fields, customShapeFieldOrder).forEach((key) => {
    lines.push(
      `shapecode_${zeroIndex}_${key}=${formatNumber(
        shape.fields[key] as number,
      )}`,
    );
  });
  emitProgramLines(lines, `shape_${zeroIndex}_init`, shape.programs.init);
  emitProgramLines(
    lines,
    `shape_${zeroIndex}_per_frame`,
    shape.programs.perFrame,
  );
}

export function formatMilkdropPreset(compiled: MilkdropCompiledPreset) {
  const lines: string[] = [];
  const { ir } = compiled;

  lines.push(`title=${serializeString(ir.title)}`);
  if (ir.author) {
    lines.push(`author=${serializeString(ir.author)}`);
  }
  if (ir.description) {
    lines.push(`description=${serializeString(ir.description)}`);
  }

  lines.push('');
  emitNumericSection(lines, ir.globals, globalOrder);
  emitNumericSection(lines, ir.mainWave, mainWaveOrder);

  const borderFields = Object.fromEntries(
    borderOrder
      .map((key) => [key, ir.numericFields[key]])
      .filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>;
  emitNumericSection(lines, borderFields, borderOrder);

  const postFields = Object.fromEntries(
    postOrder
      .map((key) => [key, ir.numericFields[key]])
      .filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>;
  emitNumericSection(lines, postFields, postOrder);

  if (ir.customWaves.length > 0) {
    lines.push('');
    ir.customWaves.forEach((wave, index) => {
      if (index > 0) {
        lines.push('');
      }
      emitWaveDefinition(lines, wave);
    });
  }

  if (ir.customShapes.length > 0) {
    lines.push('');
    ir.customShapes.forEach((shape, index) => {
      if (index > 0) {
        lines.push('');
      }
      emitShapeDefinition(lines, shape);
    });
  }

  const rootPrograms = [
    ['init_', ir.programs.init],
    ['per_frame_', ir.programs.perFrame],
    ['per_pixel_', ir.programs.perPixel],
  ] as const;

  if (rootPrograms.some(([, block]) => block.sourceLines.length > 0)) {
    lines.push('');
    rootPrograms.forEach(([prefix, block]) => {
      emitProgramLines(lines, prefix, block);
    });
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()}\n`;
}

export function upsertMilkdropField(
  source: string,
  key: string,
  value: string | number,
) {
  const lines = source.split(/\r?\n/u);
  const normalizedKey = key.trim();
  const serializedValue =
    typeof value === 'number' ? formatNumber(value) : serializeString(value);
  const targetPrefix = `${normalizedKey}=`;
  let found = false;

  const nextLines = lines.map((line) => {
    if (line.trim().startsWith(targetPrefix)) {
      found = true;
      return `${normalizedKey}=${serializedValue}`;
    }
    return line;
  });

  if (!found) {
    nextLines.push(`${normalizedKey}=${serializedValue}`);
  }

  return `${nextLines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()}\n`;
}

export function upsertMilkdropFields(
  source: string,
  updates: Record<string, string | number>,
) {
  const lines = source.split(/\r?\n/u);
  const pending = new Map(
    Object.entries(updates).map(([key, value]) => [
      key.trim(),
      typeof value === 'number' ? formatNumber(value) : serializeString(value),
    ]),
  );

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      return line;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = pending.get(key);
    if (value === undefined) {
      return line;
    }

    pending.delete(key);
    return `${key}=${value}`;
  });

  pending.forEach((value, key) => {
    nextLines.push(`${key}=${value}`);
  });

  return `${nextLines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()}\n`;
}
