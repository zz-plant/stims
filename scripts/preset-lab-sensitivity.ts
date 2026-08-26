/**
 * Rank a preset's parameters by how much they actually move the picture.
 *
 * A MilkDrop preset carries dozens of numeric fields, and in any given preset
 * most of them do nothing: they are overwritten by the per-frame equations on
 * the first frame, or multiplied by something that is zero, or simply unused.
 * Nothing in the format distinguishes a knob that drives the whole look from
 * one that is decorative, so editors present all of them with equal weight and
 * authors learn which is which by trial and error.
 *
 * This measures it. For each candidate field: perturb it, re-run the VM on an
 * identical deterministic timeline, and compare the resulting warp mesh
 * against the unperturbed baseline. The output is RMS displacement per unit of
 * relative perturbation -- a sensitivity, not a guess.
 *
 * Deliberately CPU-only and pixel-free. Diffing the mesh rather than rendered
 * frames isolates what the EQUATIONS do from what the shaders do, needs no
 * GPU, and runs in milliseconds, so this can sweep the corpus. A preset whose
 * warp is owned by a shader will correctly report near-zero sensitivity on the
 * mesh -- that is a real finding about where its behaviour lives, not a
 * failure to measure.
 *
 * Central differences, both directions averaged: one-sided differencing on a
 * field that is clamped at zero (decay, warp scale) reports the clamp instead
 * of the parameter.
 *
 *   bun run lab:sensitivity -- --preset <id>
 *   bun run lab:sensitivity -- --preset <id> --frames 20 --top 12
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearCompiledPresetCache,
  compileMilkdropPresetSource,
} from '../src/js/milkdrop/compiler.ts';
import { createMilkdropSignalTracker } from '../src/js/milkdrop/runtime-signals.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';
import { DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS } from '../src/js/milkdrop/webgpu-optimization-flags.ts';
import {
  fillScenarioSpectrum,
  fillScenarioWaveform,
  PRESET_LAB_SPECTRUM_BINS,
} from './preset-lab-metrics.ts';

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
}

const PRESET = flag('preset', '');
const FRAMES = Number(flag('frames', '16'));
const TOP = Number(flag('top', '15'));
/** Relative step. Large enough to clear f32 noise, small enough to stay local. */
const EPSILON = Number(flag('epsilon', '0.05'));

function findPresetFile(id: string): string | null {
  const roots = ['public/milkdrop-presets', 'tests/fixtures/milkdrop'];
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop() as string;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) stack.push(path);
        else if (entry === `${id}.milk`) return path;
      }
    }
  }
  return null;
}

/**
 * Run the VM on a fixed deterministic timeline and return the final mesh.
 *
 * Same stimulus every run — the preset-lab's `full-mix` scenario through the
 * real signal tracker, so smoothing and attack envelopes behave as they do
 * live. Two runs differ only by the parameter under test.
 */
function runMesh(
  source: string,
  id: string,
  overrides: Record<string, number>,
) {
  // The compiler caches by raw source, so successive calls hand back the SAME
  // preset object — and this probe mutates its numericFields. Without the
  // clear, every override accumulates permanently and each run inherits all
  // prior perturbations: the first version of this script reported an
  // identical non-zero "sensitivity" for 1579 unrelated fields, which was the
  // accumulated leak, not the parameters.
  clearCompiledPresetCache();
  const preset = compileMilkdropPresetSource(source, { id });
  for (const [key, value] of Object.entries(overrides)) {
    preset.ir.numericFields[key] = value;
  }
  const vm = createMilkdropVM(preset, {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    gpuComputeVM: false,
  });
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const deltaMs = 1000 / 60;

  let positions: Float32Array | null = null;
  for (let f = 0; f < FRAMES; f += 1) {
    const timeMs = f * deltaMs;
    fillScenarioSpectrum(frequencyData, 'full-mix', timeMs);
    fillScenarioWaveform(waveformData, 'full-mix', timeMs);
    const signals = tracker.update({
      time: timeMs / 1000,
      deltaMs,
      analyser: null,
      frequencyData,
      waveformData,
    });
    const state = vm.step(signals);
    const p = state.mesh?.positions;
    if (p) {
      positions = p instanceof Float32Array ? p.slice() : Float32Array.from(p);
    }
  }
  return { positions, fields: preset.ir.numericFields };
}

function rms(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    if (Number.isFinite(d)) acc += d * d;
  }
  return Math.sqrt(acc / n);
}

if (!PRESET) {
  console.error('Usage: bun run lab:sensitivity -- --preset <id>');
  process.exit(2);
}
const file = findPresetFile(PRESET);
if (!file) {
  console.error(`No .milk file found for preset id "${PRESET}".`);
  process.exit(2);
}
const source = readFileSync(file, 'utf8');

const baseline = runMesh(source, PRESET, {});
if (!baseline.positions) {
  console.error(
    'This preset produced no warp mesh on the CPU path, so there is nothing ' +
      'to differentiate — its motion lives in a shader.',
  );
  process.exit(1);
}

const candidates = Object.entries(baseline.fields)
  .filter(([, v]) => Number.isFinite(v))
  .map(([k]) => k);

type Row = { field: string; base: number; sensitivity: number };
const rows: Row[] = [];
const structural: string[] = [];
for (const field of candidates) {
  const base = baseline.fields[field] as number;
  // Relative step, with an absolute floor so a field sitting at 0 still moves.
  const step = Math.max(Math.abs(base) * EPSILON, EPSILON);
  const up = runMesh(source, PRESET, { [field]: base + step });
  const down = runMesh(source, PRESET, { [field]: base - step });
  if (!up.positions || !down.positions) continue;
  // A field that resizes the mesh (mesh_density) is not comparable
  // point-for-point: the diff would be between different grid locations and
  // reads as large sensitivity for what is really a change of sampling. Those
  // are reported separately rather than ranked against real parameters.
  if (
    up.positions.length !== baseline.positions.length ||
    down.positions.length !== baseline.positions.length
  ) {
    structural.push(field);
    continue;
  }
  const delta =
    (rms(baseline.positions, up.positions) +
      rms(baseline.positions, down.positions)) /
    2;
  rows.push({ field, base, sensitivity: delta / step });
}

rows.sort((a, b) => b.sensitivity - a.sensitivity);
const live = rows.filter((r) => r.sensitivity > 1e-9);

console.log(`\n  ${PRESET}`);
console.log(
  `  ${candidates.length} numeric fields, ${live.length} move the mesh ` +
    `(${FRAMES} frames, central difference, eps=${EPSILON})\n`,
);
console.log('  field                        base        sensitivity');
console.log(`  ${'-'.repeat(56)}`);
for (const row of live.slice(0, TOP)) {
  console.log(
    `  ${row.field.padEnd(26)} ${row.base.toFixed(4).padStart(10)}   ${row.sensitivity.toExponential(3).padStart(12)}`,
  );
}
if (live.length === 0) {
  console.log('  (none — every numeric field is inert on the mesh path)');
}
const dead = rows.length - live.length;
console.log(
  `\n  ${dead} of ${rows.length} comparable fields are inert in this preset: ` +
    'changing them moves nothing.',
);
if (structural.length > 0) {
  console.log(
    `  ${structural.length} field(s) resize the mesh and are not ranked: ` +
      `${structural.join(', ')}`,
  );
}
console.log('');
