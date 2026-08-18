/**
 * Preset lab — deterministic trace record/replay (no browser).
 *
 * Turns "the preset looks different now" into a bisectable diff. A trace
 * captures the raw per-frame audio inputs (spectrum + waveform + clock) and
 * a digest of the VM's full state each frame. Replaying re-runs the signal
 * tracker and VM over the identical inputs — the VM's RNG is seeded from
 * the preset id, so any digest mismatch is a semantics change, and the
 * report names the first divergent frame and the exact variables/geometry
 * that moved.
 *
 *   bun run lab:replay -- --preset <id> --record trace.json [--frames 240]
 *   <change compiler/VM code, or switch branches>
 *   bun run lab:replay -- --replay trace.json          # verified or first-divergence report
 *   bun run lab:replay -- --replay trace.json --dump 5 # also print state at frame 5
 *
 * Scope: CPU tier (the production JIT-backed VM). The trace format is
 * deliberately runtime-agnostic — a browser capture hook or a GPU-tier
 * replayer can emit/consume the same shape later (see the EEL consolidation
 * roadmap, item 3).
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
  type PresetLabScenario,
} from './preset-lab-metrics.ts';
import { loadPresetSource } from './preset-lab-reactivity.ts';

const DEFAULT_FRAMES = 240;
const FPS = 60;

type FrameInputs = {
  time: number;
  deltaMs: number;
  /** Spectrum/waveform bytes; stored as plain arrays for JSON portability. */
  frequencyData: number[];
  waveformData: number[];
};

type FrameCapture = {
  /** FNV-1a digest over sorted variables + geometry. */
  digest: string;
  /** Full variable snapshot, kept so divergences can be named precisely.
   * Compact (golden) traces keep it only on checkpoint frames. */
  variables?: Record<string, number>;
  geometry?: { mainWave: number; customWaves: number; shapes: number };
};

type TraceFile = {
  version: 1;
  presetId: string;
  capturedAt: string;
  fps: number;
  scenario: string;
  frameCount: number;
  /** Raw recorded inputs; null for synthetic traces, whose inputs are
   * regenerated from (scenario, frameCount) on replay. Live browser
   * captures must always store inputs. */
  inputs: FrameInputs[] | null;
  frames: FrameCapture[];
};

export type { FrameCapture, FrameInputs, TraceFile };

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function positionsChecksum(positions: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const value = positions[index] as number;
    if (Number.isFinite(value)) {
      sum += value * (1 + (index % 7));
    }
  }
  // Round so a JSON round-trip of the checksum compares exactly.
  return Math.round(sum * 1e6) / 1e6;
}

function captureFrame(frameState: {
  variables: Record<string, unknown>;
  mainWave: { positions: ArrayLike<number> };
  customWaves: Array<{ positions: ArrayLike<number> }>;
  shapes: Array<{ x: number; y: number; radius: number; rotation: number }>;
}): FrameCapture {
  const variables: Record<string, number> = {};
  for (const key of Object.keys(frameState.variables).sort()) {
    const value = frameState.variables[key];
    if (typeof value === 'number') {
      variables[key] = value;
    }
  }
  let shapesSum = 0;
  for (const shape of frameState.shapes) {
    shapesSum += shape.x + shape.y * 3 + shape.radius * 7 + shape.rotation;
  }
  let customWavesSum = 0;
  for (const wave of frameState.customWaves) {
    customWavesSum += positionsChecksum(wave.positions);
  }
  const geometry = {
    mainWave: positionsChecksum(frameState.mainWave.positions),
    customWaves: Math.round(customWavesSum * 1e6) / 1e6,
    shapes: Math.round(shapesSum * 1e6) / 1e6,
  };
  const digest = fnv1a(JSON.stringify([variables, geometry]));
  return { digest, variables, geometry };
}

export function runTrace(
  raw: string,
  presetId: string,
  inputs: FrameInputs[],
): FrameCapture[] {
  const compiled = compileMilkdropPresetSource(raw, { id: presetId });
  const vm = createMilkdropVM(compiled);
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const frames: FrameCapture[] = [];
  for (const frame of inputs) {
    frequencyData.set(frame.frequencyData);
    waveformData.set(frame.waveformData);
    const signals = tracker.update({
      time: frame.time,
      deltaMs: frame.deltaMs,
      analyser: null,
      frequencyData,
      waveformData,
    });
    frames.push(captureFrame(vm.step(signals)));
  }
  return frames;
}

export function buildScenarioInputs(
  scenario: PresetLabScenario,
  frameCount: number,
): FrameInputs[] {
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const deltaMs = 1000 / FPS;
  const inputs: FrameInputs[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const timeMs = frame * deltaMs;
    fillScenarioSpectrum(frequencyData, scenario, timeMs);
    fillScenarioWaveform(waveformData, scenario, timeMs);
    inputs.push({
      time: timeMs / 1000,
      deltaMs,
      frequencyData: [...frequencyData],
      waveformData: [...waveformData],
    });
  }
  return inputs;
}

export function diffFrames(
  recorded: FrameCapture,
  replayed: FrameCapture,
): string[] {
  if (!recorded.variables || !recorded.geometry) {
    return [
      '  (compact trace: no variable checkpoint at this frame — re-record without --compact to name variables)',
    ];
  }
  const details: string[] = [];
  const keys = new Set([
    ...Object.keys(recorded.variables),
    ...Object.keys(replayed.variables ?? {}),
  ]);
  for (const key of [...keys].sort()) {
    const before = recorded.variables[key];
    const after = replayed.variables?.[key];
    if (before !== after) {
      details.push(`  variables.${key}: ${before} -> ${after}`);
    }
  }
  for (const field of ['mainWave', 'customWaves', 'shapes'] as const) {
    if (recorded.geometry[field] !== replayed.geometry?.[field]) {
      details.push(
        `  geometry.${field}: ${recorded.geometry[field]} -> ${replayed.geometry?.[field]}`,
      );
    }
  }
  return details;
}

/** Compares a replay against a trace; returns null when every frame's digest
 * matches, else the first divergence. Shared by the CLI and the golden-trace
 * unit gate. */
export function compareReplay(
  trace: TraceFile,
  replayed: FrameCapture[],
): { frame: number; details: string[] } | null {
  for (let index = 0; index < trace.frames.length; index += 1) {
    const recorded = trace.frames[index] as FrameCapture;
    const current = replayed[index];
    if (!current || current.digest !== recorded.digest) {
      return {
        frame: index,
        details: current
          ? diffFrames(recorded, current)
          : ['  (missing frame)'],
      };
    }
  }
  return null;
}

export function traceInputs(trace: TraceFile): FrameInputs[] {
  return (
    trace.inputs ??
    buildScenarioInputs(
      trace.scenario as PresetLabScenario,
      trace.frameCount ?? trace.frames.length,
    )
  );
}

const GOLDEN_CHECKPOINT_EVERY = 30;

function compactFrames(frames: FrameCapture[]): FrameCapture[] {
  return frames.map((frame, index) =>
    index % GOLDEN_CHECKPOINT_EVERY === 0 ? frame : { digest: frame.digest },
  );
}

function main() {
  const repoRoot = repoRootFromScript();
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const presetId = get('--preset');
  const recordPath = get('--record');
  const replayPath = get('--replay');
  const compact = args.includes('--compact');
  const frameCount = Number(get('--frames') ?? DEFAULT_FRAMES);
  const scenario = (get('--scenario') ?? 'full-mix') as PresetLabScenario;
  const dumpFrame = get('--dump');

  if (recordPath) {
    if (!presetId) {
      console.error('--record requires --preset <id>.');
      process.exit(1);
    }
    const source = loadPresetSource(repoRoot, { presetId });
    const inputs = buildScenarioInputs(scenario, frameCount);
    const frames = runTrace(source.raw, source.id, inputs);
    const trace: TraceFile = {
      version: 1,
      presetId: source.id,
      capturedAt: new Date().toISOString(),
      fps: FPS,
      scenario,
      frameCount: frames.length,
      inputs: compact ? null : inputs,
      frames: compact ? compactFrames(frames) : frames,
    };
    fs.mkdirSync(path.dirname(path.resolve(recordPath)), { recursive: true });
    fs.writeFileSync(path.resolve(recordPath), JSON.stringify(trace));
    console.log(
      `Recorded ${frames.length} frames of ${source.id} (${scenario}) to ${recordPath}.`,
    );
    return;
  }

  if (replayPath) {
    const trace = JSON.parse(
      fs.readFileSync(path.resolve(replayPath), 'utf8'),
    ) as TraceFile;
    const source = loadPresetSource(repoRoot, { presetId: trace.presetId });
    const replayed = runTrace(source.raw, trace.presetId, traceInputs(trace));

    if (dumpFrame !== undefined) {
      const index = Number(dumpFrame);
      const frame = replayed[index];
      if (frame) {
        console.log(`state at frame ${index}:`);
        console.log(JSON.stringify(frame, null, 2));
      }
    }

    const divergence = compareReplay(trace, replayed);
    if (divergence) {
      console.error(
        `✗ DIVERGED at frame ${divergence.frame}/${trace.frames.length}`,
      );
      console.error(
        divergence.details.slice(0, 20).join('\n') +
          (divergence.details.length > 20
            ? `\n  … ${divergence.details.length - 20} more differing fields`
            : ''),
      );
      process.exit(1);
    }
    console.log(
      `✔ replay verified: ${trace.frames.length} frames of ${trace.presetId} match the recording bit-for-bit.`,
    );
    return;
  }

  console.error(
    'Usage:\n' +
      '  bun run lab:replay -- --preset <id> --record trace.json [--frames N] [--scenario full-mix]\n' +
      '  bun run lab:replay -- --replay trace.json [--dump <frame>]',
  );
  process.exit(1);
}

if (import.meta.main) {
  main();
}
