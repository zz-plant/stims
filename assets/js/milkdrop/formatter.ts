import type { MilkdropCompiledPreset } from './types';

const numericOrder = [
  'fRating',
  'blend_duration',
  'fDecay',
  'zoom',
  'rot',
  'warp',
  'wave_mode',
  'wave_scale',
  'wave_smoothing',
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
  'mesh_density',
  'mesh_alpha',
  'mesh_r',
  'mesh_g',
  'mesh_b',
  'bg_r',
  'bg_g',
  'bg_b',
  'echo_alpha',
];

function serializeString(value: string) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = Number(value.toFixed(4));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function serializeCanonicalKey(key: string) {
  if (key === 'decay') {
    return 'fDecay';
  }
  return key;
}

function shapeKeySorter(left: string, right: string) {
  const leftMatch = left.match(/^shape_(\d+)_(.+)$/u);
  const rightMatch = right.match(/^shape_(\d+)_(.+)$/u);
  if (!leftMatch || !rightMatch) {
    return left.localeCompare(right);
  }
  const indexDelta =
    Number.parseInt(leftMatch[1], 10) - Number.parseInt(rightMatch[1], 10);
  if (indexDelta !== 0) {
    return indexDelta;
  }
  return leftMatch[2].localeCompare(rightMatch[2]);
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

  const presentNumericKeys = Object.keys(ir.numericFields);
  const orderedNumericKeys = [
    ...numericOrder.filter((key) =>
      presentNumericKeys.includes(key === 'fDecay' ? 'decay' : key),
    ),
    ...presentNumericKeys
      .filter(
        (key) =>
          !numericOrder.includes(serializeCanonicalKey(key)) &&
          !key.startsWith('shape_'),
      )
      .sort(),
  ];

  orderedNumericKeys.forEach((key) => {
    const canonicalKey = key === 'fDecay' ? 'decay' : key;
    if (!(canonicalKey in ir.numericFields)) {
      return;
    }
    lines.push(
      `${serializeCanonicalKey(canonicalKey)}=${formatNumber(
        ir.numericFields[canonicalKey] as number,
      )}`,
    );
  });

  const shapeKeys = Object.keys(ir.numericFields)
    .filter((key) => key.startsWith('shape_'))
    .sort(shapeKeySorter);
  if (shapeKeys.length > 0) {
    lines.push('');
    shapeKeys.forEach((key) => {
      lines.push(`${key}=${formatNumber(ir.numericFields[key] as number)}`);
    });
  }

  const programSections = [
    ['init', ir.programs.init.sourceLines],
    ['per_frame', ir.programs.perFrame.sourceLines],
    ['per_pixel', ir.programs.perPixel.sourceLines],
  ] as const;

  programSections.forEach(([prefix, statements]) => {
    if (!statements.length) {
      return;
    }
    lines.push('');
    statements.forEach((statement, index) => {
      lines.push(`${prefix}_${index + 1}=${statement}`);
    });
  });

  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n')}\n`;
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
