/**
 * Run the portable EEL conformance corpus against this repo's execution tiers.
 *
 * The corpus (spec/eel-conformance/) is the executable specification of
 * MilkDrop EEL platform semantics; `bun run check` enforces it through
 * tests/unit/eel-conformance-spec.test.ts. This CLI is the human-facing view
 * of the same run: it prints a per-section pass/fail table, lists provisional
 * cases (observed behaviour not yet confirmed against ns-eel) separately from
 * pinned ones, and exits non-zero on any failure of a pinned case.
 *
 *   bun run spec:eel                 # all tiers
 *   bun run spec:eel -- --tier jit   # one tier
 *   bun run spec:eel -- --verbose    # per-case lines
 */
import {
  EEL_CONFORMANCE_BUFFER_SLOTS,
  loadEelConformanceCases,
  provisionalCases,
} from '../spec/eel-conformance/index.ts';
import {
  EEL_CONFORMANCE_TIERS,
  type EelConformanceTier,
  runConformanceCase,
} from '../spec/eel-conformance/reference-runner.ts';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const tierArg = args.find((a) => a.startsWith('--tier'));
const requested = tierArg?.includes('=')
  ? tierArg.split('=')[1]
  : tierArg
    ? args[args.indexOf(tierArg) + 1]
    : undefined;

const tiers = (
  requested
    ? EEL_CONFORMANCE_TIERS.filter((t) => t === requested)
    : EEL_CONFORMANCE_TIERS
) as readonly EelConformanceTier[];

if (tiers.length === 0) {
  console.error(
    `Unknown tier "${requested}". Expected one of: ${EEL_CONFORMANCE_TIERS.join(', ')}`,
  );
  process.exit(2);
}

const cases = loadEelConformanceCases();
// Allocated once and re-seeded per case: the full declared size matters (the
// emitted bounds checks compare against it, not the array length).
const megabuf = new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS);
const gmegabuf = new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS);

let failed = 0;
let passed = 0;
let skipped = 0;
const failuresByCase = new Map<string, string[]>();

for (const tier of tiers) {
  for (const specCase of cases) {
    let outcome: ReturnType<typeof runConformanceCase>;
    try {
      outcome = runConformanceCase(specCase, tier, { megabuf, gmegabuf });
    } catch (error) {
      outcome = {
        tier,
        case: specCase,
        status: 'fail',
        failures: [`threw: ${(error as Error).message}`],
      };
    }
    const id = `${specCase.section}/${specCase.id}`;
    if (outcome.status === 'skip') {
      skipped += 1;
      if (verbose)
        console.log(`  skip ${id} [${tier}] — ${outcome.skipReason}`);
      continue;
    }
    if (outcome.status === 'pass') {
      passed += 1;
      if (verbose) console.log(`  ok   ${id} [${tier}]`);
      continue;
    }
    failed += 1;
    const key = `${id} [${tier}]${specCase.status === 'provisional' ? ' (provisional)' : ''}`;
    failuresByCase.set(key, outcome.failures);
  }
}

console.log(
  `\nEEL conformance: ${passed} passed, ${failed} failed, ${skipped} skipped ` +
    `(${cases.length} cases x ${tiers.length} tier${tiers.length === 1 ? '' : 's'})`,
);

if (failuresByCase.size > 0) {
  console.log('\nFailures:');
  for (const [key, failures] of failuresByCase) {
    console.log(`  ${key}`);
    for (const failure of failures) console.log(`      ${failure}`);
  }
}

const provisional = provisionalCases();
if (provisional.length > 0) {
  console.log(
    `\n${provisional.length} provisional case${provisional.length === 1 ? '' : 's'} ` +
      '(observed here, NOT confirmed against ns-eel):',
  );
  for (const specCase of provisional) {
    console.log(`  ${specCase.section}/${specCase.id} — ${specCase.name}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
