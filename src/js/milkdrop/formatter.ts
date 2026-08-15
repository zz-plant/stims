import { normalizeProgramAssignmentTarget } from './field-normalization.ts';
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

const FALLBACK_TITLE = 'MilkDrop Session';

function resolveFormattedTitle(compiled: MilkdropCompiledPreset) {
  const { ir } = compiled;
  if (ir.title && ir.title !== FALLBACK_TITLE) {
    return ir.title;
  }
  // Presets without a `title=` field (most bundled .milk files) compile with
  // the generic fallback title; prefer the catalog/import title carried on
  // the preset source so round-tripping does not degrade it.
  return (
    compiled.source?.title?.trim() ||
    compiled.title?.trim() ||
    ir.title ||
    FALLBACK_TITLE
  );
}

function emitShaderSection(
  lines: string[],
  section: 'warp_shader' | 'comp_shader',
  shaderText: string | null,
) {
  if (!shaderText?.trim()) {
    return;
  }
  lines.push('');
  lines.push(`[${section}]`);
  shaderText.split(/\r?\n/u).forEach((shaderLine) => {
    lines.push(shaderLine);
  });
}

export function formatMilkdropPreset(compiled: MilkdropCompiledPreset) {
  const lines: string[] = [];
  const { ir } = compiled;

  lines.push(`title=${serializeString(resolveFormattedTitle(compiled))}`);
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

  // Shader sections must come last: the parser treats every line after a
  // [warp_shader]/[comp_shader] header as shader text until the next header.
  emitShaderSection(lines, 'warp_shader', ir.shaderText.warp);
  emitShaderSection(lines, 'comp_shader', ir.shaderText.comp);

  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()}\n`;
}

const shaderSectionHeaderPattern = /^\[\s*(?:warp_shader|comp_shader)\s*\]$/iu;

/**
 * Inserts new `key=value` lines before the first shader section header (if
 * any) so they stay in the scalar portion of the preset. Appending at the
 * end would place them inside [warp_shader]/[comp_shader], where the parser
 * would swallow them as shader text.
 */
function insertFieldLines(lines: string[], fieldLines: string[]) {
  if (fieldLines.length === 0) {
    return lines;
  }
  const shaderStart = lines.findIndex((line) =>
    shaderSectionHeaderPattern.test(line.trim()),
  );
  if (shaderStart < 0) {
    return [...lines, ...fieldLines];
  }
  return [
    ...lines.slice(0, shaderStart),
    ...fieldLines,
    '',
    ...lines.slice(shaderStart),
  ];
}

/**
 * The key of a `key=value` line, or null when the line is not an assignment.
 *
 * Prefix matching (`line.startsWith('zoom=')`) missed every assignment a hand
 * edited buffer picks up spaces in — `zoom = 1.0` — and the caller then wrote
 * a *second* `zoom=` line beside it. Since the compiler takes the last
 * assignment, that turned the next write into a silent no-op.
 */
function readAssignmentKey(line: string): string | null {
  const trimmed = line.trim();
  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }
  return trimmed.slice(0, separatorIndex).trim();
}

/**
 * MilkDrop spells several fields two ways (`decay` / `fDecay`) and is not
 * case-sensitive about any of them, so the literal comparison left knob writes
 * landing beside the line they meant to replace.
 *
 * The alias table is the compiler's own (field-normalization), so a control
 * addressing `ob_r` finds the `fOuterBorderR=` line the preset actually
 * carries. Before that, only the six names canonicalKey knows collapsed:
 * everything else — the whole border, motion-vector, video-echo and main-wave
 * blocks, which real .milk files always spell the long way — got a second
 * assignment appended instead of an in-place rewrite.
 */
function normalizeFieldKey(key: string): string {
  return normalizeProgramAssignmentTarget(key);
}

/**
 * Joins edited lines back into preset source without touching anything the
 * edit did not: the previous global blank-line collapse and trim renumbered
 * every line below an edit, which shifts the diagnostics a user is reading
 * mid-fix and quietly reformats their shader bodies.
 */
function joinPresetLines(lines: string[]): string {
  const text = lines.join('\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function upsertMilkdropField(
  source: string,
  key: string,
  value: string | number,
) {
  return upsertMilkdropFields(source, { [key]: value });
}

const EQUATION_KEY_PREFIXES = [
  'per_frame',
  'per_pixel',
  'wave_',
  'shape_',
] as const;
const EQUATION_KEY_EXACT = new Set(['warp', 'comp']);

function isEquationKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return (
    EQUATION_KEY_PREFIXES.some((prefix) => lowered.startsWith(prefix)) ||
    EQUATION_KEY_EXACT.has(lowered)
  );
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function stripInlineCommentFromLine(line: string): string {
  let inString: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inString) {
      if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }
    if (char === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
    if (char === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * True when a per_frame/per_pixel/wave_/shape_ equation reassigns `target`
 * somewhere in the preset. upsertMilkdropField (used by MIDI, the Tune
 * sliders, and session_midi_set) only ever writes the literal top-level
 * default line — never the equation itself — so a preset that already
 * computes this field every frame will silently overwrite that default on
 * the very next frame. A knob bound to a shadowed target looks broken with
 * no error anywhere.
 */
export function isFieldShadowedByEquations(
  source: string,
  target: string,
): boolean {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) return false;
  const assignPattern = new RegExp(
    `(?:^|;)\\s*${escapeRegExpLiteral(normalizedTarget)}\\s*=(?!=)`,
    'iu',
  );

  const lines = source.split(/\r?\n/u);
  let inShaderSection = false;
  for (const lineText of lines) {
    const trimmed = lineText.trim();
    if (shaderSectionHeaderPattern.test(trimmed)) {
      inShaderSection = true;
    }
    if (inShaderSection) continue;
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith(';')
    ) {
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!isEquationKey(key)) continue;

    const valuePart = stripInlineCommentFromLine(trimmed.slice(eqIdx + 1));
    if (assignPattern.test(valuePart)) {
      return true;
    }
  }
  return false;
}

/**
 * 1-based line number of the *first* equation line that reassigns `target`,
 * or null when nothing does. Pairs with isFieldShadowedByEquations: knowing a
 * control is overwritten every frame is only actionable if you can get to the
 * line doing the overwriting.
 */
export function findMilkdropEquationLine(
  source: string,
  target: string,
): number | null {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) return null;
  const assignPattern = new RegExp(
    `(?:^|;)\\s*${escapeRegExpLiteral(normalizedTarget)}\\s*=(?!=)`,
    'iu',
  );

  const lines = source.split(/\r?\n/u);
  let inShaderSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (shaderSectionHeaderPattern.test(trimmed)) {
      inShaderSection = true;
    }
    if (inShaderSection) continue;
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith(';')
    ) {
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    if (!isEquationKey(trimmed.slice(0, eqIdx).trim())) continue;
    const valuePart = stripInlineCommentFromLine(trimmed.slice(eqIdx + 1));
    if (assignPattern.test(valuePart)) {
      return i + 1;
    }
  }
  return null;
}

/**
 * 1-based line number of the literal top-level `target=value` line, or null
 * if there isn't one yet. Mirrors upsertMilkdropField's own search so both
 * agree on what counts as "the" line for a given field — including its alias
 * spelling, so `decay` finds a preset's `fDecay=` line.
 */
export function findMilkdropFieldLine(
  source: string,
  target: string,
): number | null {
  if (!target.trim()) return null;
  const normalizedTarget = normalizeFieldKey(target);

  const lines = source.split(/\r?\n/u);
  let inShaderSection = false;
  let found: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (shaderSectionHeaderPattern.test(trimmed)) {
      inShaderSection = true;
    }
    if (inShaderSection) continue;
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith(';')
    ) {
      continue;
    }

    const lineKey = readAssignmentKey(lines[i]);
    if (lineKey !== null && normalizeFieldKey(lineKey) === normalizedTarget) {
      // Last wins in the compiler, so the last line is the one that decides
      // the value — and therefore the one a gutter marker should point at.
      found = i + 1;
    }
  }
  return found;
}

/**
 * The numeric value the compiler would take for `target`, read straight from
 * buffer text. Alias- and case-insensitive, skips shader bodies, and honours
 * last-wins, so it agrees with what upsertMilkdropField will rewrite.
 *
 * Returns null when the field has no literal line (the caller supplies the
 * MilkDrop default) or when its value is an expression rather than a number.
 */
export function readMilkdropField(
  source: string,
  target: string,
): number | null {
  const line = findMilkdropFieldLine(source, target);
  if (line === null) return null;

  const text = source.split(/\r?\n/u)[line - 1] ?? '';
  const rawValue = stripInlineCommentFromLine(
    text.slice(text.indexOf('=') + 1),
  ).trim();
  // The whole value has to be the number. `zoom=1.0 + bass` parses to 1.0 if
  // you only look at the front, which would have a control report — and then
  // overwrite — a value the preset never held.
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(rawValue)) {
    return null;
  }
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface MidiGutterEntry {
  line: number;
  target: string;
  status: 'live' | 'shadowed';
}

/**
 * Per-line gutter info for every currently MIDI-bound target that has a
 * literal default line in this preset. Targets with no default line yet
 * (nothing has written to them) have nothing to mark and are skipped.
 */
export function computeMidiGutterInfo(
  source: string,
  targets: Iterable<string>,
): MidiGutterEntry[] {
  const entries: MidiGutterEntry[] = [];
  const seen = new Set<string>();
  for (const rawTarget of targets) {
    const target = rawTarget.trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);

    const line = findMilkdropFieldLine(source, target);
    if (line === null) continue;

    entries.push({
      line,
      target,
      status: isFieldShadowedByEquations(source, target) ? 'shadowed' : 'live',
    });
  }
  return entries;
}

export function upsertMilkdropFields(
  source: string,
  updates: Record<string, string | number>,
) {
  const lines = source.split(/\r?\n/u);
  const pending = new Map(
    Object.entries(updates).map(([key, value]) => [
      normalizeFieldKey(key),
      {
        key: key.trim(),
        value:
          typeof value === 'number'
            ? formatNumber(value)
            : serializeString(value),
      },
    ]),
  );
  const applied = new Set<string>();

  let inShaderSection = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (shaderSectionHeaderPattern.test(trimmed)) {
      inShaderSection = true;
    }
    if (inShaderSection) {
      return line;
    }

    const lineKey = readAssignmentKey(line);
    if (lineKey === null) {
      return line;
    }

    const update = pending.get(normalizeFieldKey(lineKey));
    if (update === undefined) {
      return line;
    }

    applied.add(normalizeFieldKey(lineKey));
    // Every occurrence is rewritten, not just the first. The compiler resolves
    // duplicate keys last-wins, so leaving a stale copy behind kept the old
    // value in charge and made the control look dead.
    //
    // The preset's own spelling is preserved (`fDecay` stays `fDecay`) so a
    // knob turn does not churn the buffer between equivalent names.
    return `${lineKey}=${update.value}`;
  });

  const pendingLines: string[] = [];
  pending.forEach((update, normalized) => {
    if (applied.has(normalized)) {
      return;
    }
    pendingLines.push(`${update.key}=${update.value}`);
  });

  return joinPresetLines(insertFieldLines(nextLines, pendingLines));
}
