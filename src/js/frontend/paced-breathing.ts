/**
 * Paced breathing mode (#1625).
 *
 * Drives a slow LFO through the modulation engine so the picture swells on
 * the inhale and settles on the exhale. No sensor, no microphone: the guide
 * (bar + label) is the source of truth, and with motion at Still or OS
 * reduced motion the swell simply does not run while the guide still paces.
 *
 * The modulator is an offset on `zoom`, so it composes with whatever else
 * moves. Stopping removes the modulator and restores `zoom` to its centre.
 */

import {
  getActiveAccessibilityPreference,
  setAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import {
  bind,
  getModulatorPhase,
  listModulators,
  type ModulationDeps,
  unbind,
} from './live-modulation.ts';
import { connectWakeLock } from './wake-lock.ts';

export type BreathingShape = 'even' | 'longer-out';

export interface PacedBreathingOptions {
  /** Breaths per minute, clamped to 4.5..7. */
  rate: number;
  shape: BreathingShape;
  /** Session length in ms; null = open-ended. */
  lengthMs?: number | null;
  /** Called when the inhale/exhale turn changes. */
  onPhase?: (phase: 'in' | 'out') => void;
  /** Called when a timed session ends. */
  onComplete?: () => void;
}

const MOD_TARGET = 'zoom';
const MOD_DEPTH = 0.05;

let activeStop: (() => void) | null = null;

export function isPacedBreathingActive(): boolean {
  return activeStop !== null;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 6;
  return Math.min(7, Math.max(4.5, rate));
}

function shapeFor(shape: BreathingShape): 'sine' | 'longerOut' {
  return shape === 'longer-out' ? 'longerOut' : 'sine';
}

function dutyFor(shape: BreathingShape): number | undefined {
  return shape === 'longer-out' ? 0.4 : undefined;
}

export function startPacedBreathing(
  options: PacedBreathingOptions,
): () => void {
  stopPacedBreathing();

  const rate = clampRate(options.rate);
  const hz = rate / 60; // breaths per second
  const shape = shapeFor(options.shape);
  const duty = dutyFor(options.shape);

  const mod = bind({
    target: MOD_TARGET,
    depth: MOD_DEPTH,
    source: {
      kind: 'lfo',
      shape,
      hz,
      duty,
    },
  });

  const previousReduceFlashing =
    getActiveAccessibilityPreference().reduceFlashing;
  setAccessibilityPreference({ reduceFlashing: true });

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPhase: 'in' | 'out' | null = null;

  const wakeUnlock = connectWakeLock(() => !stopped);

  const pollPhase = () => {
    if (stopped) return;
    const phase = getModulatorPhase(mod.id);
    if (phase !== undefined) {
      const inhale =
        shape === 'longerOut' ? phase < (duty ?? 0.4) : phase < 0.5;
      const next: 'in' | 'out' = inhale ? 'in' : 'out';
      if (next !== lastPhase) {
        lastPhase = next;
        options.onPhase?.(next);
      }
    }
    if (!stopped) requestAnimationFrame(pollPhase);
  };
  requestAnimationFrame(pollPhase);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    wakeUnlock();
    unbind({ id: mod.id });
    setAccessibilityPreference({ reduceFlashing: previousReduceFlashing });
    activeStop = null;
    options.onComplete?.();
  };

  if (options.lengthMs && options.lengthMs > 0) {
    timer = setTimeout(stop, options.lengthMs);
  }

  activeStop = stop;
  return stop;
}

export function stopPacedBreathing(): void {
  if (activeStop) {
    const stop = activeStop;
    activeStop = null;
    stop();
  }
}

export function getPacedBreathingPhase(): 'in' | 'out' | null {
  // Best-effort: derive from the active modulator if any.
  const mods = listModulators().filter((m) => m.target === MOD_TARGET);
  if (mods.length === 0) return null;
  const phase = getModulatorPhase(mods[mods.length - 1].id);
  if (phase === undefined) return null;
  // Default to even split when shape unknown.
  return phase < 0.5 ? 'in' : 'out';
}

// Re-export for tests that need deps typing.
export type { ModulationDeps };
