/**
 * Error-tolerant compilation for generated presets.
 *
 * Real MilkDrop silently no-ops equation lines that fail to evaluate, and a
 * preset renders with whatever survived. Generated presets get the same
 * grace: instead of rejecting a whole preset over one unbalanced
 * parenthesis, drop the offending equation line and recompile. Curated
 * catalog presets deliberately do NOT go through this path — for them a new
 * compile error is a regression signal, not noise to paper over.
 */

import { compileMilkdropPresetSource } from './compiler.ts';
import type { MilkdropCompiledPreset } from './types.ts';

/** Matches reactivity-probe's notion of equation-carrying keys. Only these
 * lines are droppable — an error on a structural line ([preset00], plain
 * params) means the source is malformed beyond line-level repair. */
const EQUATION_KEY_PATTERN =
  /^(?:per_frame|per_pixel|init|wavecode|shapecode|warp|comp)/iu;

export type SalvagedLine = {
  /** 1-based line number in the original source. */
  line: number;
  text: string;
  message: string;
};

export type SalvageCompileResult = {
  compiled: MilkdropCompiledPreset;
  /** Equation lines removed to reach a clean compile; empty when the source
   * compiled as-is. */
  dropped: SalvagedLine[];
};

type CompileSource = Parameters<typeof compileMilkdropPresetSource>[1];

/** Rough preset-richness signal: how many equation-carrying lines the
 * source defines. Used to break ties between generation candidates. */
export function countEquationLines(raw: string): number {
  let count = 0;
  for (const line of raw.split(/\r?\n/u)) {
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    if (EQUATION_KEY_PATTERN.test(line.slice(0, equalsIndex).trim())) count++;
  }
  return count;
}

/**
 * Compile `raw`, dropping error-attributed equation lines until the preset
 * compiles cleanly. Returns null when the source is beyond salvage: an error
 * without a line number, an error on a non-equation line, no progress
 * between rounds, or more than `maxDrops` casualties (at which point the
 * model output is judged garbage rather than a preset with slips).
 */
export function salvageCompileMilkdropPreset(
  raw: string,
  source: CompileSource,
  { maxDrops = 12 }: { maxDrops?: number } = {},
): SalvageCompileResult | null {
  // Lines are blanked rather than spliced so diagnostic line numbers from
  // later rounds still index into the original source.
  const lines = raw.split(/\r?\n/u);
  const dropped: SalvagedLine[] = [];

  for (;;) {
    const compiled = compileMilkdropPresetSource(lines.join('\n'), source);
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length === 0) {
      return { compiled, dropped };
    }

    const roundDrops = new Map<number, string>();
    for (const error of errors) {
      if (typeof error.line !== 'number') return null;
      const index = error.line - 1;
      const text = lines[index];
      if (text === undefined || text.trim() === '') {
        // Error attributed to a line already blanked (or out of range):
        // dropping lines is not converging on a clean compile.
        return null;
      }
      const key = text.slice(0, Math.max(0, text.indexOf('='))).trim();
      if (!EQUATION_KEY_PATTERN.test(key)) return null;
      if (!roundDrops.has(index)) roundDrops.set(index, error.message);
    }

    if (dropped.length + roundDrops.size > maxDrops) return null;
    for (const [index, message] of roundDrops) {
      dropped.push({ line: index + 1, text: lines[index] as string, message });
      lines[index] = '';
    }
  }
}
