/**
 * Golden-trace gate: the VM must replay the checked-in witness traces
 * bit-for-bit. Any compiler/VM/signal-tracker change that alters per-frame
 * state for these presets fails here with the first divergent frame (and,
 * on checkpoint frames, the exact variables that moved).
 *
 * The witnesses cover distinct semantic surfaces: shape-instance-heavy
 * (khazad-dum), pi/e-overwriting (life-after-pie-remix), light blur-rule
 * classic (geiss-game-of-life), and megabuf-using (alien-fish-pond).
 *
 * An INTENDED semantics change (a platform-profile decision — see
 * tests/unit/eel-conformance-spec.test.ts) is re-baselined by re-recording:
 *
 *   bun run lab:replay -- --preset <id> --record performance/traces/<id>.json --frames 120 --compact
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPresetSource } from '../../scripts/preset-lab-reactivity.ts';
import {
  compareReplay,
  runTrace,
  type TraceFile,
  traceInputs,
} from '../../scripts/preset-lab-replay.ts';

const repoRoot = join(import.meta.dir, '..', '..');
const tracesDir = join(repoRoot, 'performance', 'traces');

describe('VM golden traces', () => {
  const traceFiles = readdirSync(tracesDir).filter((name) =>
    name.endsWith('.json'),
  );

  test('witness traces exist', () => {
    expect(traceFiles.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of traceFiles) {
    test(`replays ${name} bit-for-bit`, () => {
      const trace = JSON.parse(
        readFileSync(join(tracesDir, name), 'utf8'),
      ) as TraceFile;
      const source = loadPresetSource(repoRoot, { presetId: trace.presetId });
      const replayed = runTrace(source.raw, trace.presetId, traceInputs(trace));
      const divergence = compareReplay(trace, replayed);
      expect(
        divergence === null,
        divergence
          ? `diverged at frame ${divergence.frame}:\n${divergence.details.join('\n')}\n` +
              'If this change is an intended platform-semantics decision, re-record the trace (see file header).'
          : '',
      ).toBe(true);
    });
  }

  /**
   * The gate's own regression guard.
   *
   * Both halves of the bargain, because each without the other is worthless.
   *
   * Portability: preset state is computed with `Math.sin`/`cos`/`exp`/`pow`,
   * which ECMA-262 permits to be implementation-defined approximations and
   * which differ by a few ULP across engine, platform libm and CPU
   * architecture. Perturbing every transcendental by 1 ULP is what a foreign
   * libm looks like from here. This gate has twice been pinned to whichever
   * machine recorded the traces — first bit-for-bit, then via a
   * digest-mismatch escalation that compared the replay's variables against
   * the `undefined` a compact frame does not store, and so reported every
   * variable as moved. Both times it was green for its author and red for
   * everyone else.
   *
   * Sensitivity: a tolerance is only legitimate while the gate still bites,
   * so a deliberate 0.1% semantics change must still be caught in every
   * witness.
   */
  describe('stays portable without going blind', () => {
    const originalMath = {
      sin: Math.sin,
      cos: Math.cos,
      exp: Math.exp,
      pow: Math.pow,
      log: Math.log,
      tan: Math.tan,
      atan2: Math.atan2,
    };
    const scratch = new ArrayBuffer(8);
    const asFloat = new Float64Array(scratch);
    const asBits = new BigUint64Array(scratch);
    /** The next representable double away from zero: a 1-ULP perturbation. */
    const nextUp = (value: number) => {
      if (!Number.isFinite(value) || value === 0) {
        return value;
      }
      asFloat[0] = value;
      asBits[0] += 1n;
      return asFloat[0];
    };

    // Built BEFORE Math is patched: buildScenarioInputs synthesises the
    // spectrum with Math.sin, so patching first would perturb the stimulus
    // rather than the VM — a different and much larger test.
    const cases = traceFiles.map((name) => {
      const trace = JSON.parse(
        readFileSync(join(tracesDir, name), 'utf8'),
      ) as TraceFile;
      return {
        name,
        trace,
        raw: loadPresetSource(repoRoot, { presetId: trace.presetId }).raw,
        inputs: traceInputs(trace),
      };
    });

    /**
     * Both cases below replay every witness (4 presets x 120 frames) with each
     * transcendental wrapped in a JS shim, which is far slower than the plain
     * replay above. That took ~6s on CI runners and tripped Bun's 5s default,
     * failing as a timeout rather than on anything it measured. The work is
     * inherent to what these tests check, so they get room instead of being
     * thinned out — a portability guard that only runs on fast hardware is the
     * failure mode this whole describe block exists to prevent.
     */
    const SLOW_REPLAY_TIMEOUT_MS = 30_000;

    const divergedUnder = (patch: (original: typeof originalMath) => void) => {
      try {
        patch({ ...originalMath });
        return cases
          .filter(
            (entry) =>
              compareReplay(
                entry.trace,
                runTrace(entry.raw, entry.trace.presetId, entry.inputs),
              ) !== null,
          )
          .map((entry) => entry.name);
      } finally {
        Object.assign(Math, originalMath);
      }
    };

    test(
      'replays clean under a foreign libm (1-ULP transcendentals)',
      () => {
        expect(
          divergedUnder((original) => {
            Math.sin = (x) => nextUp(original.sin(x));
            Math.cos = (x) => nextUp(original.cos(x));
            Math.exp = (x) => nextUp(original.exp(x));
            Math.log = (x) => nextUp(original.log(x));
            Math.tan = (x) => nextUp(original.tan(x));
            Math.pow = (a, b) => nextUp(original.pow(a, b));
            Math.atan2 = (a, b) => nextUp(original.atan2(a, b));
          }),
        ).toEqual([]);
      },
      SLOW_REPLAY_TIMEOUT_MS,
    );

    test(
      'still catches a 0.1% semantics change in every witness',
      () => {
        const diverged = divergedUnder((original) => {
          Math.sin = (x) => original.sin(x) * 1.001;
        });
        expect(diverged.sort()).toEqual([...traceFiles].sort());
      },
      SLOW_REPLAY_TIMEOUT_MS,
    );
  });
});
