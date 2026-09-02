/**
 * Live-performance runtime — the in-page half of "Claude plays this thing".
 *
 * The pre-existing agent surface could only make *step* changes to visuals:
 * `session_midi_set` posts one value and returns. That is enough to test a
 * preset and not enough to perform with, for three reasons this module fixes:
 *
 *   1. No audio. Strudel (the live-coding engine) was reachable only from
 *      `StrudelLabPanel` behind `?strudel=1`, so an agent could drive the
 *      visuals but could not play a note — half the instrument was mute.
 *   2. No time. A performer rides a fader over bars; a step change is a jump
 *      cut. `ramp()` glides one or more targets together over a duration.
 *   3. No ear. `__STIMS_AGENT_TELEMETRY__.audioEnergy` is snapshot-based and
 *      freezes between engine emissions, so polling it proves nothing about
 *      what is currently audible. `listen()` measures the actual signal.
 *
 * Installed on `window.__stims_live` (extending the object App.tsx already
 * published) so both the MCP session tools and a human at the console reach
 * the same runtime. Dependencies are injected rather than imported so this
 * module stays free of React and the engine graph.
 */

import { getAgentTelemetry } from './agent-bridge.ts';
import {
  bind as bindModulator,
  getModulationHealth,
  installModulation,
  listModulators,
  type ModulationHealth,
  type Modulator,
  type ModulatorSpec,
  unbindAll as unbindAllModulators,
  unbind as unbindModulator,
} from './live-modulation.ts';
import {
  attachStream as attachSignalStream,
  hasLiveSignal,
  readBands,
  releaseSignal,
} from './live-signal.ts';
import {
  loadStrudelBridge,
  peekStrudelBridge,
  type StrudelBridge,
} from './strudel-audio-bridge.ts';

export type RampCurve = 'linear' | 'sine' | 'exp';

export interface RampRequest {
  /** Target field(s) and their destination values, moved as one gesture. */
  targets: Record<string, number>;
  durationMs: number;
  curve?: RampCurve;
  /**
   * Starting values. Omitted targets start from this module's last known
   * fader position (see `positions`), or from `to` if it has never been set —
   * a ramp from an unknown origin would otherwise snap.
   */
  from?: Record<string, number>;
}

/**
 * How a ramp reached its destination.
 *
 * - `glided`   — travelled through intermediate values, as asked.
 * - `instant`  — `durationMs: 0`, a deliberate immediate set.
 * - `starved`  — the rAF loop ran, but its first frame arrived after the whole
 *                duration had elapsed, so there was nothing left to travel and
 *                the value snapped. The watchdog was not involved.
 * - `watchdog` — rAF never fired at all (a hidden tab throttles it), and the
 *                timer landed the value.
 *
 * `starved` and `watchdog` are both failures to glide but have different
 * causes and different fixes, so they are reported separately rather than
 * collapsed into one flag.
 */
export type RampLanding = 'glided' | 'instant' | 'starved' | 'watchdog';

export interface RampResult {
  targets: string[];
  durationMs: number;
  curve: RampCurve;
  steps: number;
  /** Why the gesture ended the way it did. */
  landing: RampLanding;
  /**
   * True when the ramp did not glide — `starved` or `watchdog`. Kept as the
   * one-bit summary callers had before `landing` existed; read `landing` when
   * the cause matters.
   */
  forcedLanding: boolean;
  final: Record<string, number>;
}

export interface ListenSample {
  tMs: number;
  /** Broadband RMS of the measured stream, 0-1. */
  rms: number;
  bass: number;
  mid: number;
  treble: number;
}

export interface ListenResult {
  /**
   * 'stream' — measured from the live audio graph, trustworthy.
   * 'telemetry' — no stream attached, so this is the snapshot-based engine
   * energy, which freezes between emissions. Stated rather than hidden
   * because a frozen reading looks identical to a steady one.
   */
  source: 'stream' | 'telemetry';
  durationMs: number;
  samples: ListenSample[];
  rmsMin: number;
  rmsMax: number;
  rmsMean: number;
  /** Peaks/minute from broadband onsets; null when too few samples to tell. */
  estimatedBpm: number | null;
  fps: number;
  backend: string;
  presetId: string | null;
}

export interface LivePerformanceDeps {
  /** Apply a field value as the virtual "Claude (MCP)" MIDI device. */
  setTarget: (target: string, value: number) => void;
  injectMidiCC: (cc: number, value: number) => void;
  nextPreset: () => void;
  previousPreset: () => void;
  /** Routes a stream into the visualiser analyser (engine.startAudioSource). */
  startStreamAudio: (stream: MediaStream) => Promise<void>;
}

const EASE: Record<RampCurve, (t: number) => number> = {
  linear: (t) => t,
  // Ease-in-out. Reads as a hand on a fader rather than a servo.
  sine: (t) => 0.5 - Math.cos(Math.PI * t) / 2,
  // Perceptual for gain-like targets, where linear travel sounds back-loaded.
  exp: (t) => t * t,
};

/** Last value this module drove per target — the fader's own position. */
const positions = new Map<string, number>();
/** Ramp generation per target, so a new ramp supersedes one in flight. */
const generations = new Map<string, number>();

let deps: LivePerformanceDeps | null = null;
let strudel: StrudelBridge | null = null;
let strudelRouted = false;
/** Last tempo a pattern set, so tempo-synced modulators know the cycle. */
let currentCps: number | null = null;

function requireDeps(): LivePerformanceDeps {
  if (!deps) {
    throw new Error('live-performance runtime is not installed yet');
  }
  return deps;
}

// ── audio ────────────────────────────────────────────────────────────────

/**
 * Evaluate a Strudel pattern, loading the engine on first use and routing its
 * tapped output into the visualiser analyser exactly once. Mirrors
 * StrudelLabPanel.handlePlay; the panel keeps its own copy because it also
 * drives React state and the scope strip.
 */
export async function playPattern(
  code: string,
  options?: { cps?: number },
): Promise<{ routed: boolean; cps: number | null }> {
  const { startStreamAudio } = requireDeps();

  if (!strudel) {
    strudel = peekStrudelBridge() ?? (await loadStrudelBridge());
    attachSignalStream(strudel.stream);
  }

  // Tempo rides in the pattern source: Strudel exposes setcps to evaluated
  // code, not to the module surface we type in strudel-web.d.ts.
  const cps = options?.cps ?? null;
  const source = cps === null ? code : `setcps(${cps})\n${code}`;
  await strudel.evaluate(source);
  if (cps !== null) currentCps = cps;

  if (!strudelRouted) {
    await startStreamAudio(strudel.stream);
    strudelRouted = true;
  }

  return { routed: strudelRouted, cps };
}

export function hush(): void {
  strudel?.hush();
}

/** Point the analyser at an arbitrary stream (e.g. mic) instead of Strudel's. */
export function attachStream(stream: MediaStream | null): void {
  attachSignalStream(stream);
}

/** Tempo the last pattern set, or null if none has. */
export function getCps(): number | null {
  return currentCps;
}

// ── gesture ──────────────────────────────────────────────────────────────

/**
 * Glide targets to their destinations over `durationMs`.
 *
 * Stepped by rAF, but a timer watchdog always lands the final value: rAF is
 * suspended when the tab is hidden (which the Browser pane reports even when
 * visible to the user), and a ramp that silently stalls mid-travel would
 * leave the instrument in a half-state with no error.
 *
 * `landing` reports how the gesture actually ended, and `forcedLanding` is the
 * one-bit summary of it. Two distinct things stop a ramp gliding: the watchdog
 * lands the value because rAF never fired, or rAF fires but its first frame
 * arrives after the whole duration has elapsed, leaving nothing to travel. The
 * second used to report `forcedLanding: false`, claiming a healthy glide for
 * what was really a teleport under a starved main thread — and the two have
 * different causes, so `landing` keeps them apart.
 */
export function ramp(request: RampRequest): Promise<RampResult> {
  const { setTarget } = requireDeps();
  const curve = request.curve ?? 'sine';
  const ease = EASE[curve] ?? EASE.sine;
  const durationMs = Math.max(0, request.durationMs);
  const entries = Object.entries(request.targets);

  const plan = entries.map(([target, to]) => {
    const from =
      request.from?.[target] ??
      positions.get(target) ??
      // Never travelled before: start at the destination so the gesture is a
      // no-op set rather than a snap from an invented origin.
      to;
    const generation = (generations.get(target) ?? 0) + 1;
    generations.set(target, generation);
    return { target, from, to, generation };
  });

  return new Promise<RampResult>((resolve) => {
    const started = performance.now();
    let steps = 0;
    let settled = false;
    /** Whether any frame landed strictly between the endpoints. */
    let glided = false;

    const apply = (progress: number) => {
      const eased = ease(Math.min(1, Math.max(0, progress)));
      for (const leg of plan) {
        // A newer ramp owns this target now; abandon this leg silently so the
        // two gestures do not fight frame by frame.
        if (generations.get(leg.target) !== leg.generation) continue;
        const value = leg.from + (leg.to - leg.from) * eased;
        positions.set(leg.target, value);
        setTarget(leg.target, value);
      }
    };

    const finish = (byWatchdog: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      apply(1);
      // A ramp that never got a frame inside its own window did not glide,
      // however it was landed. `durationMs === 0` is its own case: an instant
      // set is a deliberate request, not a starved gesture.
      const landing: RampLanding = byWatchdog
        ? 'watchdog'
        : durationMs === 0
          ? 'instant'
          : glided
            ? 'glided'
            : 'starved';
      resolve({
        targets: plan.map((leg) => leg.target),
        durationMs,
        curve,
        steps,
        landing,
        forcedLanding: landing === 'starved' || landing === 'watchdog',
        final: Object.fromEntries(plan.map((leg) => [leg.target, leg.to])),
      });
    };

    const step = () => {
      if (settled) return;
      const elapsed = performance.now() - started;
      steps += 1;
      if (elapsed >= durationMs) {
        finish(false);
        return;
      }
      glided = true;
      apply(elapsed / durationMs);
      requestAnimationFrame(step);
    };

    // Fires slightly late so a healthy rAF loop always finishes first and
    // reports forcedLanding: false.
    const watchdog = window.setTimeout(() => finish(true), durationMs + 120);

    if (durationMs === 0) {
      finish(false);
      return;
    }
    requestAnimationFrame(step);
  });
}

/** Fader positions this module has driven, for reading back current state. */
export function getPositions(): Record<string, number> {
  return Object.fromEntries(positions);
}

// ── ear ──────────────────────────────────────────────────────────────────

/**
 * Measure the live signal over a window. Uses an AnalyserNode on the actual
 * stream because the engine's published energy is a frozen snapshot — see the
 * module header.
 */
export async function listen(options?: {
  durationMs?: number;
  intervalMs?: number;
}): Promise<ListenResult> {
  const durationMs = Math.min(
    30_000,
    Math.max(100, options?.durationMs ?? 2000),
  );
  const intervalMs = Math.min(
    durationMs,
    Math.max(16, options?.intervalMs ?? 50),
  );
  const telemetry = getAgentTelemetry();
  const samples: ListenSample[] = [];
  // Sampled once: a stream appearing mid-window would otherwise mix measured
  // and snapshot values into one series under a single source label.
  const measuring = hasLiveSignal();
  const started = performance.now();

  await new Promise<void>((resolve) => {
    const tick = () => {
      const bands = measuring ? readBands() : null;
      if (bands) {
        samples.push({
          tMs: Math.round(performance.now() - started),
          ...bands,
        });
      } else {
        // No graph to tap. Record the snapshot value and label it, rather
        // than dressing a frozen number up as a measurement.
        const energy = getAgentTelemetry().audioEnergy;
        samples.push({
          tMs: Math.round(performance.now() - started),
          rms: energy,
          bass: energy,
          mid: energy,
          treble: energy,
        });
      }
      if (performance.now() - started >= durationMs) resolve();
      else window.setTimeout(tick, intervalMs);
    };
    tick();
  });

  return summarise(
    measuring ? 'stream' : 'telemetry',
    durationMs,
    samples,
    telemetry,
  );
}

function summarise(
  source: 'stream' | 'telemetry',
  durationMs: number,
  samples: ListenSample[],
  telemetry: ReturnType<typeof getAgentTelemetry>,
): ListenResult {
  let rmsMin = 0;
  let rmsMax = 0;
  let rmsSum = 0;
  const len = samples.length;

  if (len > 0) {
    rmsMin = samples[0].rms;
    rmsMax = samples[0].rms;
    for (let i = 0; i < len; i += 1) {
      const val = samples[i].rms;
      if (val < rmsMin) rmsMin = val;
      if (val > rmsMax) rmsMax = val;
      rmsSum += val;
    }
  }

  const rmsMean = len > 0 ? rmsSum / len : 0;

  return {
    source,
    durationMs,
    samples,
    rmsMin,
    rmsMax,
    rmsMean,
    estimatedBpm: estimateBpm(samples, rmsMean, rmsMax),
    fps: telemetry.fps,
    backend: telemetry.backend,
    presetId: telemetry.currentPresetId,
  };
}

/**
 * Coarse onset counting: peaks crossing a midpoint threshold, scaled to a
 * minute. Good enough to answer "am I in the right tempo range"; not a beat
 * tracker, so it returns null rather than a confident wrong number when the
 * window is too short or the signal too flat.
 */
function estimateBpm(
  samples: ListenSample[],
  mean: number,
  max: number,
): number | null {
  if (samples.length < 16 || max - mean < 0.01) return null;
  const threshold = mean + (max - mean) * 0.4;
  let onsets = 0;
  let armed = true;
  for (const sample of samples) {
    if (armed && sample.rms >= threshold) {
      onsets += 1;
      armed = false;
    } else if (!armed && sample.rms < threshold * 0.8) {
      armed = true;
    }
  }
  if (onsets < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  const spanMs = last.tMs - first.tMs;
  if (spanMs <= 0) return null;
  return Math.round((onsets / spanMs) * 60_000);
}

// ── vocabulary: macros and scenes ────────────────────────────────────────

/**
 * One step of a macro. Deliberately the same verbs the live API exposes, so
 * anything performed by hand can be recorded as a macro without translation.
 */
export type MacroStep =
  | { ramp: RampRequest }
  | { set: Record<string, number> }
  | { waitMs: number }
  | { pattern: string; cps?: number }
  | { hush: true }
  | { bind: ModulatorSpec }
  | { unbind: { id?: string; target?: string } };

export interface Macro {
  name: string;
  description?: string;
  steps: MacroStep[];
}

export interface Scene {
  name: string;
  /** Target positions captured at save time. */
  positions: Record<string, number>;
  /** Modulators active at save time, restored on recall. */
  modulators: ModulatorSpec[];
  description?: string;
}

const STORAGE_KEY = 'stims:live-rig';

const macros = new Map<string, Macro>();
const scenes = new Map<string, Scene>();

/**
 * Macros and scenes are the performer's own vocabulary, so they outlive the
 * page. Storage failures are swallowed: a private-mode browser losing the rig
 * is worth a degraded feature, not a thrown error mid-performance.
 */
function persist(): void {
  try {
    window.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        macros: [...macros.values()],
        scenes: [...scenes.values()],
      }),
    );
  } catch {
    // Non-fatal, see above.
  }
}

function restore(): void {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { macros?: Macro[]; scenes?: Scene[] };
    for (const macro of parsed.macros ?? []) {
      if (macro?.name && Array.isArray(macro.steps))
        macros.set(macro.name, macro);
    }
    for (const scene of parsed.scenes ?? []) {
      if (scene?.name && scene.positions) {
        // Scenes saved before modulators existed have no list; default it
        // rather than letting undefined reach recallScene.
        scenes.set(scene.name, {
          ...scene,
          modulators: scene.modulators ?? [],
        });
      }
    }
  } catch {
    // A corrupt rig should not stop the instrument from loading.
  }
}

export function defineMacro(macro: Macro): Macro {
  macros.set(macro.name, macro);
  persist();
  return macro;
}

export function deleteMacro(name: string): boolean {
  const existed = macros.delete(name);
  if (existed) persist();
  return existed;
}

export function listMacros(): Macro[] {
  return [...macros.values()];
}

export interface MacroRunResult {
  name: string;
  stepsRun: number;
  elapsedMs: number;
}

/**
 * Run a macro's steps in order. Ramps are awaited, so a macro is a timeline
 * rather than a burst — which is the whole point of naming a gesture.
 */
export async function runMacro(
  name: string,
  overrides?: { speed?: number },
): Promise<MacroRunResult> {
  const macro = macros.get(name);
  if (!macro) {
    throw new Error(
      `No macro named "${name}". Known: ${[...macros.keys()].join(', ') || '(none)'}`,
    );
  }
  // >1 is faster. Guarded because 0 would make every ramp infinite.
  const speed = Math.max(0.05, overrides?.speed ?? 1);
  const started = performance.now();
  let stepsRun = 0;

  for (const step of macro.steps) {
    if ('ramp' in step) {
      await ramp({ ...step.ramp, durationMs: step.ramp.durationMs / speed });
    } else if ('set' in step) {
      const { setTarget } = requireDeps();
      for (const [target, value] of Object.entries(step.set)) {
        positions.set(target, value);
        setTarget(target, value);
      }
    } else if ('waitMs' in step) {
      await new Promise((resolve) => setTimeout(resolve, step.waitMs / speed));
    } else if ('pattern' in step) {
      await playPattern(step.pattern, step.cps ? { cps: step.cps } : undefined);
    } else if ('hush' in step) {
      hush();
    } else if ('bind' in step) {
      bindModulator(step.bind);
    } else if ('unbind' in step) {
      unbindModulator(step.unbind);
    }
    stepsRun += 1;
  }

  return {
    name,
    stepsRun,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/** Snapshot current fader positions and modulators under a name. */
export function saveScene(name: string, description?: string): Scene {
  const scene: Scene = {
    name,
    description,
    positions: Object.fromEntries(positions),
    modulators: listModulators().map(({ value: _value, ...spec }) => spec),
  };
  scenes.set(name, scene);
  persist();
  return scene;
}

export function listScenes(): Scene[] {
  return [...scenes.values()];
}

export function deleteScene(name: string): boolean {
  const existed = scenes.delete(name);
  if (existed) persist();
  return existed;
}

/**
 * Move to a saved scene. Ramping rather than snapping is the default because
 * a scene change mid-performance is a transition, not a cut — pass
 * durationMs 0 for the cut.
 */
export async function recallScene(
  name: string,
  options?: { durationMs?: number; curve?: RampCurve },
): Promise<RampResult & { modulators: number }> {
  const scene = scenes.get(name);
  if (!scene) {
    throw new Error(
      `No scene named "${name}". Known: ${[...scenes.keys()].join(', ') || '(none)'}`,
    );
  }

  // Modulators are replaced before the ramp so the new movement is already
  // running as the parameters arrive, rather than snapping in afterwards.
  unbindAllModulators();
  for (const spec of scene.modulators) bindModulator(spec);

  const result = await ramp({
    targets: scene.positions,
    durationMs: options?.durationMs ?? 2000,
    curve: options?.curve ?? 'sine',
  });

  return { ...result, modulators: scene.modulators.length };
}

// ── installation ─────────────────────────────────────────────────────────

export interface LivePerformanceApi {
  setControl: (target: string, value: number) => void;
  injectMidiCC: (cc: number, value: number) => void;
  nextPreset: () => void;
  previousPreset: () => void;
  playPattern: typeof playPattern;
  hush: typeof hush;
  attachStream: typeof attachStream;
  getCps: typeof getCps;
  ramp: typeof ramp;
  getPositions: typeof getPositions;
  listen: typeof listen;
  // Customization: continuous movement, and a named vocabulary for it.
  bind: (spec: ModulatorSpec) => Modulator;
  unbind: (selector: { id?: string; target?: string }) => string[];
  unbindAll: () => string[];
  listModulators: () => Modulator[];
  getModulationHealth: () => ModulationHealth;
  defineMacro: typeof defineMacro;
  runMacro: typeof runMacro;
  listMacros: typeof listMacros;
  deleteMacro: typeof deleteMacro;
  saveScene: typeof saveScene;
  recallScene: typeof recallScene;
  listScenes: typeof listScenes;
  deleteScene: typeof deleteScene;
}

declare global {
  interface Window {
    __stims_live?: LivePerformanceApi;
  }
}

/**
 * Publish the runtime on `window.__stims_live`. Returns a teardown that only
 * clears the global if it still owns it, so a remount during HMR cannot
 * unpublish its successor.
 */
export function installLivePerformance(next: LivePerformanceDeps): () => void {
  deps = next;
  restore();

  // Modulators read the position map as their centre and write only through
  // setTarget, so a ramp can move the resting value while modulation
  // continues around it.
  const uninstallModulation = installModulation({
    setTarget: next.setTarget,
    getCenter: (target) => positions.get(target),
    getCps,
  });

  const api: LivePerformanceApi = {
    setControl: (target, value) => {
      positions.set(target, value);
      next.setTarget(target, value);
    },
    injectMidiCC: next.injectMidiCC,
    nextPreset: next.nextPreset,
    previousPreset: next.previousPreset,
    playPattern,
    hush,
    attachStream,
    getCps,
    ramp,
    getPositions,
    listen,
    bind: bindModulator,
    unbind: unbindModulator,
    unbindAll: unbindAllModulators,
    listModulators,
    getModulationHealth,
    defineMacro,
    runMacro,
    listMacros,
    deleteMacro,
    saveScene,
    recallScene,
    listScenes,
    deleteScene,
  };

  window.__stims_live = api;

  return () => {
    uninstallModulation();
    releaseSignal();
    if (window.__stims_live === api) {
      window.__stims_live = undefined;
    }
    if (deps === next) {
      deps = null;
    }
  };
}
