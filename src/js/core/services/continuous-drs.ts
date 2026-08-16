/**
 * Continuous PID (Proportional-Integral-Derivative) Dynamic Resolution Scaling (DRS) Controller.
 *
 * Provides smooth, analog resolution scaling that continuously converges to the exact
 * optimal render scale needed to maintain target framerates, eliminating the discrete
 * step-hunting and sudden visual jumps of static quality tiers.
 */

export type ContinuousDrsOptions = {
  /** Target frame budget in milliseconds (e.g. 16.67 for 60Hz, 8.33 for 120Hz). */
  targetFrameBudgetMs: number;
  /** Minimum allowable render scale (default: 0.65). */
  minScale?: number;
  /** Maximum allowable render scale (default: 1.0). */
  maxScale?: number;
  /** Proportional gain (default: 0.08). */
  kp?: number;
  /** Integral gain (default: 0.01). */
  ki?: number;
  /** Derivative gain (default: 0.02). */
  kd?: number;
  /** Deadband ratio around target budget where scale is kept steady (default: 0.04 = ±4%). */
  deadbandRatio?: number;
};

export type ContinuousDrsState = {
  scale: number;
  targetBudgetMs: number;
  lastError: number;
  integral: number;
  isStable: boolean;
};

export type ContinuousDrsController = {
  /**
   * Update the DRS controller with the latest measured frame time and return the new render scale.
   *
   * @param frameMs - The measured frame time in milliseconds.
   * @returns The updated continuous render scale clamped between minScale and maxScale.
   */
  update: (frameMs: number) => number;

  /** Get the current DRS controller state. */
  getState: () => ContinuousDrsState;

  /** Set the target frame budget (e.g. when display refresh rate changes). */
  setTargetBudgetMs: (budgetMs: number) => void;

  /** Reset the controller state (e.g. on preset change). */
  reset: (initialScale?: number) => void;
};

export function createContinuousDrsController(
  options: ContinuousDrsOptions,
): ContinuousDrsController {
  let targetBudgetMs = options.targetFrameBudgetMs;
  const minScale = options.minScale ?? 0.65;
  const maxScale = options.maxScale ?? 1.0;
  const kp = options.kp ?? 0.08;
  const ki = options.ki ?? 0.01;
  const kd = options.kd ?? 0.02;
  const deadbandRatio = options.deadbandRatio ?? 0.04;

  let scale = maxScale;
  let integral = 0;
  let previousError = 0;
  let isStable = true;

  const clamp = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val));

  return {
    update(frameMs: number): number {
      if (!Number.isFinite(frameMs) || frameMs <= 0) {
        return scale;
      }

      // Error is normalized relative to target budget (positive = under budget, negative = over budget)
      const error = (targetBudgetMs - frameMs) / targetBudgetMs;

      // Deadband: small fluctuations around budget do not alter scale
      if (Math.abs(error) < deadbandRatio) {
        isStable = true;
        // Slowly decay integral during steady state
        integral *= 0.95;
        return scale;
      }

      isStable = false;

      // Anti-windup: clamp integral accumulation
      integral = clamp(integral + error, -2.0, 2.0);
      const derivative = error - previousError;
      previousError = error;

      const adjustment = kp * error + ki * integral + kd * derivative;
      scale = clamp(scale + adjustment, minScale, maxScale);

      return scale;
    },

    getState(): ContinuousDrsState {
      return {
        scale,
        targetBudgetMs,
        lastError: previousError,
        integral,
        isStable,
      };
    },

    setTargetBudgetMs(budgetMs: number): void {
      if (Number.isFinite(budgetMs) && budgetMs > 0) {
        targetBudgetMs = budgetMs;
      }
    },

    reset(initialScale = maxScale): void {
      scale = clamp(initialScale, minScale, maxScale);
      integral = 0;
      previousError = 0;
      isStable = true;
    },
  };
}
