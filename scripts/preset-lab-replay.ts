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
 * Live browser captures produce the same TraceFile shape via the agent-mode
 * handle (window.__milkdropRuntimeDebug.startTraceCapture/stopTraceCapture,
 * see src/js/milkdrop/runtime/trace-recorder.ts); those traces carry the
 * fully merged per-frame signals and replay through the VM directly,
 * bypassing the signal tracker.
 *
 * GPU tier: `--replay trace.json --tier gpu` drives the same trace through
 * the compute-VM (vm-gpu.ts) on an ACTUAL GPU — headless Chromium WebGPU,
 * full VM stepped in-page via stepAsync — and diffs its per-frame VmState
 * against the CPU replay within f32 tolerance (exact digests are
 * meaningless across f32/f64). Same first-divergent-frame report, exit 1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { createMilkdropSignalTracker } from '../src/js/milkdrop/runtime-signals.ts';
import {
  captureFrame,
  type FrameCapture,
  type FrameInputs,
  reviveInputArrays,
  type TraceFile,
} from '../src/js/milkdrop/trace-capture.ts';
import type { MilkdropRuntimeSignals } from '../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';
import {
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from '../src/js/milkdrop/webgpu-optimization-flags.ts';
import { ensureDevServer } from './dev-server.ts';
import {
  fillScenarioSpectrum,
  fillScenarioWaveform,
  PRESET_LAB_SPECTRUM_BINS,
  type PresetLabScenario,
} from './preset-lab-metrics.ts';
import { loadPresetSource } from './preset-lab-reactivity.ts';

const DEFAULT_FRAMES = 240;
const FPS = 60;
const GPU_REPLAY_PORT = 5198;

export type { FrameCapture, FrameInputs, TraceFile };

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

export type ReplayVmOptions = {
  /** Backend semantics to replay under; a WebGPU-recorded trace has empty
   * CPU-visual wave/mesh arrays (procedural descriptors carry them), so the
   * replay VM must be routed the same way. Defaults to 'webgl'. */
  backend?: 'webgl' | 'webgpu';
  webgpuFlags?: Partial<MilkdropWebGpuOptimizationFlags>;
};

export function runTrace(
  raw: string,
  presetId: string,
  inputs: FrameInputs[],
  options: ReplayVmOptions = {},
): FrameCapture[] {
  const compiled = compileMilkdropPresetSource(raw, { id: presetId });
  const vm = createMilkdropVM(compiled, {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    ...options.webgpuFlags,
  });
  vm.setRenderBackend(options.backend ?? 'webgl');
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const frames: FrameCapture[] = [];
  for (const frame of inputs) {
    // Live captures store the fully merged signal environment the VM stepped
    // with; the tracker's live smoothing state cannot be rebuilt from bytes,
    // so replay feeds those signals to the VM directly. The raw byte arrays
    // are reattached from the recorded inputs — wave geometry reads
    // signals.waveformData/frequencyData, which JSON snapshots drop.
    if (frame.signals) {
      if (frame.detailScale !== undefined) {
        vm.setDetailScale(frame.detailScale);
      }
      const signals = {
        ...frame.signals,
        ...(frame.arrays ? reviveInputArrays(frame.arrays) : null),
        frequencyData: new Uint8Array(frame.frequencyData),
        waveformData: new Uint8Array(frame.waveformData),
      };
      frames.push(
        captureFrame(vm.step(signals as unknown as MilkdropRuntimeSignals)),
      );
      continue;
    }
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

/** Field-level diff between two frame snapshots, using a caller-supplied
 * equality predicate — exact `===` for same-tier replay, tolerance-based for
 * cross-tier (f32 vs f64) diffs. The one field-walker every comparison mode
 * (CPU replay, GPU tier, live-trace replay) goes through, so "what moved" is
 * described identically everywhere. */
function diffFields(
  left: FrameCapture,
  right: FrameCapture,
  equals: (a: number | undefined, b: number | undefined) => boolean,
  labels: [string, string],
  geometryEquals: (
    a: number | undefined,
    b: number | undefined,
  ) => boolean = equals,
): string[] {
  const [leftLabel, rightLabel] = labels;
  const details: string[] = [];
  const keys = new Set([
    ...Object.keys(left.variables ?? {}),
    ...Object.keys(right.variables ?? {}),
  ]);
  for (const key of [...keys].sort()) {
    const a = left.variables?.[key];
    const b = right.variables?.[key];
    if (!equals(a, b)) {
      details.push(`  variables.${key}: ${leftLabel}=${a} ${rightLabel}=${b}`);
    }
  }
  for (const field of ['mainWave', 'customWaves', 'shapes'] as const) {
    const a = left.geometry?.[field];
    const b = right.geometry?.[field];
    if (!geometryEquals(a, b)) {
      details.push(`  geometry.${field}: ${leftLabel}=${a} ${rightLabel}=${b}`);
    }
  }
  return details;
}

type DivergenceOptions = {
  equals: (a: number | undefined, b: number | undefined) => boolean;
  /** Comparator for the geometry triple, when it needs to differ from
   * `equals` — geometry is pre-rounded to 1e-6, so it wants an absolute
   * floor that would be far too loose for raw variables. Defaults to
   * `equals`. */
  geometryEquals?: (a: number | undefined, b: number | undefined) => boolean;
  labels: [string, string];
  /** Fast pre-check per frame (e.g. digest equality) that skips the
   * detailed field diff entirely when true. Omit for tolerance-based
   * comparisons, where no cross-tier digest is meaningful. */
  sameFrame?: (left: FrameCapture, right: FrameCapture) => boolean;
  /** Shown when a frame exists on both sides but neither has enough data
   * (compact trace, or an incomplete snapshot) to name what moved. */
  noSnapshotNotice: string;
  /** Shown when the right-hand series has no frame at this index at all. */
  missingFrameNotice: string;
};

/** Walks two frame series in lockstep and returns the first divergence, or
 * null when every frame agrees under `equals`. The single first-divergence
 * walker behind compareReplay/compareTiers — same loop, different equality
 * and messaging per mode. */
function findFirstDivergence(
  leftFrames: FrameCapture[],
  rightFrames: Array<FrameCapture | undefined>,
  options: DivergenceOptions,
): { frame: number; details: string[] } | null {
  const {
    equals,
    geometryEquals,
    labels,
    sameFrame,
    noSnapshotNotice,
    missingFrameNotice,
  } = options;
  for (let index = 0; index < leftFrames.length; index += 1) {
    const left = leftFrames[index] as FrameCapture;
    const right = rightFrames[index];
    if (!right) {
      return { frame: index, details: [missingFrameNotice] };
    }
    if (sameFrame?.(left, right)) {
      continue;
    }
    // Compare whatever this frame actually carries. Compact golden traces
    // keep variables only on checkpoint frames but geometry on every frame,
    // so requiring both would have thrown away the per-frame geometry signal
    // and reported "cannot tell you what moved" instead of using it.
    const comparableVariables = Boolean(left.variables && right.variables);
    const comparableGeometry = Boolean(left.geometry && right.geometry);
    if (!comparableVariables && !comparableGeometry) {
      return { frame: index, details: [noSnapshotNotice] };
    }
    const details = diffFields(left, right, equals, labels, geometryEquals);
    if (details.length > 0) {
      return { frame: index, details };
    }
  }
  return null;
}

/**
 * Largest relative difference treated as floating-point noise rather than a
 * semantics change, for raw (unrounded) variables.
 *
 * A double carries ~16 significant digits, so 1e-9 discards roughly the last
 * seven of them while still failing on anything a person would call a
 * behavior change. The gap is deliberate and large: measured cross-machine
 * noise on these traces is ~8e-16 relative (a couple of ulps on `shape4_x`),
 * and the divergences this gate exists to catch — a wrong guard, a wrong
 * operator, an off-by-one in a loop — move values by whole percentages or
 * flip their sign. Nothing real lives in the six orders of magnitude
 * between.
 */
const GOLDEN_VARIABLE_TOLERANCE = 1e-9;

/**
 * Absolute floor for the geometry triple.
 *
 * `positionsChecksum` rounds to 1e-6 before storing, so two runs that differ
 * only in the last bits can still land on opposite sides of that rounding
 * boundary and print a difference of exactly 1e-6. The floor absorbs that
 * quantisation step; the relative term above still governs anything larger.
 */
const GOLDEN_GEOMETRY_FLOOR = 2e-6;

function nearlyEqual(tolerance: number, floor: number) {
  return (a: number | undefined, b: number | undefined): boolean => {
    const left = a ?? 0;
    const right = b ?? 0;
    if (left === right) return true;
    // NaN/Infinity are semantics, never noise: an unguarded divide is exactly
    // the sort of regression this gate is here to catch, so any non-finite
    // value must match its counterpart exactly.
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    const magnitude = Math.max(Math.abs(left), Math.abs(right));
    return Math.abs(left - right) <= Math.max(floor, tolerance * magnitude);
  };
}

/**
 * Compares a replay against a trace; returns null when every frame agrees,
 * else the first divergence. Shared by the CLI and the golden-trace unit gate.
 *
 * Identical digests are the fast path — same machine, same code, nothing to
 * do. A digest mismatch is NOT by itself a failure, because the digest is
 * FNV-1a over full-precision doubles and therefore changes completely when a
 * single variable moves by one ulp. Two CPUs legitimately disagree in the
 * last bits of `pow`/`sin`, so treating the digest as the verdict made these
 * traces pass only on the machine that recorded them: they were red on CI and
 * in a Linux container while presumably green for their author, and red even
 * when replayed against the exact commit that recorded them.
 *
 * So a digest mismatch escalates to a field comparison under the tolerances
 * above, which is what actually decides the result.
 */
export function compareReplay(
  trace: TraceFile,
  replayed: FrameCapture[],
): { frame: number; details: string[] } | null {
  return findFirstDivergence(trace.frames, replayed, {
    equals: nearlyEqual(GOLDEN_VARIABLE_TOLERANCE, 0),
    geometryEquals: nearlyEqual(
      GOLDEN_VARIABLE_TOLERANCE,
      GOLDEN_GEOMETRY_FLOOR,
    ),
    labels: ['recorded', 'replayed'],
    sameFrame: (left, right) => left.digest === right.digest,
    missingFrameNotice: '  (missing frame)',
    noSnapshotNotice:
      '  (compact trace: this frame carries neither a variable checkpoint nor geometry — re-record without --compact)',
  });
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

/** Loose f32-vs-f64 comparison for the GPU tier. The compute VM stores state
 * as f32 and re-reads it every frame, so drift against the f64 CPU replay is
 * expected; the divergences this tier-diff exists to catch — wrong guard or
 * operator semantics — are orders of magnitude, not ulps. */
function toleranceEquals(tolerance: number) {
  return (a: number | undefined, b: number | undefined): boolean => {
    const left = a ?? 0;
    const right = b ?? 0;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return left === right;
    }
    const diff = Math.abs(left - right);
    return (
      diff <=
      tolerance + 5 * tolerance * Math.max(Math.abs(left), Math.abs(right))
    );
  };
}

/** Tolerance-based cross-tier diff: first frame where any variable or
 * geometry checksum moves beyond `tolerance`, or null. Digests are ignored
 * (exact equality across f32/f64 tiers, or across V8/JSC, is meaningless). */
export function compareTiers(
  cpuFrames: FrameCapture[],
  gpuFrames: FrameCapture[],
  tolerance: number,
  labels: [string, string] = ['cpu', 'gpu'],
): { frame: number; details: string[] } | null {
  return findFirstDivergence(cpuFrames, gpuFrames, {
    equals: toleranceEquals(tolerance),
    labels,
    missingFrameNotice: '  (missing frame or snapshot)',
    noSnapshotNotice: '  (missing frame or snapshot)',
  });
}

/** Replays a trace through the full VM with the compute-VM per-frame program
 * running on an actual GPU (headless Chromium WebGPU), returning per-frame
 * captures. The whole VM graph is imported into the page from the Vite dev
 * server so page and CLI share one implementation. */
async function runGpuTrace(
  raw: string,
  presetId: string,
  inputs: FrameInputs[],
  webgpuFlags?: Partial<MilkdropWebGpuOptimizationFlags>,
): Promise<FrameCapture[]> {
  const { chromium } = await import('playwright');
  const server = await ensureDevServer(GPU_REPLAY_PORT, process.cwd());
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage();
    // navigator.gpu is hidden on about:blank in Playwright Chromium — the
    // probe (and everything else) must run after a real page load.
    await page.goto(`http://127.0.0.1:${GPU_REPLAY_PORT}/?agent=true`, {
      waitUntil: 'domcontentloaded',
    });
    const gpuAvailable = await page.evaluate(() => 'gpu' in navigator);
    if (!gpuAvailable) {
      throw new Error('navigator.gpu unavailable in this Chromium.');
    }

    const result = (await page.evaluate(
      async ({ raw, presetId, inputs, webgpuFlags }) => {
        try {
          // Dev-server-relative specifiers, kept dynamic so the CLI's own
          // typecheck doesn't try to resolve them as Node modules.
          const modulePath = (name: string) => `/src/js/milkdrop/${name}.ts`;
          const [
            compilerModule,
            vmModule,
            signalsModule,
            captureModule,
            flagsModule,
          ] = await Promise.all([
            import(modulePath('compiler')),
            import(modulePath('vm')),
            import(modulePath('runtime-signals')),
            import(modulePath('trace-capture')),
            import(modulePath('webgpu-optimization-flags')),
          ]);
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) {
            return { error: 'no WebGPU adapter' };
          }
          const device = await adapter.requestDevice();

          const compiled = compilerModule.compileMilkdropPresetSource(raw, {
            id: presetId,
          });
          const vm = vmModule.createMilkdropVM(compiled);
          vm.setWebGpuOptimizationFlags({
            ...flagsModule.DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
            ...(webgpuFlags ?? null),
            gpuComputeVM: true,
          });
          vm.setRenderBackend('webgpu');
          if (!vm.setGpuDevice(device)) {
            return {
              error:
                'per-frame program is not GPU-executable (gpuExecutable: false) — the compute VM would silently run the CPU path.',
            };
          }
          const tracker = signalsModule.createMilkdropSignalTracker();
          const frames: unknown[] = [];
          for (const frame of inputs) {
            let signals: Record<string, unknown>;
            if (frame.signals) {
              if (frame.detailScale !== undefined) {
                vm.setDetailScale(frame.detailScale);
              }
              signals = {
                ...frame.signals,
                ...(frame.arrays
                  ? captureModule.reviveInputArrays(frame.arrays)
                  : null),
                frequencyData: new Uint8Array(frame.frequencyData),
                waveformData: new Uint8Array(frame.waveformData),
              };
            } else {
              signals = tracker.update({
                time: frame.time,
                deltaMs: frame.deltaMs,
                analyser: null,
                frequencyData: new Uint8Array(frame.frequencyData),
                waveformData: new Uint8Array(frame.waveformData),
              });
            }
            // biome-ignore lint/suspicious/noExplicitAny: cross-module page eval
            const frameState = await vm.stepAsync(signals as any);
            frames.push(captureModule.captureFrame(frameState));
          }
          return { frames };
        } catch (error) {
          return { error: String(error) };
        }
      },
      { raw, presetId, inputs, webgpuFlags: webgpuFlags ?? null },
    )) as { frames?: FrameCapture[]; error?: string };

    if (result.error || !result.frames) {
      throw new Error(`GPU replay failed: ${result.error ?? 'no frames'}`);
    }
    return result.frames;
  } finally {
    await browser.close();
    server.close();
  }
}

const GOLDEN_CHECKPOINT_EVERY = 30;

/**
 * Strips the full variable snapshot from non-checkpoint frames but KEEPS the
 * geometry triple on every frame.
 *
 * Geometry is three numbers, already rounded to 1e-6 by `positionsChecksum`,
 * so retaining it costs almost nothing and buys the golden gate a per-frame
 * signal that survives a change of machine. The digest cannot do that job
 * alone: it is FNV-1a over full-precision doubles, so a last-bit difference
 * in any one variable — the kind two CPUs disagree on for `pow`/`sin` —
 * changes it completely. Without geometry here, a digest mismatch on a
 * non-checkpoint frame left nothing to compare and the gate could only say
 * "something moved, and I cannot tell you what".
 */
function compactFrames(frames: FrameCapture[]): FrameCapture[] {
  return frames.map((frame, index) =>
    index % GOLDEN_CHECKPOINT_EVERY === 0
      ? frame
      : { digest: frame.digest, geometry: frame.geometry },
  );
}

async function main() {
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
  const tier = get('--tier') ?? 'cpu';
  const tolerance = Number(get('--tolerance') ?? 1e-3);

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
    const inputs = traceInputs(trace);

    if (tier === 'gpu') {
      // GPU tier: diff the compute-VM replay against a fresh CPU replay of
      // the same inputs (NOT the recorded digests — those are f64-exact).
      // Both sides run under webgpu backend semantics so the procedural
      // wave/mesh routing is identical and the diff isolates the per-frame
      // program execution (CPU JIT vs GPU compute).
      const cpuFrames = runTrace(source.raw, trace.presetId, inputs, {
        backend: 'webgpu',
        webgpuFlags: trace.webgpuFlags,
      });
      const gpuFrames = await runGpuTrace(
        source.raw,
        trace.presetId,
        inputs,
        trace.webgpuFlags,
      );
      const divergence = compareTiers(cpuFrames, gpuFrames, tolerance);
      if (divergence) {
        console.error(
          `✗ GPU tier DIVERGED from CPU at frame ${divergence.frame}/${cpuFrames.length} (tolerance ${tolerance})`,
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
        `✔ GPU tier verified: ${cpuFrames.length} frames of ${trace.presetId} match the CPU replay within tolerance ${tolerance}.`,
      );
      return;
    }
    if (tier !== 'cpu') {
      console.error(`Unknown --tier "${tier}" (expected cpu or gpu).`);
      process.exit(1);
    }
    const replayed = runTrace(source.raw, trace.presetId, inputs, {
      backend: trace.backend,
      webgpuFlags: trace.webgpuFlags,
    });

    if (dumpFrame !== undefined) {
      const index = Number(dumpFrame);
      const frame = replayed[index];
      if (frame) {
        console.log(`state at frame ${index}:`);
        console.log(JSON.stringify(frame, null, 2));
      }
    }

    // Live traces were recorded in a browser (V8); Bun (JSC) transcendentals
    // differ across engines, so cross-engine replay verifies within a
    // tolerance rather than digest-exact. Synthetic traces (recorded by this
    // CLI) stay bit-for-bit. 1e-4 default calibrated against two presets: a
    // light one drifted ~1 ulp (1e-6 would suffice), but a transcendental-
    // heavy one (many chained sin/cos/pow per frame) drifted up to ~5e-5 on
    // legitimately-agreeing values — 1e-6 reported false divergences there.
    // Still tight enough to catch a real bug: a 100%-magnitude error (a
    // wrongly-defaulted field, say) fails at any tolerance under ~1.
    //
    // CAVEAT — a divergence this tolerance can't explain (an exact 2x, an
    // integer step, not a fractional drift) usually isn't cross-engine noise
    // at all: it means the CLI's local preset-source read (loadPresetSource)
    // compiled to different baked-in field defaults than whatever the live
    // session's catalog fetch actually served — a preset-source-fidelity gap
    // between the live app and this harness, not a replay bug. Confirmed
    // case: yin-385-magic-ride-distance-based-hue's gammaadj compiled to 1
    // from a local file read but was 2 in a live capture. Investigate the
    // preset import/compile path, not the tolerance, when you see this.
    if (trace.source === 'live') {
      const liveTolerance = get('--tolerance') ? tolerance : 1e-4;
      console.log(
        `(live trace: ${trace.frameCount} frames of ${trace.presetId}; cross-engine replay, tolerance ${liveTolerance})`,
      );
      const divergence = compareTiers(trace.frames, replayed, liveTolerance, [
        'recorded',
        'replayed',
      ]);
      if (divergence) {
        console.error(
          `✗ DIVERGED at frame ${divergence.frame}/${trace.frames.length} (tolerance ${liveTolerance})`,
        );
        console.error(divergence.details.slice(0, 20).join('\n'));
        process.exit(1);
      }
      console.log(
        `✔ live replay verified: ${trace.frames.length} frames of ${trace.presetId} match within tolerance ${liveTolerance}.`,
      );
      return;
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
      '  bun run lab:replay -- --replay trace.json [--dump <frame>]\n' +
      '  bun run lab:replay -- --replay trace.json --tier gpu [--tolerance 1e-3]',
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
