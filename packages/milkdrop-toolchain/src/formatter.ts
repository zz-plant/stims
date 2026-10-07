/**
 * Preset Source Formatter & Serializer — formats, cleans, reads, and upserts MilkDrop `.milk`
 * INI-format configuration blocks, preserving equation order, custom waves/shapes, and scalar fields.
 */

import { normalizeFieldKey as normalizeCompiledFieldKey } from './compiler/preset-normalization.ts';
import { normalizeProgramAssignmentTarget } from './field-normalization.ts';
import { editorFieldKey } from './field-table.ts';
import {
  isShaderSection,
  type PresetSyntaxLine,
  parsePresetSyntax,
} from './preset-syntax.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropProgramBlock,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from './types.ts';

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
  'gammaadj',
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

export function serializeString(value: string) {
  return /\s/u.test(value) ? JSON.stringify(value) : value;
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  // Six places is what MilkDrop itself writes (`%.6f`). Fewer silently nudges
  // values the author never touched: Format must not change the preset.
  return String(Number(value.toFixed(6)));
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
    lines.push(`${editorFieldKey(key)}=${formatNumber(values[key] as number)}`);
  });
}

export function emitProgramLines(
  lines: string[],
  prefix: string,
  block: MilkdropProgramBlock,
) {
  const comments = block.comments ?? [];
  let number = 0;
  const push = (text: string) => {
    number += 1;
    lines.push(`${prefix}${number}=${text}`);
  };
  const emitStandalone = (index: number) => {
    comments
      .filter((comment) => !comment.trailing && comment.index === index)
      .forEach((comment) => {
        push(comment.text);
      });
  };
  block.sourceLines.forEach((statement, index) => {
    emitStandalone(index);
    const trailing = comments
      .filter((comment) => comment.trailing && comment.index === index)
      .map((comment) => comment.text);
    // Terminated, as MilkDrop writes them: it joins a block's numbered lines
    // before compiling, so a statement without its `;` runs into the next.
    const terminated = statement.trimEnd().endsWith(';')
      ? statement
      : `${statement};`;
    push(
      trailing.length > 0 ? `${terminated} ${trailing.join(' ')}` : terminated,
    );
  });
  emitStandalone(block.sourceLines.length);
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

export const FALLBACK_TITLE = 'MilkDrop Session';

export function resolveFormattedTitle(compiled: MilkdropCompiledPreset) {
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

  // Keys Stims does not use still belong to the preset: another engine (or a
  // newer MilkDrop) may read them, so Format hands them back as written.
  const preservedFields = ir.preservedFields ?? [];
  if (preservedFields.length > 0) {
    lines.push('');
    preservedFields.forEach(({ key, rawValue }) => {
      lines.push(`${key}=${rawValue}`);
    });
  }

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
    // `per_frame_init_`, not the shorter `init_` the compiler also accepts:
    // MilkDrop 2 and projectM only read the long key, so an export spelled
    // `init_1=` silently lost its init code in every other engine.
    ['per_frame_init_', ir.programs.init],
    ['per_frame_', ir.programs.perFrame],
    ['per_pixel_', ir.programs.perPixel],
  ] as const;

  if (
    rootPrograms.some(
      ([, block]) =>
        block.sourceLines.length > 0 || (block.comments?.length ?? 0) > 0,
    )
  ) {
    lines.push('');
    rootPrograms.forEach(([prefix, block]) => {
      emitProgramLines(lines, prefix, block);
    });
  }

  const head = lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  // Shader sections must come last: the parser treats every line after a
  // [warp_shader]/[comp_shader] header as shader text until the next header.
  // They are written as the author wrote them, not from the normalised
  // `shaderText`, and kept out of the blank-line collapse above, so Format
  // leaves comments, braces and layout alone.
  const shaderLines: string[] = [];
  emitShaderSection(shaderLines, 'warp_shader', resolveShaderText(ir, 'warp'));
  emitShaderSection(shaderLines, 'comp_shader', resolveShaderText(ir, 'comp'));

  return `${[head, ...shaderLines].join('\n')}\n`;
}

export function resolveShaderText(
  ir: MilkdropCompiledPreset['ir'],
  stage: 'warp' | 'comp',
): string | null {
  if (!ir.shaderText[stage]) {
    return null;
  }
  return ir.shaderSource?.[stage] ?? ir.shaderText[stage];
}

/**
 * Inserts new `key=value` lines before the first shader section header (if
 * any) so they stay in the scalar portion of the preset. Appending at the
 * end would place them inside [warp_shader]/[comp_shader], where the parser
 * would swallow them as shader text.
 */
function insertFieldLines(
  syntax: readonly PresetSyntaxLine[],
  lines: string[],
  fieldLines: string[],
) {
  if (fieldLines.length === 0) {
    return lines;
  }
  const shaderStart = syntax.findIndex(
    (line) => line.kind === 'section' && isShaderSection(line.section),
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
 * The preset's `key=value` lines, as the compiler reads them: outside shader
 * sections — including a field block that follows one — with a key.
 *
 * Tolerant of spacing (`zoom = 1.0`): prefix matching (`startsWith('zoom=')`)
 * missed every assignment a hand-edited buffer picks up spaces in, and the
 * caller then wrote a *second* `zoom=` line beside it. Since the compiler
 * takes the last assignment, that turned the next write into a silent no-op.
 */
function assignmentLines(source: string): PresetSyntaxLine[] {
  return parsePresetSyntax(source).lines.filter(
    (line) => line.kind === 'assignment' && Boolean(line.key),
  );
}

/**
 * MilkDrop spells several fields two ways (`decay` / `fDecay`) and is not
 * case-sensitive about any of them, so the literal comparison left knob writes
 * landing beside the line they meant to replace.
 *
 * The alias table is the compiler's own (field-normalization, built from
 * field-table), so a control addressing `ob_r` finds the `fOuterBorderR=`
 * line the preset actually carries. Before that, only six names collapsed:
 * everything else — the whole border, motion-vector, video-echo and main-wave
 * blocks, which real .milk files always spell the long way — got a second
 * assignment appended instead of an in-place rewrite.
 *
 * A custom wave or shape field has spellings of its own that the compiler
 * reads as one (`wavecode_0_bDrawThick`, `wavecode_0_thick`), so those go
 * through the compiler's normalization too.
 */
function normalizeFieldKey(key: string): string {
  if (SLOT_FIELD_KEY.test(key)) {
    // Null for a slot past the last one the compiler reads.
    const canonical = normalizeCompiledFieldKey({
      key,
      rawValue: '',
      line: 0,
      section: null,
    });
    if (canonical !== null) return canonical;
  }
  return normalizeProgramAssignmentTarget(key);
}

/** A custom wave or shape field: `wavecode_0_bDrawThick`, `shapecode_2_rad`. */
const SLOT_FIELD_KEY = /^(?:wavecode|shapecode)_\d+_/iu;

/**
 * Where a field is recomputed every frame, and under what name. A built-in
 * (`zoom`) is assigned by name in any equation line. A custom wave or shape
 * field is assigned by its bare name in that slot's own code: `shapecode_0_rad`
 * is `rad` in `shape_0_per_frame*`, and a wave's colour can also be set per
 * point. Null for an empty target.
 */
function equationScope(
  target: string,
): { variable: string; covers: (key: string) => boolean } | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  if (!SLOT_FIELD_KEY.test(trimmed)) {
    return { variable: trimmed, covers: isEquationKey };
  }
  // The compiler counts slots from 1; the file, from 0.
  const canonical = normalizeFieldKey(trimmed);
  const wave = /^custom_wave_(\d+)_(.+)$/u.exec(canonical);
  const shape = /^shape_(\d+)_(.+)$/u.exec(canonical);
  const slot = wave ?? shape;
  if (!slot) return null;
  const code = wave
    ? new RegExp(`^wave_${Number(slot[1]) - 1}_per_(?:frame|point)\\d*$`, 'iu')
    : new RegExp(`^shape_${Number(slot[1]) - 1}_per_frame\\d*$`, 'iu');
  return { variable: slot[2] as string, covers: (key) => code.test(key) };
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
  const scope = equationScope(target);
  if (!scope) return false;
  const assignPattern = new RegExp(
    `(?:^|;)\\s*${escapeRegExpLiteral(scope.variable)}\\s*=(?!=)`,
    'iu',
  );

  return assignmentLines(source).some(
    (line) =>
      scope.covers(line.key as string) &&
      assignPattern.test(stripInlineCommentFromLine(line.value as string)),
  );
}

/**
 * Classifies what an equation-driven overwrite means for a live fader write.
 * A relative equation (`cx = cx + sin(time)`) reloads `cx` to the base first,
 * so a live base write moves the stage; an absolute equation (`zoom = 1 +
 * bass*0.1`) discards the base entirely, so the drag will not show until the
 * equation itself is edited. The last assignment wins, so the scan keeps the
 * final matching equation's flavour.
 */
export function getFieldOverwriteKind(
  source: string,
  target: string,
): 'none' | 'absolute' | 'relative' {
  const scope = equationScope(target);
  if (!scope) return 'none';
  const normalizedTarget = scope.variable.toLowerCase();
  const targetRef = new RegExp(
    `\\b${escapeRegExpLiteral(normalizedTarget)}\\b`,
    'iu',
  );
  let last: 'absolute' | 'relative' | null = null;
  for (const line of assignmentLines(source)) {
    if (!scope.covers(line.key as string)) continue;
    const valuePart = stripInlineCommentFromLine(line.value as string);
    // Statements within one equation line run in order, and the last
    // assignment to the target wins — so classify each and keep the last.
    // The per-statement match mirrors isFieldShadowedByEquations' `(?!=)`
    // guard, so `zoom == x` stays "none" rather than reading as an overwrite.
    const assignPattern = new RegExp(
      `^\\s*${escapeRegExpLiteral(normalizedTarget)}\\s*=(?!=)`,
      'iu',
    );
    for (const statement of valuePart.split(';')) {
      if (!assignPattern.test(statement)) continue;
      const statementEqIdx = statement.indexOf('=');
      const rhs = statement.slice(statementEqIdx + 1);
      last = targetRef.test(rhs) ? 'relative' : 'absolute';
    }
  }
  return last ?? 'none';
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
  const scope = equationScope(target);
  if (!scope) return null;
  const assignPattern = new RegExp(
    `(?:^|;)\\s*${escapeRegExpLiteral(scope.variable)}\\s*=(?!=)`,
    'iu',
  );

  const line = assignmentLines(source).find(
    (candidate) =>
      scope.covers(candidate.key as string) &&
      assignPattern.test(stripInlineCommentFromLine(candidate.value as string)),
  );
  return line?.number ?? null;
}

/**
 * 1-based line number of the literal top-level `target=value` line, or null
 * if there isn't one yet. Mirrors upsertMilkdropField's own search so both
 * agree on what counts as "the" line for a given field — including its alias
 * spelling, so `decay` finds a preset's `fDecay=` line.
 */
function fieldLineFor(source: string, target: string) {
  if (!target.trim()) return null;
  const normalizedTarget = normalizeFieldKey(target);
  // Last wins in the compiler, so the last line is the one that decides the
  // value — and therefore the one a gutter marker should point at.
  return (
    assignmentLines(source).findLast(
      (line) => normalizeFieldKey(line.key as string) === normalizedTarget,
    ) ?? null
  );
}

export function findMilkdropFieldLine(
  source: string,
  target: string,
): number | null {
  return fieldLineFor(source, target)?.number ?? null;
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
  const line = fieldLineFor(source, target);
  if (line === null) return null;

  const rawValue = stripInlineCommentFromLine(line.value as string).trim();
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
  const syntax = parsePresetSyntax(source).lines;
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

  const nextLines = syntax.map((line) => {
    if (line.kind !== 'assignment' || !line.key) {
      return line.text;
    }
    const normalized = normalizeFieldKey(line.key);
    const update = pending.get(normalized);
    if (update === undefined) {
      return line.text;
    }

    applied.add(normalized);
    // Every occurrence is rewritten, not just the first. The compiler resolves
    // duplicate keys last-wins, so leaving a stale copy behind kept the old
    // value in charge and made the control look dead.
    //
    // The preset's own spelling is preserved (`fDecay` stays `fDecay`) so a
    // knob turn does not churn the buffer between equivalent names, and so
    // is the line's trailing comment.
    return `${line.key}=${update.value}${line.comment ? ` ${line.comment}` : ''}`;
  });

  const pendingLines: string[] = [];
  pending.forEach((update, normalized) => {
    if (applied.has(normalized)) {
      return;
    }
    pendingLines.push(`${update.key}=${update.value}`);
  });

  return joinPresetLines(insertFieldLines(syntax, nextLines, pendingLines));
}
