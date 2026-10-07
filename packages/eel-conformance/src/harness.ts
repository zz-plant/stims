/**
 * The runner contract, as code.
 *
 * README.md states in prose what a conforming runner does with a case: seed
 * the environment and both guest buffers, execute the program as one block
 * with a fixed random draw, then compare variables and buffer slots within
 * tolerance. This module does the seeding and the comparing so that an
 * implementation only has to supply the one thing that is actually its own:
 * executing EEL.
 *
 * A runner is a function. It receives the program lines, an environment to
 * mutate, both buffers to mutate, and the random draw to use. Anything it
 * throws is recorded as an error on that case rather than aborting the run,
 * because the useful output of a conformance run is the whole table, not the
 * first crash.
 */
import {
  EEL_CONFORMANCE_BUFFER_SLOTS,
  EEL_CONFORMANCE_RANDOM_DRAW,
  type EelConformanceCase,
  type EelSlotMap,
  eelConformanceTolerance,
  loadEelConformanceCases,
  qualifiedId,
} from './index.ts';

export type EelRunnerInput = {
  /** EEL statements, to be executed in order as one block. */
  program: readonly string[];
  /**
   * Variable state. Seeded from the case's `env`; the runner writes results
   * back here. Keys are lower-case: EEL names are case-insensitive, and the
   * comparison reads them lower-cased.
   */
  env: Record<string, number>;
  /** Per-preset guest buffer, seeded and sized per the specification. */
  megabuf: Float32Array;
  /** Shared guest buffer, seeded and sized per the specification. */
  gmegabuf: Float32Array;
  /** What every `rand()` / `randint()` draw must return. */
  random: () => number;
};

/** Executes one program. Mutates `env`, `megabuf` and `gmegabuf` in place. */
export type EelRunner = (input: EelRunnerInput) => void | Promise<void>;

export type CaseResult = {
  case: EelConformanceCase;
  status: 'pass' | 'fail' | 'error';
  /** One line per mismatch, or the thrown error's message. */
  failures: string[];
};

export type ConformanceReport = {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  /** Failures and errors on pinned cases: these mean non-conformance. */
  pinnedFailures: number;
  /** Failures and errors on provisional cases: open questions, not failures. */
  provisionalFailures: number;
  results: CaseResult[];
};

/** Zero the buffer, then apply the case's slots. Out-of-range slots are ignored. */
export function seedBuffer(
  slots: EelSlotMap | undefined,
  buffer: Float32Array,
): void {
  buffer.fill(0);
  for (const [index, value] of Object.entries(slots ?? {})) {
    const slot = Number(index);
    if (Number.isInteger(slot) && slot >= 0 && slot < buffer.length) {
      buffer[slot] = value;
    }
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

/**
 * Compare a case's expectations against the state a runner left behind.
 * Returns one line per mismatch; an empty array is a pass. Absent variables
 * read as 0, so `{"x": 0}` is a real assertion.
 */
export function checkCase(
  specCase: EelConformanceCase,
  env: Readonly<Record<string, number>>,
  megabuf: Float32Array,
  gmegabuf: Float32Array,
): string[] {
  const failures: string[] = [];
  for (const [key, want] of Object.entries(specCase.expected)) {
    const got = env[key.toLowerCase()] ?? 0;
    if (Math.abs(got - want) > eelConformanceTolerance(want)) {
      failures.push(`${key}: expected ${want}, got ${got}`);
    }
  }
  compareSlots('megabuf', specCase.expectedMegabuf, megabuf, failures);
  compareSlots('gmegabuf', specCase.expectedGmegabuf, gmegabuf, failures);
  return failures;
}

export type RunConformanceOptions = {
  /** Defaults to the whole corpus. */
  cases?: readonly EelConformanceCase[];
  /**
   * Buffers to reuse across cases. They are re-seeded before every case.
   * Supplying them avoids allocating 8 MiB per case; omitting them is fine.
   */
  buffers?: { megabuf: Float32Array; gmegabuf: Float32Array };
};

/**
 * Run every case through `runner` and tabulate the outcome.
 *
 * The buffers are allocated at the full declared size on purpose. An
 * implementation that bounds-checks against its own array length rather
 * than the specified size would read past a short buffer and produce
 * garbage where the specification requires 0.
 */
export async function runConformance(
  runner: EelRunner,
  options: RunConformanceOptions = {},
): Promise<ConformanceReport> {
  const cases = options.cases ?? loadEelConformanceCases();
  const megabuf =
    options.buffers?.megabuf ?? new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS);
  const gmegabuf =
    options.buffers?.gmegabuf ?? new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS);
  if (
    megabuf.length < EEL_CONFORMANCE_BUFFER_SLOTS ||
    gmegabuf.length < EEL_CONFORMANCE_BUFFER_SLOTS
  ) {
    throw new Error(
      `Guest buffers must hold at least ${EEL_CONFORMANCE_BUFFER_SLOTS} slots`,
    );
  }

  const results: CaseResult[] = [];
  for (const specCase of cases) {
    seedBuffer(specCase.megabuf, megabuf);
    seedBuffer(specCase.gmegabuf, gmegabuf);
    const env: Record<string, number> = {};
    for (const [key, value] of Object.entries(specCase.env ?? {})) {
      env[key.toLowerCase()] = value;
    }

    let result: CaseResult;
    try {
      await runner({
        program: specCase.program,
        env,
        megabuf,
        gmegabuf,
        random: () => EEL_CONFORMANCE_RANDOM_DRAW,
      });
      const failures = checkCase(specCase, env, megabuf, gmegabuf);
      result = {
        case: specCase,
        status: failures.length === 0 ? 'pass' : 'fail',
        failures,
      };
    } catch (error) {
      result = {
        case: specCase,
        status: 'error',
        failures: [
          `threw: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
    results.push(result);
  }

  let passed = 0;
  let failed = 0;
  let errored = 0;
  let pinnedFailures = 0;
  let provisionalFailures = 0;
  for (const result of results) {
    if (result.status === 'pass') {
      passed += 1;
      continue;
    }
    if (result.status === 'fail') failed += 1;
    else errored += 1;
    if (result.case.status === 'provisional') provisionalFailures += 1;
    else pinnedFailures += 1;
  }

  return {
    total: results.length,
    passed,
    failed,
    errored,
    pinnedFailures,
    provisionalFailures,
    results,
  };
}

/**
 * Whether a report shows a conforming implementation: every pinned case
 * passed. Provisional cases do not count against conformance; they are the
 * specification's open questions.
 */
export function conforms(report: ConformanceReport): boolean {
  return report.pinnedFailures === 0;
}

/** Human-readable summary, one failure per line, provisional ones marked. */
export function formatReport(
  report: ConformanceReport,
  options: { verbose?: boolean } = {},
): string {
  const lines: string[] = [];
  for (const result of report.results) {
    const id = qualifiedId(result.case);
    const tag = result.case.status === 'provisional' ? ' (provisional)' : '';
    if (result.status === 'pass') {
      if (options.verbose) lines.push(`  ok    ${id}`);
      continue;
    }
    lines.push(`  ${result.status.padEnd(5)} ${id}${tag}`);
    for (const failure of result.failures) lines.push(`        ${failure}`);
  }
  lines.push(
    `EEL conformance: ${report.passed} passed, ${report.failed} failed, ` +
      `${report.errored} errored (${report.total} cases)`,
  );
  if (report.provisionalFailures > 0) {
    lines.push(
      `${report.provisionalFailures} of those are provisional cases: open ` +
        'questions, not conformance failures.',
    );
  }
  lines.push(
    conforms(report)
      ? 'Result: conforms (every pinned case passed).'
      : `Result: does not conform (${report.pinnedFailures} pinned case${
          report.pinnedFailures === 1 ? '' : 's'
        } failed).`,
  );
  return lines.join('\n');
}
