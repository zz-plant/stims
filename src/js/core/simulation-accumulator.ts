/**
 * Fixed-step simulation accumulator for deterministic physics, animation,
 * and mathematical differential equations.
 *
 * Decouples the equation simulation tick rate (e.g. 60Hz) from the display's
 * presentation refresh rate (30Hz, 120Hz, 144Hz, 240Hz), ensuring equations
 * and audio reactivity animate at the exact intended tempo regardless of display.
 */

export type SimulationAccumulator = {
  /**
   * Advance time and execute the step callback for every fixed simulation quantum.
   *
   * @param frameDeltaSec - Elapsed real time since last frame in seconds.
   * @param stepCallback - Called once per fixed simulation quantum (e.g. 1/60s).
   * @returns The interpolation alpha between previous and current simulation state (0.0 to 1.0).
   */
  advance: (
    frameDeltaSec: number,
    stepCallback: (dtSec: number) => void,
  ) => number;

  /** Reset the accumulator (e.g. on preset switch or tab resume). */
  reset: () => void;

  /** The fixed simulation quantum in seconds (e.g. 1/60 = 0.016667s). */
  readonly fixedDtSec: number;
};

export type SimulationAccumulatorOptions = {
  /** Simulation rate in Hz (default: 60). */
  targetHz?: number;
  /** Maximum number of sub-steps per frame to prevent the "spiral of death" during long pauses (default: 5). */
  maxSubSteps?: number;
};

export function createSimulationAccumulator(
  options: SimulationAccumulatorOptions = {},
): SimulationAccumulator {
  const targetHz = options.targetHz ?? 60;
  const fixedDtSec = 1 / targetHz;
  const maxSubSteps = options.maxSubSteps ?? 5;
  const maxFrameDeltaSec = fixedDtSec * maxSubSteps;

  let accumulatedSec = 0;

  return {
    fixedDtSec,

    advance(
      frameDeltaSec: number,
      stepCallback: (dtSec: number) => void,
    ): number {
      if (!Number.isFinite(frameDeltaSec) || frameDeltaSec <= 0) {
        return 0;
      }

      // Clamp max delta to avoid spiral-of-death when returning from background tabs or long pauses
      const clampedDeltaSec = Math.min(frameDeltaSec, maxFrameDeltaSec);
      accumulatedSec += clampedDeltaSec;

      let steps = 0;
      while (accumulatedSec >= fixedDtSec && steps < maxSubSteps) {
        stepCallback(fixedDtSec);
        accumulatedSec -= fixedDtSec;
        steps += 1;
      }

      // If still lagging behind max sub-steps, flush remaining accumulated time
      if (accumulatedSec >= fixedDtSec) {
        accumulatedSec = 0;
      }

      // Alpha is the fractional progress towards the next fixed step (useful for visual interpolation)
      return accumulatedSec / fixedDtSec;
    },

    reset(): void {
      accumulatedSec = 0;
    },
  };
}
