/**
 * Loader for the portable EEL conformance corpus.
 *
 * The corpus itself is language-agnostic JSON under `cases/`. The point of
 * this specification is that a C++, Rust or JavaScript MilkDrop
 * implementation can run it without depending on any particular engine.
 * This module is the TypeScript binding: it reads the groups, checks the
 * invariants a JSON Schema cannot express (globally unique ids, no case
 * without an assertion), and hands back a flat list.
 *
 * See README.md for the runner contract. The fixed RNG draw, the buffer
 * sizes and the comparison tolerance are part of the specification, not
 * this file's private choices; they are exported here so a TypeScript runner
 * can import them instead of retyping them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the `cases/` directory shipped with this package. */
export const EEL_CONFORMANCE_CASES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'cases',
);

/** Slots supplied to, or asserted against, guest memory: index -> value. */
export type EelSlotMap = Readonly<Record<string, number>>;

export type EelCaseStatus = 'pinned' | 'provisional';

export type EelConformanceCase = {
  /** Stable identifier, unique within its section. */
  id: string;
  /** One sentence stating the rule the case pins. */
  name: string;
  /** EEL statements, executed in order as one block. */
  program: string[];
  /** Initial variable values. Absent variables start at 0. */
  env?: Readonly<Record<string, number>>;
  /** Initial `megabuf` slots. Absent slots start at 0. */
  megabuf?: EelSlotMap;
  /** Initial `gmegabuf` slots. Absent slots start at 0. */
  gmegabuf?: EelSlotMap;
  /** Required variable values after the block runs. */
  expected: Readonly<Record<string, number>>;
  expectedMegabuf?: EelSlotMap;
  expectedGmegabuf?: EelSlotMap;
  /** Why the value is what it is, and what depends on it. */
  note?: string;
  /**
   * `pinned` (the default) is documented MilkDrop 2.x / ns-eel behaviour.
   * `provisional` is observed behaviour not yet confirmed upstream: a
   * question, not a requirement.
   */
  status?: EelCaseStatus;
  /** Section the case was declared in; filled in by the loader. */
  section: string;
};

export type EelCaseGroup = {
  /** Stable kebab-case section id. */
  section: string;
  description: string;
  /** The file the group was read from, relative to `cases/`. */
  file: string;
  cases: EelConformanceCase[];
};

/**
 * Both guest buffers hold this many f32 slots, zero-filled at block entry.
 * Part of the specification: out-of-range behaviour is only well defined
 * against a declared size.
 */
export const EEL_CONFORMANCE_BUFFER_SLOTS = 1_048_576;

/**
 * Every `rand()` / `randint()` draw returns exactly this value. Randomness is
 * not what the cases test, and a fixed draw is what makes the random cases
 * portable across implementations with different generators.
 */
export const EEL_CONFORMANCE_RANDOM_DRAW = 0.5;

/** Absolute plus relative tolerance for comparing a value to `expected`. */
export function eelConformanceTolerance(expected: number): number {
  return 1e-12 + Math.abs(expected) * 1e-9;
}

/** True when `got` is within the specification's tolerance of `want`. */
export function withinTolerance(got: number, want: number): boolean {
  return Math.abs(got - want) <= eelConformanceTolerance(want);
}

type RawGroup = {
  section?: unknown;
  description?: unknown;
  cases?: unknown;
};

let cachedGroups: EelCaseGroup[] | null = null;

function assertionCount(entry: Omit<EelConformanceCase, 'section'>): number {
  return (
    Object.keys(entry.expected ?? {}).length +
    Object.keys(entry.expectedMegabuf ?? {}).length +
    Object.keys(entry.expectedGmegabuf ?? {}).length
  );
}

/**
 * Reads every group under `cases/`, in file order, and checks the
 * invariants the schema cannot: unique qualified ids and at least one
 * assertion per case.
 */
export function loadEelCaseGroups(
  casesDir: string = EEL_CONFORMANCE_CASES_DIR,
): EelCaseGroup[] {
  if (cachedGroups && casesDir === EEL_CONFORMANCE_CASES_DIR) {
    return cachedGroups;
  }

  const files = readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No conformance case groups found in ${casesDir}`);
  }

  const groups: EelCaseGroup[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const raw = JSON.parse(
      readFileSync(join(casesDir, file), 'utf8'),
    ) as RawGroup;
    if (typeof raw.section !== 'string' || !Array.isArray(raw.cases)) {
      throw new Error(`${file}: not a conformance case group`);
    }
    const section = raw.section;
    const cases: EelConformanceCase[] = [];
    for (const entry of raw.cases as Omit<EelConformanceCase, 'section'>[]) {
      const qualified = `${section}/${entry.id}`;
      const previous = seen.get(qualified);
      if (previous) {
        throw new Error(
          `Duplicate conformance case id ${qualified} (${previous} and ${file})`,
        );
      }
      seen.set(qualified, file);
      if (assertionCount(entry) === 0) {
        throw new Error(`${qualified}: case asserts nothing`);
      }
      cases.push({ ...entry, section });
    }
    groups.push({
      section,
      description: typeof raw.description === 'string' ? raw.description : '',
      file,
      cases,
    });
  }

  if (casesDir === EEL_CONFORMANCE_CASES_DIR) cachedGroups = groups;
  return groups;
}

/** Every case in the corpus, flat, in section then declaration order. */
export function loadEelConformanceCases(
  casesDir: string = EEL_CONFORMANCE_CASES_DIR,
): EelConformanceCase[] {
  return loadEelCaseGroups(casesDir).flatMap((group) => group.cases);
}

/** Cases whose expected value is confirmed reference behaviour. */
export function pinnedCases(
  casesDir: string = EEL_CONFORMANCE_CASES_DIR,
): EelConformanceCase[] {
  return loadEelConformanceCases(casesDir).filter(
    (c) => c.status !== 'provisional',
  );
}

/** Cases recording observed behaviour not yet confirmed upstream. */
export function provisionalCases(
  casesDir: string = EEL_CONFORMANCE_CASES_DIR,
): EelConformanceCase[] {
  return loadEelConformanceCases(casesDir).filter(
    (c) => c.status === 'provisional',
  );
}

/** `section/id`, the name other implementations track a case by. */
export function qualifiedId(
  specCase: Pick<EelConformanceCase, 'section' | 'id'>,
) {
  return `${specCase.section}/${specCase.id}`;
}

export {
  type CaseResult,
  type ConformanceReport,
  checkCase,
  conforms,
  type EelRunner,
  type EelRunnerInput,
  formatReport,
  runConformance,
  seedBuffer,
} from './harness.ts';
