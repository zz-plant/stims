/**
 * Static reference analysis of one compiled program block: which variables
 * its code can read, and which it can write.
 *
 * The per-vertex mesh transform (see the app's geometry-builder) seeds a
 * fixed set of built-in per-pixel variables for every mesh point. Most
 * presets touch only a few of them, so the transform asks this analysis
 * once per preset which of the built-ins the per-pixel program actually
 * references, and skips seeding the rest.
 *
 * Names are normalized exactly the way the runtime resolves them
 * (normalizeProgramAssignmentTarget), so an alias spelling (`fzoom` for
 * `zoom`, `Rad` for `rad`) is reported under its canonical key. It is
 * conservative: an identifier that appears anywhere in the block is a
 * reference, whether or not the value it reads ever influences an output.
 */

import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from './common-types.ts';
import { normalizeProgramAssignmentTarget } from './field-normalization.ts';

export type ProgramReferences = {
  /** Every identifier the program can read, as canonical names. */
  reads: ReadonlySet<string>;
  /** Every identifier the program can write, as canonical names: statement
   * targets (already normalized by the compiler) and the lvalues of
   * assignments nested inside expressions. */
  writes: ReadonlySet<string>;
};

const collectReads = (
  node: MilkdropExpressionNode,
  reads: Set<string>,
  writes: Set<string>,
) => {
  switch (node.type) {
    case 'literal':
      return;
    case 'identifier':
      reads.add(normalizeProgramAssignmentTarget(node.name));
      return;
    case 'unary':
      collectReads(node.operand, reads, writes);
      return;
    case 'binary': {
      if (node.operator === '=' && node.left.type === 'identifier') {
        // An assignment lvalue is a pure store, not a read.
        writes.add(normalizeProgramAssignmentTarget(node.left.name));
        collectReads(node.right, reads, writes);
        return;
      }
      collectReads(node.left, reads, writes);
      collectReads(node.right, reads, writes);
      return;
    }
    case 'call':
      for (const arg of node.args) collectReads(arg, reads, writes);
      return;
  }
};

const collectStatement = (
  statement: MilkdropCompiledStatement,
  reads: Set<string>,
  writes: Set<string>,
) => {
  const { control } = statement;
  if (control) {
    if (control.count) collectReads(control.count, reads, writes);
    if (control.condition) collectReads(control.condition, reads, writes);
    for (const inner of control.body) collectStatement(inner, reads, writes);
    return;
  }
  collectReads(statement.expression, reads, writes);
  if (statement.targetExpression) {
    // The index of a megabuf(i) = v store is read, not written.
    collectReads(statement.targetExpression, reads, writes);
    return;
  }
  writes.add(normalizeProgramAssignmentTarget(statement.target));
};

/** Reads and writes of one program block, computed by walking its compiled
 * statements. Blocks are small and compiled once; call sites memoise. */
export function analyzeProgramReferences(
  block: MilkdropProgramBlock,
): ProgramReferences {
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const statement of block.statements) {
    if (statement) collectStatement(statement, reads, writes);
  }
  return { reads, writes };
}
