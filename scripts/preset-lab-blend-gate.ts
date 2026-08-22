/**
 * Preset lab — crossfade gate calibration (no browser).
 *
 * `estimateFrameBlendWorkload` scores a frame in arbitrary units, so the
 * only honest way to pick a threshold against it is to measure the corpus.
 * This sweep compiles catalog presets, steps the CPU VM through the shared
 * deterministic scenario, and reports the distribution of per-preset PEAK
 * workload against the shipped `MAX_BLEND_WORKLOAD`.
 *
 * It exists because the threshold silently drifted below the corpus MINIMUM
 * (900 vs. a floor of 1323 — the warp mesh alone contributes ~992), which
 * made every crossfade in the product a hard cut with no diagnostic. Run
 * this before changing the constant; `milkdrop-blend-gate.test.ts` pins the
 * floor between runs.
 *
 *   bun run lab:blend-gate                 # sweep the default sample
 *   bun run lab:blend-gate -- --count 500  # deeper sample
 *   bun run lab:blend-gate -- --frames 240 # longer per preset
 */

import fs from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import {
  estimateFrameBlendWorkload,
  MAX_BLEND_WORKLOAD,
} from '../src/js/milkdrop/runtime/session.ts';
import { createMilkdropSignalTracker } from '../src/js/milkdrop/runtime-signals.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';
import {
  fillScenarioSpectrum,
  fillScenarioWaveform,
  PRESET_LAB_SPECTRUM_BINS,
} from './preset-lab-metrics.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';

const FPS = 60;
const SCENARIO = 'full-mix' as const;

function readFlag(name: string, fallback: number) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const repoRoot = process.cwd();
const count = readFlag('count', 250);
const frames = readFlag('frames', 90);

type Row = { id: string; peak: number; breakdown: string };
const rows: Row[] = [];
let skipped = 0;

for (const entry of [...loadCatalogEntries(repoRoot).values()].slice(
  0,
  count,
)) {
  const filePath = path.join(repoRoot, 'public', entry.file.replace(/^\//, ''));
  if (!fs.existsSync(filePath)) {
    skipped += 1;
    continue;
  }
  let peak = 0;
  let breakdown = '';
  try {
    const compiled = compileMilkdropPresetSource(
      fs.readFileSync(filePath, 'latin1'),
      { id: entry.id },
    );
    const vm = createMilkdropVM(compiled);
    const tracker = createMilkdropSignalTracker();
    const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
    for (let frame = 0; frame < frames; frame += 1) {
      const timeMs = (frame * 1000) / FPS;
      fillScenarioSpectrum(frequencyData, SCENARIO, timeMs);
      fillScenarioWaveform(waveformData, SCENARIO, timeMs);
      const frameState = vm.step(
        tracker.update({
          time: timeMs / 1000,
          deltaMs: 1000 / FPS,
          analyser: null,
          frequencyData,
          waveformData,
        }),
      );
      const workload = estimateFrameBlendWorkload(frameState);
      if (workload > peak) {
        peak = workload;
        breakdown = [
          `wave=${Math.floor(frameState.mainWave.positions.length / 3)}`,
          `mesh=${Math.floor(frameState.mesh.positions.length / 6) * 0.5}`,
          `mv=${frameState.motionVectors.length}`,
          `shapes=${frameState.shapes.length}`,
          `borders=${frameState.borders.length}`,
          `trails=${frameState.trails.length}`,
        ].join(' ');
      }
    }
  } catch {
    skipped += 1;
    continue;
  }
  rows.push({ id: entry.id, peak, breakdown });
}

if (rows.length === 0) {
  console.error('No presets measured.');
  process.exit(1);
}

rows.sort((a, b) => a.peak - b.peak);
const at = (p: number) => rows[Math.floor((rows.length - 1) * p)];

console.log(
  `measured ${rows.length} presets (${skipped} skipped), ${frames} frames each`,
);
console.log(`MAX_BLEND_WORKLOAD = ${MAX_BLEND_WORKLOAD}\n`);
for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1]) {
  const row = at(p);
  console.log(
    `p${(p * 100).toFixed(0).padStart(3)}  ${row.peak.toFixed(0).padStart(7)}  ${row.id}`,
  );
}

const refused = rows.filter((row) => row.peak >= MAX_BLEND_WORKLOAD);
console.log(
  `\nwould cut instead of crossfade: ${refused.length}/${rows.length} (${(
    (refused.length / rows.length) * 100
  ).toFixed(1)}%)`,
);
console.log(`corpus floor: ${at(0).peak.toFixed(0)}  ${at(0).id}`);
console.log(`  ${at(0).breakdown}`);
if (at(0).peak >= MAX_BLEND_WORKLOAD) {
  console.error(
    '\nFAIL: the threshold sits below the corpus minimum — no preset can crossfade.',
  );
  process.exit(1);
}
