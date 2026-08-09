/**
 * End-to-end audio reactivity regression for real catalog presets.
 *
 * `tests/unit/milkdrop-audio-signal-contract.test.ts` pins the *scale* of the
 * signal the runtime produces. This suite checks the other end of the chain:
 * that compiling and running an actual preset against that signal still makes
 * it move. Anything between the two — the compiler, the VM, the per-frame
 * variable plumbing — can break reactivity without changing the signal at all.
 *
 * The metric is deliberately absolute swing, not correlation. Correlation is
 * scale-invariant, so a preset whose `zoom` oscillates by 0.0001 correlates
 * just as perfectly with the beat as one that visibly pulses. That blind spot
 * is why an earlier regression, where bands were fed to presets an order of
 * magnitude too small, passed every existing test.
 */

import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPresetSource,
  measurePresetReactivity,
} from '../../scripts/preset-lab-reactivity.ts';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const WARMUP_FRAMES = 60;
const SAMPLE_FRAMES = 180;
/**
 * Each preset is compiled and stepped through five scenarios, which runs well
 * past Bun's 5s default. This suite lives in the `corpus` (slow) profile, so
 * it is excluded from `bun run check` and runs in `check:all` / `test:compat`.
 */
const PRESET_TIMEOUT_MS = 30_000;

/**
 * Presets driven by the frequency bands (rather than raw waveform geometry),
 * each with a floor set well under its measured swing but far above what the
 * same preset produced when band levels were mis-scaled. The margin column is
 * that separation — only presets with a wide one are worth asserting on, since
 * a narrow margin would make this suite fail on ordinary preset retuning.
 *
 *   preset                       measured  mis-scaled  margin  floor
 *   eos-glowsticks-v2-03-music      1.84       0.18     10.4x   0.80
 *   rovastar-parallel-universe      0.81       0.29      2.8x   0.50
 *   eos-heater-core-c               0.83       0.03     32.0x   0.40
 *
 * `eos-heater-core-c` is the sharpest guard of the three: its shapes gate on
 * `beat = above(bass, bassthresh)` with the threshold decaying toward 1.3, so
 * it goes almost completely still if bands stop crossing 1.0.
 */
const REACTIVITY_FLOORS: ReadonlyArray<{ presetId: string; minSwing: number }> =
  [
    { presetId: 'eos-glowsticks-v2-03-music', minSwing: 0.8 },
    { presetId: 'rovastar-parallel-universe', minSwing: 0.5 },
    { presetId: 'eos-heater-core-c', minSwing: 0.4 },
  ];

/**
 * Widest per-frame swing any tracked variable reaches under any audio-driven
 * scenario — how much the preset actually moves when the music plays.
 */
function measurePeakSwing(presetId: string): {
  swing: number;
  variable: string;
} {
  const source = loadPresetSource(repoRoot, { presetId });
  const report = measurePresetReactivity({
    source,
    warmupFrames: WARMUP_FRAMES,
    sampleFrames: SAMPLE_FRAMES,
  });

  let swing = 0;
  let variable = '';
  for (const entry of report.variables) {
    for (const scenario of Object.values(entry.scenarios)) {
      if (scenario.stdDev > swing) {
        swing = scenario.stdDev;
        variable = entry.variable;
      }
    }
  }
  return { swing, variable };
}

describe('milkdrop preset reactivity', () => {
  for (const { presetId, minSwing } of REACTIVITY_FLOORS) {
    test(
      `${presetId} still visibly moves with the music`,
      () => {
        const { swing, variable } = measurePeakSwing(presetId);
        if (swing <= minSwing) {
          console.error(
            `${presetId}: widest audio-driven swing is ${swing.toFixed(4)} ` +
              `(on "${variable || 'nothing'}"), below the ${minSwing} floor. ` +
              `The preset compiles and runs but barely responds to audio.`,
          );
        }
        expect(swing).toBeGreaterThan(minSwing);
      },
      PRESET_TIMEOUT_MS,
    );
  }
});
