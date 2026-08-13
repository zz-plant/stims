/**
 * Single source of truth for the MilkDrop builtins Stims understands.
 *
 * Three surfaces derive from this table instead of maintaining their own
 * copies (they drifted when they did):
 *
 * - `expression.ts` builds `MILKDROP_INTRINSIC_FUNCTIONS` /
 *   `MILKDROP_INTRINSIC_IDENTIFIERS` — the authoritative compiler sets —
 *   from the non-`editorOnly` function/constant entries here. This module
 *   is imported by workers through that path, so it must stay pure data
 *   with zero imports.
 * - `overlay/editor-language.ts` builds its syntax-highlighting word sets
 *   from the same entries.
 * - `overlay/editor-panel.ts` builds autocomplete options, tab-through
 *   snippet templates, and hover docs from them.
 *
 * When adding a function, keep it in agreement with the evaluator switch in
 * `expression.ts` and remember `scripts/butterchurn-eel-transpiler.ts` emits
 * EEL against this grammar — every call name that transpiler can produce
 * must exist here or imported presets stop compiling.
 */

export type MilkdropBuiltinKind = 'function' | 'variable' | 'constant';

/**
 * Sub-grouping for `kind: 'variable'` entries:
 * - `signal`  — per-frame audio/time inputs fed by the Stims runtime
 *               (highlighted as atoms in the editor).
 * - `state`   — per-frame render state the preset writes (zoom, rot, …).
 * - `register`— q1..q32 / t1..t32 persistent registers.
 */
export type MilkdropBuiltinGroup = 'signal' | 'state' | 'register';

export type MilkdropBuiltinDoc = {
  name: string;
  kind: MilkdropBuiltinKind;
  /** One-line human description, shown in autocomplete detail and hover docs. */
  doc: string;
  /**
   * Parameter names for functions. Entries with two or more parameters get a
   * tab-through snippet template in the editor; single-parameter entries
   * complete as a bare name (matching long-standing editor behavior).
   */
  params?: readonly string[];
  /** Required for `kind: 'variable'` entries; see {@link MilkdropBuiltinGroup}. */
  group?: MilkdropBuiltinGroup;
  /**
   * True for identifiers the editor should highlight/complete even though the
   * expression compiler does not treat them as intrinsics. `variable` entries
   * are never compiler intrinsics regardless of this flag — the compiler
   * resolves them through preset/runtime state, not the intrinsic sets.
   */
  editorOnly?: boolean;
};

/** The VM seeds q1..q32 on reset (see `vm.ts` `reset()`), matching the Geiss spec. */
export const MILKDROP_Q_REGISTER_COUNT = 32;
/** The VM seeds t1..t32 on reset (`MAX_CUSTOM_WAVE_SLOTS` in `vm/shared.ts`). */
export const MILKDROP_T_REGISTER_COUNT = 32;

const FUNCTION_DOCS: readonly MilkdropBuiltinDoc[] = [
  { name: 'sin', kind: 'function', params: ['x'], doc: 'sine' },
  { name: 'cos', kind: 'function', params: ['x'], doc: 'cosine' },
  { name: 'tan', kind: 'function', params: ['x'], doc: 'tangent' },
  { name: 'asin', kind: 'function', params: ['x'], doc: 'arcsine' },
  { name: 'acos', kind: 'function', params: ['x'], doc: 'arccosine' },
  { name: 'atan', kind: 'function', params: ['x'], doc: 'arctangent' },
  {
    name: 'atan2',
    kind: 'function',
    params: ['y', 'x'],
    doc: 'angle of the vector (x, y)',
  },
  { name: 'abs', kind: 'function', params: ['x'], doc: 'absolute value' },
  { name: 'sqrt', kind: 'function', params: ['x'], doc: 'square root' },
  {
    name: 'pow',
    kind: 'function',
    params: ['x', 'y'],
    doc: 'x raised to the power y',
  },
  {
    name: 'mod',
    kind: 'function',
    params: ['x', 'y'],
    doc: 'remainder of x/y (0 when y is 0)',
  },
  {
    name: 'fmod',
    kind: 'function',
    params: ['x', 'y'],
    doc: 'alias of mod',
  },
  {
    name: 'min',
    kind: 'function',
    params: ['a', 'b'],
    doc: 'smaller of a and b',
  },
  {
    name: 'max',
    kind: 'function',
    params: ['a', 'b'],
    doc: 'larger of a and b',
  },
  {
    name: 'mix',
    kind: 'function',
    params: ['a', 'b', 't'],
    doc: 'linear blend from a to b by t',
  },
  {
    name: 'lerp',
    kind: 'function',
    params: ['a', 'b', 't'],
    doc: 'alias of mix',
  },
  { name: 'floor', kind: 'function', params: ['x'], doc: 'round down' },
  { name: 'int', kind: 'function', params: ['x'], doc: 'truncate toward zero' },
  { name: 'ceil', kind: 'function', params: ['x'], doc: 'round up' },
  { name: 'sqr', kind: 'function', params: ['x'], doc: 'x*x' },
  {
    name: 'clamp',
    kind: 'function',
    params: ['x', 'min', 'max'],
    doc: 'clamp(x, min, max)',
  },
  {
    name: 'step',
    kind: 'function',
    params: ['threshold', 'x'],
    doc: '0 when x is below threshold, else 1',
  },
  {
    name: 'smoothstep',
    kind: 'function',
    params: ['min', 'max', 'x'],
    doc: 'smooth 0..1 ramp of x between min and max',
  },
  { name: 'log', kind: 'function', params: ['x'], doc: 'natural logarithm' },
  { name: 'log10', kind: 'function', params: ['x'], doc: 'base-10 logarithm' },
  { name: 'exp', kind: 'function', params: ['x'], doc: 'e raised to x' },
  {
    name: 'sigmoid',
    kind: 'function',
    params: ['x', 'k'],
    doc: 'logistic curve 1/(1+e^(-x*k))',
  },
  { name: 'sign', kind: 'function', params: ['x'], doc: '-1, 0, or 1' },
  {
    name: 'bor',
    kind: 'function',
    params: ['a', 'b'],
    doc: 'logical OR, returns 1 or 0',
  },
  {
    name: 'band',
    kind: 'function',
    params: ['a', 'b'],
    doc: 'logical AND, returns 1 or 0',
  },
  {
    name: 'bnot',
    kind: 'function',
    params: ['x'],
    doc: 'logical NOT, returns 1 or 0',
  },
  { name: 'frac', kind: 'function', params: ['x'], doc: 'fractional part' },
  {
    name: 'if',
    kind: 'function',
    params: ['cond', 'then', 'else'],
    doc: 'if(cond, then, else)',
  },
  { name: 'above', kind: 'function', params: ['a', 'b'], doc: '1 when a > b' },
  { name: 'below', kind: 'function', params: ['a', 'b'], doc: '1 when a < b' },
  {
    name: 'equal',
    kind: 'function',
    params: ['a', 'b'],
    doc: '1 when a and b are (almost) equal',
  },
  { name: 'rand', kind: 'function', params: ['scale'], doc: 'random 0-scale' },
  {
    name: 'randint',
    kind: 'function',
    params: ['max'],
    doc: 'random integer in 0..max-1',
  },
  {
    name: 'megabuf',
    kind: 'function',
    params: ['index'],
    doc: 'per-preset shared value buffer',
  },
  {
    name: 'gmegabuf',
    kind: 'function',
    params: ['index'],
    doc: 'global value buffer shared across presets',
  },
  {
    name: 'exec2',
    kind: 'function',
    params: ['a', 'b'],
    doc: 'evaluate a then b; returns b',
  },
  {
    name: 'exec3',
    kind: 'function',
    params: ['a', 'b', 'c'],
    doc: 'evaluate a, b, c; returns c',
  },
];

const SIGNAL_VARIABLE_DOCS: readonly MilkdropBuiltinDoc[] = [
  { name: 'bass', kind: 'variable', group: 'signal', doc: 'bass energy' },
  { name: 'mid', kind: 'variable', group: 'signal', doc: 'mid energy' },
  { name: 'treb', kind: 'variable', group: 'signal', doc: 'treble energy' },
  {
    name: 'treble',
    kind: 'variable',
    group: 'signal',
    doc: 'alias of treb (Stims runtime signal)',
  },
  {
    name: 'bass_att',
    kind: 'variable',
    group: 'signal',
    doc: 'bass with envelope',
  },
  {
    name: 'mid_att',
    kind: 'variable',
    group: 'signal',
    doc: 'mid with envelope',
  },
  {
    name: 'treb_att',
    kind: 'variable',
    group: 'signal',
    doc: 'treble with envelope',
  },
  {
    name: 'beat',
    kind: 'variable',
    group: 'signal',
    doc: 'beat detector output',
  },
  {
    name: 'beat_pulse',
    kind: 'variable',
    group: 'signal',
    doc: 'beat intensity pulse (Stims runtime signal)',
  },
  {
    name: 'percussive',
    kind: 'variable',
    group: 'signal',
    doc: 'transient/broadband spectral energy (HPSS), relative scale like bass',
  },
  {
    name: 'harmonic',
    kind: 'variable',
    group: 'signal',
    doc: 'sustained/tonal spectral energy (HPSS), relative scale like bass',
  },
  {
    name: 'percussive_low',
    kind: 'variable',
    group: 'signal',
    doc: 'percussive energy in 20-250 Hz (not a kick detector)',
  },
  {
    name: 'percussive_mid',
    kind: 'variable',
    group: 'signal',
    doc: 'percussive energy in 250-4000 Hz (not a snare detector)',
  },
  {
    name: 'percussive_high',
    kind: 'variable',
    group: 'signal',
    doc: 'percussive energy above 4 kHz',
  },
  {
    name: 'percussive_ratio',
    kind: 'variable',
    group: 'signal',
    doc: 'percussive share of total energy, 0..1 (0.5 in silence)',
  },
  {
    name: 'rms',
    kind: 'variable',
    group: 'signal',
    doc: 'overall signal level',
  },
  {
    name: 'vol',
    kind: 'variable',
    group: 'signal',
    doc: 'mean of the relative bands',
  },
  { name: 'time', kind: 'variable', group: 'signal', doc: 'seconds' },
  { name: 'frame', kind: 'variable', group: 'signal', doc: 'frame count' },
  { name: 'fps', kind: 'variable', group: 'signal', doc: 'frames per second' },
  {
    name: 'progress',
    kind: 'variable',
    group: 'signal',
    doc: 'frame count (ProjectM-compatible alias)',
  },
];

const STATE_VARIABLE_DOCS: readonly MilkdropBuiltinDoc[] = [
  {
    name: 'zoom',
    kind: 'variable',
    group: 'state',
    doc: 'zoom amount per frame',
  },
  { name: 'rot', kind: 'variable', group: 'state', doc: 'rotation per frame' },
  { name: 'warp', kind: 'variable', group: 'state', doc: 'warp intensity' },
  { name: 'sx', kind: 'variable', group: 'state', doc: 'stretch along x' },
  { name: 'sy', kind: 'variable', group: 'state', doc: 'stretch along y' },
  { name: 'dx', kind: 'variable', group: 'state', doc: 'translation along x' },
  { name: 'dy', kind: 'variable', group: 'state', doc: 'translation along y' },
  {
    name: 'cx',
    kind: 'variable',
    group: 'state',
    doc: 'zoom/rotation center x',
  },
  {
    name: 'cy',
    kind: 'variable',
    group: 'state',
    doc: 'zoom/rotation center y',
  },
];

const REGISTER_DOCS: readonly MilkdropBuiltinDoc[] = [
  ...Array.from({ length: MILKDROP_Q_REGISTER_COUNT }, (_, i) => ({
    name: `q${i + 1}`,
    kind: 'variable' as const,
    group: 'register' as const,
    doc: 'persistent state, carried frame to frame and into per-pixel code',
  })),
  ...Array.from({ length: MILKDROP_T_REGISTER_COUNT }, (_, i) => ({
    name: `t${i + 1}`,
    kind: 'variable' as const,
    group: 'register' as const,
    doc: 'custom wave/shape scratch register',
  })),
];

const CONSTANT_DOCS: readonly MilkdropBuiltinDoc[] = [
  { name: 'pi', kind: 'constant', doc: 'π (3.14159…)' },
  { name: 'e', kind: 'constant', doc: "Euler's number (2.71828…)" },
];

export const MILKDROP_BUILTIN_DOCS: readonly MilkdropBuiltinDoc[] = [
  ...FUNCTION_DOCS,
  ...SIGNAL_VARIABLE_DOCS,
  ...STATE_VARIABLE_DOCS,
  ...REGISTER_DOCS,
  ...CONSTANT_DOCS,
];

function namesOf(
  kind: MilkdropBuiltinKind,
  filter?: (entry: MilkdropBuiltinDoc) => boolean,
): string[] {
  return MILKDROP_BUILTIN_DOCS.filter(
    (entry) => entry.kind === kind && (filter ? filter(entry) : true),
  ).map((entry) => entry.name);
}

/**
 * Function names the expression compiler accepts. `expression.ts` wraps this
 * in its exported `MILKDROP_INTRINSIC_FUNCTIONS` set.
 */
export const MILKDROP_INTRINSIC_FUNCTION_NAMES: readonly string[] = namesOf(
  'function',
  (entry) => !entry.editorOnly,
);

/**
 * Constant identifiers the expression compiler resolves itself. `expression.ts`
 * wraps this in its exported `MILKDROP_INTRINSIC_IDENTIFIERS` set.
 */
export const MILKDROP_INTRINSIC_IDENTIFIER_NAMES: readonly string[] = namesOf(
  'constant',
  (entry) => !entry.editorOnly,
);

/** Variable names by group, for the editor surfaces. */
export function milkdropVariableNames(group: MilkdropBuiltinGroup): string[] {
  return MILKDROP_BUILTIN_DOCS.filter(
    (entry) => entry.kind === 'variable' && entry.group === group,
  ).map((entry) => entry.name);
}

/**
 * Matches exactly the q/t registers the VM seeds (q1..q32, t1..t32) — no
 * leading zeros, nothing outside the range.
 */
export const MILKDROP_REGISTER_WORD_PATTERN = buildRegisterPattern();

function buildRegisterPattern(): RegExp {
  const range = (count: number) => {
    // 1-9 | 10-29 | 30-32 style alternation for counts up to 39.
    const parts = ['[1-9]'];
    const fullTens = Math.floor(count / 10);
    if (fullTens >= 1) {
      if (fullTens > 1) parts.push(`[1-${fullTens - 1}][0-9]`);
      const rem = count % 10;
      parts.push(rem === 0 ? `${fullTens}0` : `${fullTens}[0-${rem}]`);
    }
    return parts.join('|');
  };
  const q = `q(?:${range(MILKDROP_Q_REGISTER_COUNT)})`;
  const t = `t(?:${range(MILKDROP_T_REGISTER_COUNT)})`;
  return new RegExp(`^(?:${q}|${t})$`);
}

/**
 * Tab-through snippet templates for functions with two or more parameters,
 * in CodeMirror `snippetCompletion` syntax: `clamp(#{x}, #{min}, #{max})`.
 */
export const MILKDROP_FUNCTION_SNIPPET_TEMPLATES: Readonly<
  Record<string, string>
> = Object.fromEntries(
  MILKDROP_BUILTIN_DOCS.filter(
    (entry) =>
      entry.kind === 'function' && entry.params && entry.params.length >= 2,
  ).map((entry) => [
    entry.name,
    `${entry.name}(${(entry.params as readonly string[])
      .map((param) => `#{${param}}`)
      .join(', ')})`,
  ]),
);
