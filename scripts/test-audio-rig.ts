/**
 * Deterministic synthetic audio rig.
 *
 * Asserts that the headless audio scenarios in `preset-lab-metrics.ts` are
 * reproducible and actually carry the signal they claim to, and that driving a
 * preset's VM with them twice produces byte-identical reactivity numbers.
 *
 *   bun run test:audio-rig                     # default preset
 *   bun run test:audio-rig -- --preset <id>    # a specific catalog preset
 *
 * Why this is a rig and not another generator: the scenario waveform/spectrum
 * synthesis, the 120 BPM beat-spike envelope and the band-isolated pulses
 * already exist and are what `lab:reactivity` measures against. Adding a
 * second, parallel generator would mean the reactivity lab and its test rig
 * could disagree about what "bass pulse" means — the one failure this is
 * supposed to catch. So this drives the real generators and checks them; the
 * only synthesis added alongside it is the `sweep` scenario, which lives with
 * its siblings in preset-lab-metrics.ts.
 */

import {
  fillScenarioSpectrum,
  fillScenarioWaveform,
  PRESET_LAB_SPECTRUM_BINS,
  type PresetLabScenario,
  SCENARIO_SWEEP_PERIOD_MS,
  scenarioPulseEnvelope,
  scenarioSweepPosition,
} from './preset-lab-metrics.ts';
import {
  loadPresetSource,
  measurePresetReactivity,
} from './preset-lab-reactivity.ts';

const DEFAULT_PRESET_ID = 'eos-glowsticks-v2-03-music';
const WAVEFORM_BINS = 512;
const BEAT_INTERVAL_MS = 500; // 120 BPM, matching preset-lab-metrics.

type Check = { name: string; pass: boolean; detail: string };

const checks: Check[] = [];

function check(name: string, pass: boolean, detail = '') {
  checks.push({ name, pass, detail });
}

function spectrumAt(scenario: PresetLabScenario, timeMs: number): Uint8Array {
  const buffer = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  fillScenarioSpectrum(buffer, scenario, timeMs);
  return buffer;
}

function waveformAt(scenario: PresetLabScenario, timeMs: number): Uint8Array {
  const buffer = new Uint8Array(WAVEFORM_BINS);
  fillScenarioWaveform(buffer, scenario, timeMs);
  return buffer;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Energy-weighted mean bin index — where the spectrum's mass sits. */
function spectralCentroid(buffer: Uint8Array): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    weighted += i * (buffer[i] ?? 0);
    total += buffer[i] ?? 0;
  }
  return total === 0 ? 0 : weighted / total;
}

function bandEnergy(buffer: Uint8Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += buffer[i] ?? 0;
  return sum;
}

// ── 1. Reproducibility ──────────────────────────────────────────────
// Every generator is a pure function of time, so the same timestamp must
// produce the same bytes on every call and in every process.

const SAMPLE_TIMES = [0, 17, 123, 500, 733, 1999, 4321];
const ALL_SCENARIOS: PresetLabScenario[] = [
  'silence',
  'bass-pulse',
  'mid-pulse',
  'treble-pulse',
  'full-mix',
  'sweep',
];

{
  let deterministic = true;
  let firstMismatch = '';
  for (const scenario of ALL_SCENARIOS) {
    for (const timeMs of SAMPLE_TIMES) {
      if (
        !bytesEqual(spectrumAt(scenario, timeMs), spectrumAt(scenario, timeMs))
      ) {
        deterministic = false;
        firstMismatch = `${scenario} spectrum @${timeMs}ms`;
        break;
      }
      if (
        !bytesEqual(waveformAt(scenario, timeMs), waveformAt(scenario, timeMs))
      ) {
        deterministic = false;
        firstMismatch = `${scenario} waveform @${timeMs}ms`;
        break;
      }
    }
  }
  check(
    'generators are deterministic',
    deterministic,
    deterministic ? `${ALL_SCENARIOS.length} scenarios` : firstMismatch,
  );
}

{
  // Periodicity: one beat later, a pulse scenario must repeat exactly.
  const a = spectrumAt('bass-pulse', 250);
  const b = spectrumAt('bass-pulse', 250 + BEAT_INTERVAL_MS);
  check('pulse spectrum repeats every beat', bytesEqual(a, b));

  const sweepA = spectrumAt('sweep', 300);
  const sweepB = spectrumAt('sweep', 300 + SCENARIO_SWEEP_PERIOD_MS);
  check('sweep spectrum repeats every period', bytesEqual(sweepA, sweepB));
}

// ── 2. Beat spikes ──────────────────────────────────────────────────

{
  const onBeat = scenarioPulseEnvelope(0);
  const justAfter = scenarioPulseEnvelope(BEAT_INTERVAL_MS * 0.5);
  const nextBeat = scenarioPulseEnvelope(BEAT_INTERVAL_MS);
  check(
    'beat envelope spikes then decays',
    onBeat === 1 && justAfter === 0 && nextBeat === 1,
    `t=0 → ${onBeat}, t=half → ${justAfter}, t=beat → ${nextBeat}`,
  );

  // Count rising edges over 4 seconds; at 120 BPM that is 8 beats.
  let beats = 0;
  let previous = scenarioPulseEnvelope(-1);
  for (let timeMs = 0; timeMs < 4000; timeMs += 1) {
    const value = scenarioPulseEnvelope(timeMs);
    if (value > previous && previous === 0) beats += 1;
    previous = value;
  }
  check('4s of audio contains 8 beats at 120 BPM', beats === 8, `saw ${beats}`);
}

// ── 3. Band isolation ───────────────────────────────────────────────
// A band-isolated scenario must put its energy in its own third of the
// spectrum and nowhere else, or "bass influence" in a reactivity report is
// measuring the wrong thing.

{
  const bins = PRESET_LAB_SPECTRUM_BINS;
  const lowEnd = Math.ceil(bins * 0.12);
  const midEnd = Math.floor(bins * 0.5);

  const bass = spectrumAt('bass-pulse', 0);
  const mid = spectrumAt('mid-pulse', 0);
  const treble = spectrumAt('treble-pulse', 0);

  check(
    'bass-pulse energy is confined to low bins',
    bandEnergy(bass, 0, lowEnd) > 0 && bandEnergy(bass, lowEnd, bins) === 0,
  );
  check(
    'mid-pulse energy is confined to mid bins',
    bandEnergy(mid, lowEnd, midEnd) > 0 &&
      bandEnergy(mid, 0, lowEnd) === 0 &&
      bandEnergy(mid, midEnd, bins) === 0,
  );
  check(
    'treble-pulse energy is confined to high bins',
    bandEnergy(treble, midEnd, bins) > 0 && bandEnergy(treble, 0, midEnd) === 0,
  );
  check(
    'silence is silent',
    bandEnergy(spectrumAt('silence', 0), 0, bins) === 0,
  );
}

// ── 4. Frequency sweep ──────────────────────────────────────────────

{
  const steps = 24;
  const centroids: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const timeMs = (SCENARIO_SWEEP_PERIOD_MS * step) / steps;
    centroids.push(spectralCentroid(spectrumAt('sweep', timeMs)));
  }

  let monotonic = true;
  for (let i = 1; i < centroids.length; i += 1) {
    if ((centroids[i] ?? 0) <= (centroids[i - 1] ?? 0)) {
      monotonic = false;
      break;
    }
  }
  check(
    'sweep centroid rises monotonically across its period',
    monotonic,
    `${(centroids[0] ?? 0).toFixed(1)} → ${(centroids[steps - 1] ?? 0).toFixed(1)} of ${PRESET_LAB_SPECTRUM_BINS} bins`,
  );

  check(
    'sweep position wraps to the start of the next period',
    scenarioSweepPosition(0) ===
      scenarioSweepPosition(SCENARIO_SWEEP_PERIOD_MS),
  );

  // The sweep holds level while moving, which is what separates it from the
  // pulse scenarios: a preset that reacts to it is tracking frequency, not
  // loudness.
  const energies = [0, 0.25, 0.5, 0.75].map((fraction) =>
    bandEnergy(
      spectrumAt('sweep', SCENARIO_SWEEP_PERIOD_MS * fraction),
      0,
      PRESET_LAB_SPECTRUM_BINS,
    ),
  );
  const minEnergy = Math.min(...energies);
  const maxEnergy = Math.max(...energies);
  check(
    'sweep holds a roughly constant total level',
    minEnergy > 0 && maxEnergy / minEnergy < 1.25,
    `min ${minEnergy}, max ${maxEnergy}`,
  );
}

// ── 5. End-to-end reactivity determinism ────────────────────────────
// The point of the rig: the same preset measured twice must give identical
// numbers, otherwise a baseline→edit→compare workflow cannot attribute a
// difference to the edit.

{
  const args = process.argv.slice(2);
  const presetFlag = args.indexOf('--preset');
  const presetId =
    presetFlag >= 0 && args[presetFlag + 1]
      ? (args[presetFlag + 1] as string)
      : DEFAULT_PRESET_ID;

  try {
    const source = loadPresetSource(process.cwd(), { presetId });
    // Short run: this asserts reproducibility, not reactivity quality, and the
    // full 360-frame default would make the rig too slow to run on every edit.
    const options = { source, warmupFrames: 20, sampleFrames: 60 };
    const first = measurePresetReactivity(options);
    const second = measurePresetReactivity(options);

    check(
      'preset reactivity measurement is reproducible',
      JSON.stringify(first) === JSON.stringify(second),
      presetId,
    );
    check(
      'reactivity run produced measurements',
      first.variables.length > 0,
      `${first.variables.length} variables tracked`,
    );
  } catch (error) {
    check(
      'preset reactivity measurement is reproducible',
      false,
      String(error),
    );
  }
}

// ── Report ──────────────────────────────────────────────────────────

const failed = checks.filter((entry) => !entry.pass);
for (const entry of checks) {
  const mark = entry.pass ? '✔' : '✖';
  const detail = entry.detail ? ` — ${entry.detail}` : '';
  console.log(`${mark} ${entry.name}${detail}`);
}
console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed`,
);

if (failed.length > 0) {
  process.exit(1);
}
