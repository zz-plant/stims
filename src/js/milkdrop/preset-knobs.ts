/**
 * Parameter knobs: the constants a preset author tunes.
 *
 * MilkDrop has no parameter syntax, but authors write one anyway: a variable
 * given a literal value once in `per_frame_init` and then only read
 * (`speed = 1.5` in init, `rot = rot + speed*0.01` per frame). That shape *is*
 * a parameter, so the editor can offer it as a slider with no new syntax,
 * nothing for other engines to trip on, and nothing Format could strip.
 *
 * A variable assigned anywhere else (per-frame, per-pixel, wave or shape
 * code) is state, not a parameter (`beat = 0`, `vol = 0`), and is left out.
 * So is one that is set and never read, which a slider could not affect.
 * So are built-in render fields and audio inputs, which have their own
 * controls or are read-only.
 */
import { milkdropVariableNames } from 'milkdrop-toolchain/src/builtin-docs.ts';
import { DEFAULT_MILKDROP_STATE } from 'milkdrop-toolchain/src/compiler/default-state.ts';
import { normalizeProgramAssignmentTarget } from 'milkdrop-toolchain/src/field-normalization.ts';

export type PresetKnob = {
  name: string;
  value: number;
  /** 1-based line of the `per_frame_init_N=` line holding the literal. */
  line: number;
  /** Character offsets of the literal within that line. */
  from: number;
  to: number;
  min: number;
  max: number;
};

const RESERVED = new Set([
  ...milkdropVariableNames('state'),
  ...milkdropVariableNames('signal'),
  ...Object.keys(DEFAULT_MILKDROP_STATE),
  // Per-pixel inputs and the per-point/per-shape locals of custom waves and
  // shapes. A read of `rad` in per-pixel code is the built-in, not the
  // author's variable of the same name.
  'x',
  'y',
  'rad',
  'ang',
  'sample',
  'value1',
  'value2',
  'r',
  'g',
  'b',
  'a',
  'r2',
  'g2',
  'b2',
  'a2',
]);

/** Built-in render fields and inputs, under any of their spellings. */
function isReserved(name: string): boolean {
  return (
    RESERVED.has(name) || RESERVED.has(normalizeProgramAssignmentTarget(name))
  );
}

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LITERAL_ASSIGNMENT = new RegExp(
  String.raw`^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(${NUMBER})\s*$`,
  'u',
);
/** Any assignment, including compound (`x += 1`), but not `==`. */
const ASSIGNMENT =
  /(?:^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\s*(?:[-+*/%^|&]|<<|>>)?=(?!=)/gu;
const PROGRAM_KEY =
  /^(per_frame_init_\d+|init_\d+|per_frame_\d+|per_pixel_\d+|(?:wave|shape)_\d+_(?:init|per_frame|per_point)\d*)\s*=/iu;

function stripComment(text: string): string {
  const cut = text.indexOf('//');
  return cut < 0 ? text : text.slice(0, cut);
}

/**
 * A slider range centred on the value: 0..2v for a positive value, 2v..0 for
 * a negative one. Scaled to the value rather than a fixed 0..1, because
 * parameters span orders of magnitude (a radius of 0.01, a frame count of
 * 128) and a fixed range would pin most of them to one end of the track.
 */
export function knobRange(value: number): { min: number; max: number } {
  if (value === 0) return { min: -1, max: 1 };
  const span = Math.abs(value) * 2;
  return value > 0 ? { min: 0, max: span } : { min: -span, max: 0 };
}

export function findPresetKnobs(source: string): PresetKnob[] {
  const lines = source.split(/\r?\n/u);
  const initLiterals = new Map<string, Omit<PresetKnob, 'min' | 'max'>>();
  const initAssignCount = new Map<string, number>();
  const assignedElsewhere = new Set<string>();
  /** Every identifier-shaped word in program (and shader) code, counted. */
  const wordCounts = new Map<string, number>();
  const countWords = (code: string) => {
    for (const match of code.matchAll(/[A-Za-z_][A-Za-z0-9_]*/gu)) {
      const word = match[0].toLowerCase();
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  };
  let inShader = false;

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (/^\[\s*(?:warp|comp)_shader\s*\]$/iu.test(trimmed)) inShader = true;
    if (inShader) {
      // Shaders read q1..q32, so a q-var used only there is still a knob.
      countWords(stripComment(raw));
      return;
    }
    const key = PROGRAM_KEY.exec(trimmed);
    if (!key) {
      // `warp_1=` / `comp_1=` backtick shader lines.
      if (/^(?:warp|comp)_\d+\s*=/iu.test(trimmed)) {
        countWords(stripComment(raw.slice(raw.indexOf('=') + 1)));
      }
      return;
    }
    // `init_N` is an older Stims spelling of `per_frame_init_N`, still in
    // drafts saved before the formatter stopped writing it.
    const isInit = /^(?:per_frame_)?init_/iu.test(key[1] as string);
    const valueStart = raw.indexOf('=') + 1;
    const code = stripComment(raw.slice(valueStart));
    countWords(code);

    if (!isInit) {
      for (const match of code.matchAll(ASSIGNMENT)) {
        assignedElsewhere.add((match[1] as string).toLowerCase());
      }
      return;
    }

    // Walk the init line statement by statement, keeping offsets so a knob
    // can rewrite exactly its literal.
    let offset = valueStart;
    for (const statement of code.split(';')) {
      const literal = LITERAL_ASSIGNMENT.exec(statement);
      for (const match of statement.matchAll(ASSIGNMENT)) {
        const name = (match[1] as string).toLowerCase();
        initAssignCount.set(name, (initAssignCount.get(name) ?? 0) + 1);
      }
      if (literal) {
        const name = (literal[1] as string).toLowerCase();
        const text = literal[2] as string;
        const at = statement.lastIndexOf(text);
        initLiterals.set(name, {
          name: literal[1] as string,
          value: Number.parseFloat(text),
          line: index + 1,
          from: offset + at,
          to: offset + at + text.length,
        });
      }
      offset += statement.length + 1;
    }
  });

  const knobs: PresetKnob[] = [];
  for (const [key, knob] of initLiterals) {
    if (isReserved(key)) continue;
    if (assignedElsewhere.has(key)) continue;
    // Assigned more than once in init means it is computed, not a constant.
    if ((initAssignCount.get(key) ?? 0) !== 1) continue;
    // Set and never read: a knob on it would move nothing. The single
    // occurrence is the assignment itself.
    if ((wordCounts.get(key) ?? 0) < 2) continue;
    if (!Number.isFinite(knob.value)) continue;
    knobs.push({ ...knob, ...knobRange(knob.value) });
  }
  return knobs.sort((a, b) => a.line - b.line || a.from - b.from);
}

/**
 * Format a knob value the way a hand-written preset would: four significant
 * digits, so 0.01 moves in steps of 0.0001 and 128 in whole numbers.
 */
export function formatKnobValue(value: number): string {
  if (value === 0) return '0';
  return String(Number(value.toPrecision(4)));
}

/** `source` with `knob`'s literal replaced by `value`. */
export function setKnobValue(
  source: string,
  knob: PresetKnob,
  value: number,
): string {
  const lines = source.split('\n');
  const line = lines[knob.line - 1];
  if (line === undefined) return source;
  lines[knob.line - 1] =
    line.slice(0, knob.from) + formatKnobValue(value) + line.slice(knob.to);
  return lines.join('\n');
}
