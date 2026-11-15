/**
 * Autonomous live-VJ co-performer (#1676) — bounded core.
 *
 * Hierarchical dual-horizon controller:
 * - Macro (15-30s): pick next scene/preset from a candidate list, schedule a
 *   crossfade via the supplied callback.
 * - Micro (50-200ms): apply transient param nudges (warp pulse, decay duck).
 *
 * Manual input (MIDI slider, mouse drag, keyboard) triggers a 15s stand-down
 * during which autonomous overrides yield; they resume after inactivity.
 *
 * Strudel beat events are accepted via `noteBeat(voice)` and forwarded to a
 * callback so the host can write q1..q8 trigger registers.
 */

export interface LiveVJOptions {
  /** Clock function for stand-down timing (defaults to Date.now). */
  now?: () => number;
  /** Candidate scene/preset ids. */
  candidates: string[];
  /** Macro horizon in ms. */
  macroIntervalMs?: number;
  /** Micro horizon in ms. */
  microIntervalMs?: number;
  /** Stand-down duration after manual input, ms. */
  standDownMs?: number;
  /** Called to schedule a crossfade to the chosen candidate. */
  onSceneChange?: (candidate: string) => void;
  /** Called on micro ticks with a transient nudge hint. */
  onMicroNudge?: (hint: { warpPulse: boolean; decayDuck: boolean }) => void;
  /** Called when a Strudel beat event arrives. */
  onBeat?: (voice: string) => void;
  /** Decision function: returns index into candidates. Defaults to round-robin. */
  choose?: (candidates: string[], last: string | null) => number;
}

export class AutonomousVJController {
  private candidates: string[];
  private macroIntervalMs: number;
  private microIntervalMs: number;
  private standDownMs: number;
  private onSceneChange?: (c: string) => void;
  private onMicroNudge?: (h: {
    warpPulse: boolean;
    decayDuck: boolean;
  }) => void;
  private onBeat?: (v: string) => void;
  private choose: (c: string[], last: string | null) => number;

  private macroTimer: ReturnType<typeof setInterval> | null = null;
  private microTimer: ReturnType<typeof setInterval> | null = null;
  private lastManualAt = 0;
  private lastScene: string | null = null;
  private running = false;
  private now: () => number;

  constructor(options: LiveVJOptions) {
    this.now = options.now ?? (() => Date.now());
    this.candidates = [...options.candidates];
    this.macroIntervalMs = options.macroIntervalMs ?? 20000;
    this.microIntervalMs = options.microIntervalMs ?? 100;
    this.standDownMs = options.standDownMs ?? 15000;
    this.onSceneChange = options.onSceneChange;
    this.onMicroNudge = options.onMicroNudge;
    this.onBeat = options.onBeat;
    this.choose =
      options.choose ??
      ((c, last) => {
        if (c.length === 0) return -1;
        const idx = last ? c.indexOf(last) : -1;
        return (idx + 1) % c.length;
      });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.macroTimer = setInterval(() => this.macroTick(), this.macroIntervalMs);
    this.microTimer = setInterval(() => this.microTick(), this.microIntervalMs);
  }

  stop() {
    this.running = false;
    if (this.macroTimer) {
      clearInterval(this.macroTimer);
      this.macroTimer = null;
    }
    if (this.microTimer) {
      clearInterval(this.microTimer);
      this.microTimer = null;
    }
  }

  isRunning() {
    return this.running;
  }

  /** Call on any manual input. Suspends autonomous overrides for standDownMs. */
  noteManualInput() {
    this.lastManualAt = this.now();
  }

  isInStandDown(now?: number): boolean {
    const t = now ?? this.now();
    return t - this.lastManualAt < this.standDownMs;
  }

  noteBeat(voice: string) {
    this.onBeat?.(voice);
  }

  private macroTick() {
    if (this.isInStandDown()) return;
    if (this.candidates.length === 0) return;
    const idx = this.choose(this.candidates, this.lastScene);
    if (idx < 0) return;
    const next = this.candidates[idx];
    this.lastScene = next;
    this.onSceneChange?.(next);
  }

  private microTick() {
    if (this.isInStandDown()) return;
    // Transient nudge hint; host decides actual param writes.
    this.onMicroNudge?.({ warpPulse: false, decayDuck: false });
  }

  // Test helpers
  _macroTick() {
    this.macroTick();
  }
  _microTick() {
    this.microTick();
  }
}

export function createAutonomousVJController(options: LiveVJOptions) {
  return new AutonomousVJController(options);
}
