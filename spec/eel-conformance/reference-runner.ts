/**
 * Reference implementation of the EEL conformance runner contract.
 *
 * This is the worked example the README's "Runner contract" section
 * describes in prose: it shows exactly what a conforming runner must do with
 * a case — seed the environment and both guest buffers, execute the program
 * as ONE block, then compare variables and buffer slots within tolerance.
 * A port to another language should be able to follow this file line for
 * line.
 *
 * Three tiers are exercised, because "the interpreter" is two different
 * things in this codebase and the distinction is part of the platform:
 *   - `expression`     evaluates one statement's AST at a time. It has no
 *                      notion of loop()/while(), so cases that use control
 *                      flow are reported as skipped rather than failed.
 *   - `interpreter`    the interpreter-backed program executor used when a
 *                      Content-Security-Policy forbids `new Function`.
 *   - `jit`            the `new Function` program executor.
 *
 * Buffers are allocated at the full declared size on purpose. The emitted
 * bounds checks compare against MILKDROP_MEGABUF_SIZE rather than the array
 * length, so a short buffer would read past its end and yield NaN instead of
 * the specified 0.
 */

import type {
  MilkdropCompiledStatement,
  MilkdropProgramBlock,
} from '../../src/js/milkdrop/common-types.ts';
import {
  evaluateMilkdropExpression,
  parseMilkdropStatement,
} from '../../src/js/milkdrop/expression.ts';
import {
  __setJitAvailableForTests,
  compileMilkdropProgram,
} from '../../src/js/milkdrop/expression-jit.ts';
import {
  EEL_CONFORMANCE_BUFFER_SLOTS,
  EEL_CONFORMANCE_RANDOM_DRAW,
  type EelConformanceCase,
  type EelSlotMap,
  eelConformanceTolerance,
} from './index.ts';

export const EEL_CONFORMANCE_TIERS = [
  'expression',
  'interpreter',
  'jit',
] as const;
export type EelConformanceTier = (typeof EEL_CONFORMANCE_TIERS)[number];

export type CaseOutcome = {
  tier: EelConformanceTier;
  case: EelConformanceCase;
  status: 'pass' | 'fail' | 'skip';
  failures: string[];
  skipReason?: string;
};

/** Fresh parse per run: compileMilkdropProgram memoises per block object. */
function parseProgram(program: string[]): MilkdropProgramBlock {
  const statements: MilkdropCompiledStatement[] = [];
  for (const [index, line] of program.entries()) {
    const parsed = parseMilkdropStatement(line, index + 1);
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    if (!parsed.value || errors.length > 0) {
      throw new Error(
        `failed to parse "${line}": ${errors.map((d) => d.message).join('; ') || 'no statement produced'}`,
      );
    }
    statements.push(parsed.value);
  }
  return { statements, sourceLines: [...program] };
}

function usesControlFlow(block: MilkdropProgramBlock) {
  return block.statements.some((statement) => Boolean(statement?.control));
}

function seedBuffer(slots: EelSlotMap | undefined, buffer: Float32Array) {
  buffer.fill(0);
  for (const [index, value] of Object.entries(slots ?? {})) {
    const slot = Number(index);
    if (slot >= 0 && slot < buffer.length) {
      buffer[slot] = value;
    }
  }
}

/**
 * The direct AST-evaluation tier. Buffer stores are a statement-level
 * concern (`target: 'megabuf'` plus `targetExpression` for the index), not
 * something the expression evaluator does, so the caller applies them —
 * which is exactly what the VM does in production.
 */
function runExpressionTier(
  block: MilkdropProgramBlock,
  env: Record<string, number>,
  megabuf: Float32Array,
  gmegabuf: Float32Array,
) {
  const read = (buffer: Float32Array) => (index: number) => {
    const slot = Math.trunc(index);
    return slot >= 0 && slot < buffer.length ? (buffer[slot] as number) : 0;
  };
  const write = (buffer: Float32Array) => (index: number, value: number) => {
    const slot = Math.trunc(index);
    if (slot >= 0 && slot < buffer.length) {
      buffer[slot] = value;
    }
  };
  const helpers = {
    nextRandom: () => EEL_CONFORMANCE_RANDOM_DRAW,
    megabuf: read(megabuf),
    gmegabuf: read(gmegabuf),
    megabufWrite: write(megabuf),
    gmegabufWrite: write(gmegabuf),
  };

  for (const statement of block.statements) {
    if (!statement) continue;
    const raw = evaluateMilkdropExpression(statement.expression, env, helpers);
    const value = Number.isFinite(raw) ? raw : 0;
    if (statement.target === 'megabuf' || statement.target === 'gmegabuf') {
      const index = statement.targetExpression
        ? evaluateMilkdropExpression(statement.targetExpression, env, helpers)
        : 0;
      (statement.target === 'megabuf'
        ? helpers.megabufWrite
        : helpers.gmegabufWrite)(index, value);
      continue;
    }
    if (statement.target && statement.target !== '__control__') {
      env[statement.target.toLowerCase()] = value;
    }
  }
}

function runCompiledTier(
  block: MilkdropProgramBlock,
  env: Record<string, number>,
  megabuf: Float32Array,
  gmegabuf: Float32Array,
  jit: boolean,
) {
  __setJitAvailableForTests(jit);
  try {
    compileMilkdropProgram(block)(
      env,
      {},
      {},
      null,
      megabuf,
      gmegabuf,
      () => EEL_CONFORMANCE_RANDOM_DRAW,
    );
  } finally {
    __setJitAvailableForTests(null);
  }
}

function compareSlots(
  label: string,
  expected: EelSlotMap | undefined,
  buffer: Float32Array,
  failures: string[],
) {
  for (const [index, want] of Object.entries(expected ?? {})) {
    const slot = Number(index);
    const got =
      slot >= 0 && slot < buffer.length ? (buffer[slot] as number) : 0;
    if (Math.abs(got - want) > eelConformanceTolerance(want)) {
      failures.push(`${label}(${index}): expected ${want}, got ${got}`);
    }
  }
}

export function runConformanceCase(
  specCase: EelConformanceCase,
  tier: EelConformanceTier,
  buffers?: { megabuf: Float32Array; gmegabuf: Float32Array },
): CaseOutcome {
  const megabuf =
    buffers?.megabuf ?? new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS);
  const gmegabuf =
    buffers?.gmegabuf ?? new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS);
  seedBuffer(specCase.megabuf, megabuf);
  seedBuffer(specCase.gmegabuf, gmegabuf);

  const env: Record<string, number> = { ...(specCase.env ?? {}) };
  const block = parseProgram(specCase.program);

  if (tier === 'expression' && usesControlFlow(block)) {
    return {
      tier,
      case: specCase,
      status: 'skip',
      failures: [],
      skipReason: 'control flow is a program-executor concern',
    };
  }

  if (tier === 'expression') {
    runExpressionTier(block, env, megabuf, gmegabuf);
  } else {
    runCompiledTier(block, env, megabuf, gmegabuf, tier === 'jit');
  }

  const failures: string[] = [];
  for (const [key, want] of Object.entries(specCase.expected)) {
    const got = env[key] ?? 0;
    if (Math.abs(got - want) > eelConformanceTolerance(want)) {
      failures.push(`${key}: expected ${want}, got ${got}`);
    }
  }
  compareSlots('megabuf', specCase.expectedMegabuf, megabuf, failures);
  compareSlots('gmegabuf', specCase.expectedGmegabuf, gmegabuf, failures);

  return {
    tier,
    case: specCase,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
  };
}
