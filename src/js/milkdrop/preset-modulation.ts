/**
 * Reading and writing a single audio/time modulation on a preset field.
 *
 * On a per-frame-heavy preset most scalar fields are not literals at all —
 * measured on a real catalog preset, 9 of 11 of the Tune faders were fields
 * the preset recomputes every frame. For those, no value control can help:
 * whatever it writes is discarded on the next frame. What helps is editing
 * the equation, which is what this module does — it owns one `per_frame_`
 * line per field, of a shape narrow enough to parse back reliably:
 *
 *     <field> = <base> + <depth>*<source>
 *     <field> = <base> * (1 + <depth>*<source>)
 *
 * Anything else in the preset's per_frame block is left strictly alone. A
 * field whose equation does not match this shape reports `custom`, and the
 * control refuses to edit it rather than rewriting code it did not author.
 */

const SHADER_SECTION = /^\[\s*(?:warp_shader|comp_shader)\s*\]$/iu;

export const MODULATION_SOURCES = [
  { key: 'bass_att', label: 'Bass', hint: 'Smoothed low-band energy.' },
  { key: 'mid_att', label: 'Mid', hint: 'Smoothed mid-band energy.' },
  { key: 'treb_att', label: 'Treble', hint: 'Smoothed high-band energy.' },
  {
    key: 'beat_pulse',
    label: 'Beat',
    hint: 'Spikes to 1 on a detected beat, then falls away.',
  },
  { key: 'time', label: 'Time', hint: 'Seconds since the preset loaded.' },
] as const;

export type ModulationSource = (typeof MODULATION_SOURCES)[number]['key'];

export type ModulationMode = 'add' | 'multiply';

export type Modulation = {
  source: ModulationSource;
  depth: number;
  mode: ModulationMode;
  /** The unmodulated value the equation starts from. */
  base: number;
};

/** What the buffer currently says about a field's per_frame equation. */
export type ModulationState =
  | { kind: 'none' }
  | { kind: 'modulated'; modulation: Modulation; line: number }
  | { kind: 'custom'; line: number; text: string };

const SOURCE_KEYS = new Set<string>(MODULATION_SOURCES.map((s) => s.key));

function isSource(value: string): value is ModulationSource {
  return SOURCE_KEYS.has(value);
}

function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(6));
  return String(rounded);
}

/** `per_frame_12=...` → 12. Null for any other line. */
function perFrameIndex(line: string): number | null {
  const match = /^\s*per_frame_(\d+)\s*=/iu.exec(line);
  return match ? Number.parseInt(match[1], 10) : null;
}

function escapeField(field: string): string {
  return field.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Renders the equation body for a modulation.
 *
 * `multiply` wraps as `base*(1 + depth*source)` rather than `base*depth*source`
 * so depth 0 is the identity in both modes — a control whose zero position
 * changed meaning between modes would be unusable.
 */
export function formatModulation(field: string, mod: Modulation): string {
  const base = formatNumber(mod.base);
  const depth = formatNumber(mod.depth);
  return mod.mode === 'add'
    ? `${field} = ${base} + ${depth}*${mod.source}`
    : `${field} = ${base}*(1 + ${depth}*${mod.source})`;
}

function parseModulationBody(field: string, body: string): Modulation | null {
  const f = escapeField(field);
  const num = '([+-]?(?:\\d+\\.?\\d*|\\.\\d+))';
  const src = '([a-z_][a-z0-9_]*)';

  const add = new RegExp(
    `^\\s*${f}\\s*=\\s*${num}\\s*\\+\\s*${num}\\s*\\*\\s*${src}\\s*;?\\s*$`,
    'iu',
  ).exec(body);
  if (add && isSource(add[3])) {
    return {
      base: Number.parseFloat(add[1]),
      depth: Number.parseFloat(add[2]),
      mode: 'add',
      source: add[3],
    };
  }

  const mul = new RegExp(
    `^\\s*${f}\\s*=\\s*${num}\\s*\\*\\s*\\(\\s*1\\s*\\+\\s*${num}\\s*\\*\\s*${src}\\s*\\)\\s*;?\\s*$`,
    'iu',
  ).exec(body);
  if (mul && isSource(mul[3])) {
    return {
      base: Number.parseFloat(mul[1]),
      depth: Number.parseFloat(mul[2]),
      mode: 'multiply',
      source: mul[3],
    };
  }

  return null;
}

/**
 * Finds the per_frame line that assigns `field`, and reports whether it is a
 * modulation this module can edit.
 *
 * Only lines whose *entire* body is one assignment to the field count. A
 * preset that packs several statements onto one `per_frame_N=` line is
 * reported as `custom`: rewriting it would silently drop its neighbours.
 */
export function readModulation(source: string, field: string): ModulationState {
  const assign = new RegExp(`(?:^|;)\\s*${escapeField(field)}\\s*=(?!=)`, 'iu');

  const lines = source.split(/\r?\n/u);
  let inShader = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (SHADER_SECTION.test(trimmed)) inShader = true;
    if (inShader) continue;
    if (perFrameIndex(lines[i]) === null) continue;

    const body = trimmed.slice(trimmed.indexOf('=') + 1);
    if (!assign.test(body)) continue;

    const modulation = parseModulationBody(field, body);
    return modulation
      ? { kind: 'modulated', modulation, line: i + 1 }
      : { kind: 'custom', line: i + 1, text: body.trim() };
  }
  return { kind: 'none' };
}

/**
 * Adds, replaces or removes the modulation line for `field`.
 *
 * per_frame lines are numbered and the compiler runs them in numeric order,
 * so removing one leaves a gap and adding one has to pick a free index; both
 * are handled by renumbering the block contiguously from 1 while preserving
 * its existing order. Passing `null` removes the line.
 *
 * A `custom` equation is never touched — the returned source is unchanged.
 */
export function writeModulation(
  source: string,
  field: string,
  modulation: Modulation | null,
): string {
  const state = readModulation(source, field);
  if (state.kind === 'custom') {
    return source;
  }
  if (state.kind === 'none' && modulation === null) {
    return source;
  }

  const lines = source.split(/\r?\n/u);
  const nextLine =
    modulation === null ? null : formatModulation(field, modulation);

  if (state.kind === 'modulated') {
    if (nextLine === null) {
      lines.splice(state.line - 1, 1);
    } else {
      const index = perFrameIndex(lines[state.line - 1]);
      lines[state.line - 1] = `per_frame_${index ?? 1}=${nextLine}`;
      return renumberPerFrame(lines).join('\n');
    }
    return renumberPerFrame(lines).join('\n');
  }

  // New modulation: place it after the last existing per_frame line so it runs
  // last and wins, or ahead of the shader sections when there are none.
  let lastPerFrame = -1;
  let shaderStart = -1;
  let inShader = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (SHADER_SECTION.test(lines[i].trim())) {
      inShader = true;
      if (shaderStart < 0) shaderStart = i;
    }
    if (!inShader && perFrameIndex(lines[i]) !== null) {
      lastPerFrame = i;
    }
  }

  const insertAt =
    lastPerFrame >= 0
      ? lastPerFrame + 1
      : shaderStart >= 0
        ? shaderStart
        : lines.length;
  lines.splice(insertAt, 0, `per_frame_1=${nextLine}`);
  return renumberPerFrame(lines).join('\n');
}

/** Renumbers every top-level `per_frame_N=` line contiguously from 1, keeping
 * their existing order. The compiler reads them in numeric order, so a gap or
 * a duplicate index silently reorders or drops statements. */
function renumberPerFrame(lines: string[]): string[] {
  let next = 1;
  let inShader = false;
  return lines.map((line) => {
    if (SHADER_SECTION.test(line.trim())) inShader = true;
    if (inShader || perFrameIndex(line) === null) return line;
    const body = line.slice(line.indexOf('=') + 1);
    const renumbered = `per_frame_${next}=${body}`;
    next += 1;
    return renumbered;
  });
}
