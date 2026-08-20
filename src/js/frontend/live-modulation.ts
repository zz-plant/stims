/**
 * Modulation engine — parameters that move on their own.
 *
 * `ramp()` covers gestures the performer makes. This covers the motion that
 * should keep happening without anyone touching it: a slow LFO breathing
 * through the warp field, or the kick drum punching zoom on every hit. Without
 * it, staying alive means issuing a call per gesture forever, and anything
 * beat-synced is impossible because the round-trip is far longer than a beat.
 *
 * Modulators are an *offset*, not an override. Each frame a target is set to
 *
 *     center + Σ(depth × shaped source)
 *
 * where `center` is the fader position ramps and sets move. So a ramp can
 * raise the resting value of a parameter while an LFO keeps wobbling around
 * it — the two compose instead of fighting, which is how a synth behaves and
 * is why modulators never write back into the position map.
 *
 * One rAF loop drives every modulator. It stops when the last one is removed.
 */

import { type BandName, readBands, SILENT_BANDS } from './live-signal.ts';

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random';

export type ModulationSource =
  | {
      kind: 'lfo';
      shape?: LfoShape;
      /** Absolute rate. Ignored when `cycles` is set. */
      hz?: number;
      /** Rate relative to the pattern tempo — 1 = once per Strudel cycle. */
      cycles?: number;
      /** Starting phase, 0-1. Offset two LFOs to make them chase. */
      phase?: number;
    }
  | {
      kind: 'audio';
      band?: BandName;
      /** Rise time in ms. Low = snappy transients. */
      attack?: number;
      /** Fall time in ms. High = the parameter hangs after a hit. */
      release?: number;
      /** Scales the band before depth, for quiet sources. */
      gain?: number;
    };

export interface ModulatorSpec {
  target: string;
  source: ModulationSource;
  /** Excursion from centre, in the target's own units. May be negative. */
  depth: number;
  min?: number;
  max?: number;
  /** Supply to replace an existing modulator; omit to add another. */
  id?: string;
}

export interface Modulator extends ModulatorSpec {
  id: string;
  /** Last shaped source value, -1..1 (lfo) or 0..1 (audio). */
  value: number;
}

export interface ModulationDeps {
  setTarget: (target: string, value: number) => void;
  /** Resting value a modulator swings around. */
  getCenter: (target: string) => number | undefined;
  /** Current cycles-per-second, for tempo-synced rates. */
  getCps: () => number | null;
}

/** Assumed tempo for `cycles` rates before a pattern sets one. Strudel's own default. */
const FALLBACK_CPS = 0.5;

const modulators = new Map<string, Modulator>();
const phases = new Map<string, number>();
const envelopes = new Map<string, number>();
const holds = new Map<string, { value: number }>();

let deps: ModulationDeps | null = null;
let frame: number | null = null;
let lastFrameAt: number | null = null;
let lastTickAt: number | null = null;
let nextId = 1;

export function installModulation(next: ModulationDeps): () => void {
  deps = next;
  // Modulators outlive the install. The workspace effect re-runs whenever the
  // engine identity changes — which happens while a preset loads — and
  // clearing here silently deleted anything bound during startup, with the
  // tool having already reported success. Positions, macros and scenes all
  // survive a remount; modulation is no different, so pick the loop back up.
  if (modulators.size > 0) startLoop();

  return () => {
    if (deps === next) {
      stopLoop();
      deps = null;
    }
  };
}

function shapeLfo(shape: Exclude<LfoShape, 'random'>, phase: number): number {
  switch (shape) {
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'saw':
      return 2 * phase - 1;
    case 'square':
      return phase < 0.5 ? 1 : -1;
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

function advance(modulator: Modulator, deltaMs: number): number {
  const { source } = modulator;

  if (source.kind === 'audio') {
    const bands = readBands() ?? SILENT_BANDS;
    const raw = Math.min(1, bands[source.band ?? 'bass'] * (source.gain ?? 1));
    const previous = envelopes.get(modulator.id) ?? 0;
    // One-pole follower. Separate attack/release is what makes a kick punch
    // and then fall away rather than flicker at the frame rate.
    const timeMs =
      raw > previous ? (source.attack ?? 10) : (source.release ?? 220);
    const coefficient = timeMs <= 0 ? 1 : 1 - Math.exp(-deltaMs / timeMs);
    const next = previous + (raw - previous) * coefficient;
    envelopes.set(modulator.id, next);
    return next;
  }

  const cps = deps?.getCps() ?? null;
  const hz =
    source.cycles !== undefined
      ? source.cycles * (cps ?? FALLBACK_CPS)
      : (source.hz ?? 0.25);
  const previous = phases.get(modulator.id) ?? source.phase ?? 0;
  const raw = previous + (hz * deltaMs) / 1000;
  const phase = ((raw % 1) + 1) % 1;
  phases.set(modulator.id, phase);

  const shape = source.shape ?? 'sine';
  if (shape === 'random') {
    // Sample and hold: one new level per cycle, held flat until the phase
    // wraps. Stepped movement rather than the sweep every other shape gives.
    const held = holds.get(modulator.id);
    if (held && phase >= previous) return held.value;
    const value = Math.random() * 2 - 1;
    holds.set(modulator.id, { value });
    return value;
  }
  return shapeLfo(shape, phase);
}

function tick() {
  frame = null;
  const active = deps;
  if (!active || modulators.size === 0) {
    lastFrameAt = null;
    return;
  }

  const now = performance.now();
  // Clamped so a backgrounded tab resuming does not jump every LFO forward by
  // however long it was away.
  const deltaMs = Math.min(100, now - (lastFrameAt ?? now - 16));
  lastFrameAt = now;
  lastTickAt = now;

  const offsets = new Map<string, number>();
  for (const modulator of modulators.values()) {
    const shaped = advance(modulator, deltaMs);
    modulator.value = shaped;
    offsets.set(
      modulator.target,
      (offsets.get(modulator.target) ?? 0) + shaped * modulator.depth,
    );
  }

  for (const [target, offset] of offsets) {
    const centre = active.getCenter(target) ?? 0;
    let value = centre + offset;
    for (const modulator of modulators.values()) {
      if (modulator.target !== target) continue;
      if (modulator.min !== undefined) value = Math.max(modulator.min, value);
      if (modulator.max !== undefined) value = Math.min(modulator.max, value);
    }
    active.setTarget(target, value);
  }

  frame = requestAnimationFrame(tick);
}

function startLoop() {
  if (frame !== null) return;
  lastFrameAt = null;
  frame = requestAnimationFrame(tick);
}

function stopLoop() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  lastFrameAt = null;
}

/** Add or replace a modulator. Several may share a target; they sum. */
export function bind(spec: ModulatorSpec): Modulator {
  const id = spec.id ?? `mod${nextId++}`;
  const modulator: Modulator = { ...spec, id, value: 0 };
  modulators.set(id, modulator);
  phases.delete(id);
  envelopes.delete(id);
  holds.delete(id);
  startLoop();
  return modulator;
}

/**
 * Remove modulators by id or by target, and hand the target back to its
 * centre so it does not freeze at whatever the last modulated frame happened
 * to be — a stuck offset looks exactly like a broken preset.
 */
export function unbind(selector: { id?: string; target?: string }): string[] {
  const removed: string[] = [];
  const restore = new Set<string>();

  for (const [id, modulator] of [...modulators]) {
    const matches =
      (selector.id !== undefined && selector.id === id) ||
      (selector.target !== undefined && selector.target === modulator.target);
    if (!matches) continue;
    modulators.delete(id);
    phases.delete(id);
    envelopes.delete(id);
    holds.delete(id);
    removed.push(id);
    restore.add(modulator.target);
  }

  const active = deps;
  if (active) {
    for (const target of restore) {
      if ([...modulators.values()].some((m) => m.target === target)) continue;
      const centre = active.getCenter(target);
      if (centre !== undefined) active.setTarget(target, centre);
    }
  }

  if (modulators.size === 0) stopLoop();
  return removed;
}

export function unbindAll(): string[] {
  return [...modulators.keys()].flatMap((id) => unbind({ id }));
}

export function listModulators(): Modulator[] {
  return [...modulators.values()];
}

/** True while the rAF loop is scheduled — used by tests and diagnostics. */
export function isModulating(): boolean {
  return frame !== null;
}

export interface ModulationHealth {
  scheduled: boolean;
  count: number;
  msSinceTick: number | null;
  /**
   * Scheduled but not ticking. Modulation is frame-locked on purpose — when
   * nothing renders there is nothing to modulate — but a hidden tab suspends
   * rAF, so without this an agent would see "3 modulators active" and no
   * movement, with nothing to distinguish it from a depth that is too small.
   */
  stalled: boolean;
}

export function getModulationHealth(): ModulationHealth {
  const msSinceTick =
    lastTickAt === null ? null : Math.round(performance.now() - lastTickAt);
  return {
    scheduled: frame !== null,
    count: modulators.size,
    msSinceTick,
    stalled: modulators.size > 0 && (msSinceTick === null || msSinceTick > 500),
  };
}
