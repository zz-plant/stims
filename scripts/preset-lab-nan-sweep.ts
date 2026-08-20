/**
 * Preset lab — corpus NaN sweep (no browser).
 *
 * The verification middle tier between the offline shader-compile scan
 * (lab via glslangValidator) and the expensive per-preset browser runs
 * (lab:visual): compile EVERY catalog preset, step its CPU VM headlessly
 * through a deterministic full-mix audio scenario, and flag presets whose
 * output goes bad in ways the cheaper tiers cannot see:
 *
 *   - `compile-error` / `step-error`: the compiler or VM threw.
 *   - `nan`: a non-finite value reached the frame output (per-frame
 *     variables, wave/shape geometry) despite the per-statement store
 *     clamps — i.e. produced inside a single frame's geometry math.
 *   - `static`: informational only — no tracked motion variable and no
 *     geometry moved across the sampled frames (candidate dead preset,
 *     never a gate failure; silence-static presets are common and fine).
 *
 * Baseline workflow (same shape as lab:profile):
 *   bun run lab:nan-sweep                      # sweep, compare to baseline
 *   bun run lab:nan-sweep -- --update-baseline # rewrite the baseline file
 *   bun run lab:nan-sweep -- --frames 240      # deeper per-preset run
 *   bun run lab:nan-sweep -- --only <id> [...] # subset, no gate
 *
 * The gate fails (exit 1) only on REGRESSIONS: presets failing now that are
 * not in performance/nan-sweep-baseline.json. Fixed presets are reported so
 * the baseline can be re-tightened with --update-baseline.
 *
 * Determinism: the VM seeds its RNG from the preset id and the scenario is a
 * pure function of frame time, so runs are reproducible.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { createMilkdropSignalTracker } from '../src/js/milkdrop/runtime-signals.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';
import {
  fillScenarioSpectrum,
  fillScenarioWaveform,
  PRESET_LAB_SPECTRUM_BINS,
} from './preset-lab-metrics.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';

const BASELINE_PATH = 'performance/nan-sweep-baseline.json';
const DEFAULT_WARMUP_FRAMES = 60;
const DEFAULT_SAMPLE_FRAMES = 60;
const FPS = 60;
const SCENARIO = 'full-mix' as const;

/** Motion variables consulted for the informational `static` verdict. */
const MOTION_VARIABLES = [
  'zoom',
  'rot',
  'warp',
  'cx',
  'cy',
  'dx',
  'dy',
  'sx',
  'sy',
  'wave_x',
  'wave_y',
  'wave_a',
] as const;

type FailureKind = 'compile-error' | 'step-error' | 'nan';

type PresetFinding = {
  id: string;
  kind: FailureKind;
  detail: string;
};

type BaselineFile = {
  version: 1;
  capturedAt: string;
  frames: number;
  failures: Array<{ id: string; kind: FailureKind; detail: string }>;
};

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

function firstNonFinite(
  values: ArrayLike<number>,
): { index: number; value: number } | null {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (!Number.isFinite(value)) {
      return { index, value };
    }
  }
  return null;
}

function scanFrameForNonFinite(frameState: {
  variables: Record<string, unknown>;
  mainWave: { positions: ArrayLike<number> };
  customWaves: Array<{ positions: ArrayLike<number> }>;
  shapes: Array<{ x: number; y: number; radius: number; rotation: number }>;
}): string | null {
  for (const [key, value] of Object.entries(frameState.variables)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return `variables.${key} = ${value}`;
    }
  }
  const mainWave = firstNonFinite(frameState.mainWave.positions);
  if (mainWave) {
    return `mainWave.positions[${mainWave.index}] = ${mainWave.value}`;
  }
  for (const [waveIndex, wave] of frameState.customWaves.entries()) {
    const bad = firstNonFinite(wave.positions);
    if (bad) {
      return `customWaves[${waveIndex}].positions[${bad.index}] = ${bad.value}`;
    }
  }
  for (const [shapeIndex, shape] of frameState.shapes.entries()) {
    for (const field of ['x', 'y', 'radius', 'rotation'] as const) {
      if (!Number.isFinite(shape[field])) {
        return `shapes[${shapeIndex}].${field} = ${shape[field]}`;
      }
    }
  }
  return null;
}

function positionsChecksum(positions: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const value = positions[index] as number;
    if (Number.isFinite(value)) {
      sum += value * (1 + (index % 7));
    }
  }
  return sum;
}

function sweepPreset(
  raw: string,
  presetId: string,
  frames: { warmup: number; sample: number },
): { finding: PresetFinding | null; isStatic: boolean } {
  let compiled: ReturnType<typeof compileMilkdropPresetSource>;
  try {
    compiled = compileMilkdropPresetSource(raw, { id: presetId });
  } catch (error) {
    return {
      finding: {
        id: presetId,
        kind: 'compile-error',
        detail: (error as Error).message.slice(0, 200),
      },
      isStatic: false,
    };
  }

  const vm = createMilkdropVM(compiled);
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const deltaMs = 1000 / FPS;
  const totalFrames = frames.warmup + frames.sample;

  let motionAccum = 0;
  let previousMotion: number[] | null = null;
  let previousGeometry: number | null = null;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const timeMs = frame * deltaMs;
    fillScenarioSpectrum(frequencyData, SCENARIO, timeMs);
    fillScenarioWaveform(waveformData, SCENARIO, timeMs);
    const signals = tracker.update({
      time: timeMs / 1000,
      deltaMs,
      analyser: null,
      frequencyData,
      waveformData,
    });

    let frameState: ReturnType<typeof vm.step>;
    try {
      frameState = vm.step(signals);
    } catch (error) {
      return {
        finding: {
          id: presetId,
          kind: 'step-error',
          detail: `frame ${frame}: ${(error as Error).message.slice(0, 200)}`,
        },
        isStatic: false,
      };
    }

    if (frame < frames.warmup) {
      continue;
    }

    const nonFinite = scanFrameForNonFinite(frameState);
    if (nonFinite) {
      return {
        finding: {
          id: presetId,
          kind: 'nan',
          detail: `frame ${frame}: ${nonFinite}`,
        },
        isStatic: false,
      };
    }

    const motion = MOTION_VARIABLES.map((name) => {
      const value = frameState.variables[name];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    });
    const geometry = positionsChecksum(frameState.mainWave.positions);
    if (previousMotion) {
      for (let index = 0; index < motion.length; index += 1) {
        motionAccum += Math.abs(motion[index] - (previousMotion[index] ?? 0));
      }
    }
    if (previousGeometry !== null) {
      motionAccum += Math.abs(geometry - previousGeometry);
    }
    previousMotion = motion;
    previousGeometry = geometry;
  }

  return { finding: null, isStatic: motionAccum === 0 };
}

function readBaseline(repoRoot: string): BaselineFile | null {
  const filePath = path.join(repoRoot, BASELINE_PATH);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as BaselineFile;
}

function main() {
  const repoRoot = repoRootFromScript();
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const only: string[] = [];
  let sampleFrames = DEFAULT_SAMPLE_FRAMES;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--only' && args[index + 1]) {
      only.push(args[index + 1] as string);
    }
    if (args[index] === '--frames' && args[index + 1]) {
      sampleFrames = Math.max(1, Number(args[index + 1]));
    }
  }

  const entries = [...loadCatalogEntries(repoRoot).values()].filter(
    (entry) => only.length === 0 || only.includes(entry.id),
  );
  if (entries.length === 0) {
    console.error('No matching presets.');
    process.exit(1);
  }

  const frames = { warmup: DEFAULT_WARMUP_FRAMES, sample: sampleFrames };
  const failures: PresetFinding[] = [];
  const staticIds: string[] = [];
  const startedAt = Date.now();

  for (const [index, entry] of entries.entries()) {
    const filePath = path.join(
      repoRoot,
      'public',
      entry.file.replace(/^\//, ''),
    );
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'latin1');
    } catch {
      failures.push({
        id: entry.id,
        kind: 'compile-error',
        detail: `missing preset file: ${entry.file}`,
      });
      continue;
    }
    const { finding, isStatic } = sweepPreset(raw, entry.id, frames);
    if (finding) {
      failures.push(finding);
    } else if (isStatic) {
      staticIds.push(entry.id);
    }
    if ((index + 1) % 200 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `… ${index + 1}/${entries.length} swept (${failures.length} failures) [${elapsed}s]`,
      );
    }
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `\nSwept ${entries.length} presets in ${elapsedSeconds}s ` +
      `(${frames.warmup}+${frames.sample} frames each): ` +
      `${failures.length} failures, ${staticIds.length} static (informational).`,
  );
  for (const failure of failures) {
    console.log(`  ✗ ${failure.id} [${failure.kind}] ${failure.detail}`);
  }
  if (staticIds.length > 0) {
    console.log(
      `  static (no motion under full-mix, first 10): ${staticIds
        .slice(0, 10)
        .join(', ')}${staticIds.length > 10 ? ', …' : ''}`,
    );
  }

  if (only.length > 0) {
    // Subsets are for iteration, never gated.
    return;
  }

  if (updateBaseline) {
    const baseline: BaselineFile = {
      version: 1,
      capturedAt: new Date().toISOString(),
      frames: frames.warmup + frames.sample,
      failures: failures.map(({ id, kind, detail }) => ({ id, kind, detail })),
    };
    fs.writeFileSync(
      path.join(repoRoot, BASELINE_PATH),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    console.log(`Baseline written to ${BASELINE_PATH}.`);
    return;
  }

  const baseline = readBaseline(repoRoot);
  if (!baseline) {
    console.log(
      `No baseline at ${BASELINE_PATH}; run with --update-baseline to create one.`,
    );
    process.exit(failures.length > 0 ? 1 : 0);
  }

  const knownIds = new Set(baseline.failures.map((failure) => failure.id));
  const regressions = failures.filter((failure) => !knownIds.has(failure.id));
  const currentIds = new Set(failures.map((failure) => failure.id));
  const fixed = baseline.failures.filter(
    (failure) => !currentIds.has(failure.id),
  );

  if (fixed.length > 0) {
    console.log(
      `${fixed.length} baseline failure(s) no longer fail — re-tighten with --update-baseline: ` +
        fixed.map((failure) => failure.id).join(', '),
    );
  }
  if (regressions.length > 0) {
    console.error(`\n${regressions.length} NEW failure(s) vs baseline:`);
    for (const failure of regressions) {
      console.error(`  ✗ ${failure.id} [${failure.kind}] ${failure.detail}`);
    }
    process.exit(1);
  }
  console.log('✔ no new failures vs baseline.');
}

main();
