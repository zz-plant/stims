/**
 * The variables a preset can own: what the editor's Inspect tab shows.
 *
 * The frame's variable proxy enumerates the VM's whole state — every default,
 * and every field of all 32 custom wave and 32 custom shape slots — so
 * publishing it cost a ~1,650-key snapshot per frame for any preset, and
 * buried the author's handful of variables in built-ins they never touched.
 * Inspect shows what the preset's equations write instead: q1–q32 (the
 * shared registers), every assignment target in the root programs, and each
 * custom wave's or shape's own targets under its frame name (`wave1_t1`).
 */
import { MILKDROP_Q_REGISTER_COUNT } from 'milkdrop-toolchain/src/builtin-docs.ts';
import { flattenProgramStatements } from 'milkdrop-toolchain/src/compiler/program-assembly.ts';
import type { MilkdropCompiledPreset, MilkdropProgramBlock } from './types.ts';

function targetsOf(blocks: readonly MilkdropProgramBlock[]): string[] {
  const names: string[] = [];
  for (const block of blocks) {
    for (const statement of flattenProgramStatements(block.statements)) {
      if (!statement.control && statement.target) names.push(statement.target);
    }
  }
  return names;
}

export function inspectableVariableNames(
  preset: MilkdropCompiledPreset,
): string[] {
  const { ir } = preset;
  const names = Array.from(
    { length: MILKDROP_Q_REGISTER_COUNT },
    (_, i) => `q${i + 1}`,
  );
  names.push(
    ...targetsOf([
      ir.programs.init,
      ir.programs.perFrame,
      ir.programs.perPixel,
    ]),
  );
  // Frame names use the slot's position, as the VM stores its locals.
  ir.customWaves.forEach((wave, slot) => {
    for (const target of targetsOf(Object.values(wave.programs))) {
      names.push(`wave${slot + 1}_${target}`);
    }
  });
  ir.customShapes.forEach((shape, slot) => {
    for (const target of targetsOf(Object.values(shape.programs))) {
      names.push(`shape${slot + 1}_${target}`);
    }
  });
  return names.filter((name, index) => names.indexOf(name) === index);
}
