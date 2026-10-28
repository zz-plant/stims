/**
 * Which sounds drive each field, placed on the lines of code that set it.
 *
 * The Tune pane's chips said this first, but at 1280x720 two of 45 controls
 * showed a chip on the first open and on a phone none did, so the landing's
 * claim ("see which sounds drive it") was not visible in the code it points
 * at (docs/PRODUCT_MOMENTS.md, "Open one up"). The readings are the chips'
 * own: `analyzePresetDataflow` on the compile on stage.
 *
 * Two kinds of line get one:
 * - a field's literal (`zoom=0.99`), when equations overwrite it: the sounds
 *   the drawn value follows, exactly what its chip says (`controlAudio`);
 * - the last assignment to a field in the per-frame or per-pixel equations:
 *   the sounds the value that program leaves behind follows. Earlier
 *   assignments are overwritten by it, so tagging them would claim a
 *   `zoom = 1` line follows the bass.
 */
import { DEFAULT_MILKDROP_STATE } from 'milkdrop-toolchain/src/compiler.ts';
import { normalizeProgramAssignmentTarget } from 'milkdrop-toolchain/src/field-normalization.ts';
import {
  controlAudio,
  type PresetDataflow,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';
import { parsePresetSyntax } from 'milkdrop-toolchain/src/preset-syntax.ts';

export type FieldAudio = { field: string; audio: string[] };
export type LineAudioSources = {
  /** 1-based, as the editor numbers lines. */
  line: number;
  fields: FieldAudio[];
};

/** Per-slot wave and shape fields: not preset-wide controls. */
const SLOT_STATE_KEY = /^(?:custom_wave|shape|wavecode|shapecode)_/u;
const ROOT_EQUATION_KEY = /^per_(frame|pixel)_\d+$/iu;
const PROGRAM_SECTION = /^per_(frame|pixel)$/u;
/** `zoom = …`, `zoom += …`; not `zoom == …`. */
const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[-+*/%^|&]?=(?!=)/u;

/** The preset-wide field `name` spells, by its VM name, or null. */
function builtInField(name: string): string | null {
  const field = normalizeProgramAssignmentTarget(name.toLowerCase());
  return Object.hasOwn(DEFAULT_MILKDROP_STATE, field) &&
    !SLOT_STATE_KEY.test(field)
    ? field
    : null;
}

export function audioSourcesByLine(
  source: string,
  dataflow: PresetDataflow,
): LineAudioSources[] {
  const tagged = new Map<number, FieldAudio[]>();
  const add = (line: number, field: string, audio: string[] | null) => {
    if (!audio?.length) return;
    const fields = tagged.get(line) ?? [];
    fields.push({ field, audio });
    tagged.set(line, fields);
  };
  // Per program, the line holding each field's last assignment.
  const lastAssignment = {
    frame: new Map<string, number>(),
    pixel: new Map<string, number>(),
  };

  for (const line of parsePresetSyntax(source).lines) {
    if (line.kind !== 'assignment' || !line.key) continue;
    const key = line.key;
    const rootProgram = ROOT_EQUATION_KEY.exec(key)?.[1]?.toLowerCase();
    const sectionProgram =
      line.section === null
        ? undefined
        : PROGRAM_SECTION.exec(line.section)?.[1];
    const program = (rootProgram ?? sectionProgram) as
      | 'frame'
      | 'pixel'
      | undefined;
    if (!program) {
      const field = builtInField(key);
      if (field) add(line.number, field, controlAudio(dataflow, field));
      continue;
    }
    // `per_frame_3=zoom = …` carries its code after the key; a line in a
    // `[per_frame]` section is code from its first character.
    const code = rootProgram ? (line.value ?? '') : `${key}=${line.value}`;
    for (const statement of code.split(';')) {
      const name = ASSIGNMENT.exec(statement)?.[1];
      const field = name ? builtInField(name) : null;
      if (field) lastAssignment[program].set(field, line.number);
    }
  }

  for (const [field, line] of lastAssignment.frame) {
    add(line, field, dataflow.variables.get(field)?.audio ?? null);
  }
  for (const [field, line] of lastAssignment.pixel) {
    add(line, field, dataflow.drawnAudio.perPixelOutputs.get(field) ?? null);
  }

  return [...tagged]
    .sort(([a], [b]) => a - b)
    .map(([line, fields]) => ({ line, fields }));
}

/**
 * `← bass, mid, treb` for one field; with several on one line, each is
 * named: `zoom ← bass · rot ← treb`.
 */
export function formatAudioSources(fields: FieldAudio[]): string {
  if (fields.length === 1) return `← ${fields[0]?.audio.join(', ')}`;
  return fields
    .map(({ field, audio }) => `${field} ← ${audio.join(', ')}`)
    .join(' · ');
}
