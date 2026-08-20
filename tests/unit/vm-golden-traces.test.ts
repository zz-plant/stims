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
});
