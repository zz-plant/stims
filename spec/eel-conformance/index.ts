/**
 * Loader for the portable EEL conformance corpus.
 *
 * The corpus itself is language-agnostic JSON under `cases/` — the point of
 * this spec is that a C++ or Rust MilkDrop implementation can run it without
 * touching this repo. This module is the TypeScript binding: it reads the
 * groups, checks the invariants a JSON Schema cannot (globally unique ids,
 * no case without an assertion), and hands back a flat list.
 *
 * Two consumers use it: `tests/unit/eel-conformance-spec.test.ts` (which runs
 * every case against both CPU tiers as part of `bun run check`) and
 * `scripts/eel-conformance-run.ts` (the reference runner, and the worked
 * example for anyone porting the corpus to another language).
 *
 * See README.md for the runner contract — the fixed RNG, the buffer sizes,
 * and the comparison tolerance are all part of the spec, not this file's
 * private choices.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EEL_CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(EEL_CONFORMANCE_DIR, 'cases');

/** Slots supplied to, or asserted against, guest memory: index -> value. */
export type EelSlotMap = Readonly<Record<string, number>>;

export type EelConformanceCase = {
  id: string;
  name: string;
  program: string[];
  env?: Readonly<Record<string, number>>;
  megabuf?: EelSlotMap;
  gmegabuf?: EelSlotMap;
  expected: Readonly<Record<string, number>>;
  expectedMegabuf?: EelSlotMap;
  expectedGmegabuf?: EelSlotMap;
  note?: string;
  status?: 'pinned' | 'provisional';
  /** Section the case was declared in; filled in by the loader. */
  section: string;
};

type CaseGroup = {
  section: string;
  description: string;
  cases: Omit<EelConformanceCase, 'section'>[];
};

/**
 * Both guest buffers are this many f32 slots, zero-filled at block entry.
 * Part of the spec: out-of-range behaviour is only well-defined against a
 * declared size.
 */
export const EEL_CONFORMANCE_BUFFER_SLOTS = 1_048_576;

/**
 * Every `rand()`/`randint()` draw returns exactly this value. Randomness is
 * not the thing under test, and a fixed draw is what makes the random cases
 * portable across implementations with different generators.
 */
export const EEL_CONFORMANCE_RANDOM_DRAW = 0.5;

/** Absolute+relative tolerance for comparing a produced value to `expected`. */
export function eelConformanceTolerance(expected: number) {
  return 1e-12 + Math.abs(expected) * 1e-9;
}

let cached: EelConformanceCase[] | null = null;

export function loadEelConformanceCases(): EelConformanceCase[] {
  if (cached) return cached;

  const files = readdirSync(CASES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No conformance case groups found in ${CASES_DIR}`);
  }

  const all: EelConformanceCase[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const group = JSON.parse(
      readFileSync(join(CASES_DIR, file), 'utf8'),
    ) as CaseGroup;
    if (!group.section || !Array.isArray(group.cases)) {
      throw new Error(`${file}: not a conformance case group`);
    }
    for (const entry of group.cases) {
      const qualified = `${group.section}/${entry.id}`;
      const previous = seen.get(qualified);
      if (previous) {
        throw new Error(
          `Duplicate conformance case id ${qualified} (${previous} and ${file})`,
        );
      }
      seen.set(qualified, file);
      const assertions =
        Object.keys(entry.expected ?? {}).length +
        Object.keys(entry.expectedMegabuf ?? {}).length +
        Object.keys(entry.expectedGmegabuf ?? {}).length;
      if (assertions === 0) {
        throw new Error(`${qualified}: case asserts nothing`);
      }
      all.push({ ...entry, section: group.section });
    }
  }

  cached = all;
  return all;
}

/** Cases whose expected value is confirmed reference behaviour. */
export function pinnedCases() {
  return loadEelConformanceCases().filter((c) => c.status !== 'provisional');
}

/** Cases recording observed behaviour that is not yet confirmed upstream. */
export function provisionalCases() {
  return loadEelConformanceCases().filter((c) => c.status === 'provisional');
}
