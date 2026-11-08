/**
 * Sensory translation layer for visual regulation dials.
 *
 * Exposes three physical dials:
 *  1. `overloadCeiling` (0.0 to 1.0, default 1.0): dynamically scales the maximum stage brightness
 *     ceiling, dampens rapid camera and field motion, and softens contrast swings.
 *  2. `predictability` (0.0 to 1.0, default 0.5): scales a low-pass filter on equation variable
 *     step jumps and attenuates random noise, promoting steady cyclic harmonic motion.
 *  3. `breathingCadenceSeconds` (number | null, selectable 4s - 12s, default null): generates a
 *     continuous sinusoidal LFO factor (0.02 * sin(2 * PI * t / T)) to subtly pace visual expansion
 *     with an adjustable breathing cadence.
 *
 * REGULATORY POSTURE (docs/SENSORY_ACCESSIBILITY.md#regulatory-posture):
 * Controls are strictly characterized in physical terms (e.g. "smooths rapid transitions",
 * "cycles visual pulse to a 6-second breathing rhythm"). Never make clinical, therapeutic,
 * or diagnostic claims.
 *
 * DOWNSTREAM SAFETY INVARIANT:
 * The live flash governor (`packages/flash-guard/`) enforces hard WCAG 2.3.1 general-flash
 * and red-flash safety limits. The sensory dials layer operates upstream and can NEVER bypass,
 * override, or raise luminance above the governor's active clamp.
 */

import { MIN_STAGE_BRIGHTNESS } from '../accessibility-preferences.ts';
import { readStored, writeStored } from '../state/browser-storage.ts';

export const SENSORY_MOOD_KNOBS_STORAGE_KEY = 'stims:sensory-mood-knobs';

export const DEFAULT_OVERLOAD_CEILING = 1.0;
export const DEFAULT_PREDICTABILITY = 0.5;
export const DEFAULT_BREATHING_CADENCE_SECONDS: number | null = null;

export const MIN_OVERLOAD_CEILING = 0.0;
export const MAX_OVERLOAD_CEILING = 1.0;

export const MIN_PREDICTABILITY = 0.0;
export const MAX_PREDICTABILITY = 1.0;

export const MIN_BREATHING_CADENCE_SECONDS = 4.0;
export const MAX_BREATHING_CADENCE_SECONDS = 12.0;

/** Default LFO amplitude for breathing expansion (2% modulation) */
export const DEFAULT_BREATHING_LFO_AMPLITUDE = 0.02;

/** Minimum contrast scale at full overload dampening (softens contrast without blacking out) */
export const MIN_CONTRAST_SCALE = 0.6;

/** Heavy filtering low-pass alpha when predictability is at maximum (1.0) */
export const MIN_SMOOTHING_ALPHA = 0.05;

export interface SensoryMoodKnobs {
  /**
   * Overload ceiling (0.0 to 1.0, default 1.0).
   * Dynamically scales stage brightness ceiling, motion dampener, and contrast swings.
   */
  overloadCeiling: number;

  /**
   * Predictability (0.0 to 1.0, default 0.5).
   * Scales a low-pass filter on equation step jumps and random noise,
   * promoting harmonic cyclic rhythm.
   */
  predictability: number;

  /**
   * Breathing cadence in seconds (null or 4.0 to 12.0, default null).
   * When set, generates a continuous sinusoidal LFO factor (0.02 * sin(2 * PI * t / T))
   * to subtly pace visual expansion with breathing.
   */
  breathingCadenceSeconds: number | null;
}

export const DEFAULT_SENSORY_MOOD_KNOBS: Readonly<SensoryMoodKnobs> =
  Object.freeze({
    overloadCeiling: DEFAULT_OVERLOAD_CEILING,
    predictability: DEFAULT_PREDICTABILITY,
    breathingCadenceSeconds: DEFAULT_BREATHING_CADENCE_SECONDS,
  });

export interface OverloadTranslation {
  /** Stage brightness ceiling (0.3 to 1.0) */
  brightnessCeiling: number;
  /** Motion dampener scale (0.0 to 1.0) */
  motionDampener: number;
  /** Contrast swing multiplier (0.6 to 1.0) */
  contrastShift: number;
}

export interface PredictabilityTranslation {
  /** Low-pass filter smoothing coefficient (0.05 to 1.0) */
  smoothingAlpha: number;
  /** Random noise attenuation multiplier (0.0 to 1.0) */
  noiseScale: number;
  /** Weight promoting harmonic periodic cycles (0.0 to 1.0) */
  harmonicBias: number;
}

export interface SensoryModulationFrame {
  /** Stage brightness ceiling derived from overload ceiling (0.3 to 1.0) */
  brightnessCeiling: number;
  /** Motion scale factor (0.0 to 1.0) */
  motionDampener: number;
  /** Contrast swing scale factor (0.6 to 1.0) */
  contrastShift: number;
  /** Filter smoothing coefficient for equation variables (0.05 to 1.0) */
  smoothingAlpha: number;
  /** Random noise scaling factor (0.0 to 1.0) */
  noiseScale: number;
  /** Harmonic cyclic bias weight (0.0 to 1.0) */
  harmonicBias: number;
  /** Continuous sinusoidal breathing expansion LFO (-0.02 to +0.02, or 0 if disabled) */
  breathingExpansionFactor: number;
  /** Composed stage brightness strictly respecting downstream flash governor clamp */
  effectiveBrightness: number;
}

export function clampOverloadCeiling(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_OVERLOAD_CEILING;
  }
  return Math.min(MAX_OVERLOAD_CEILING, Math.max(MIN_OVERLOAD_CEILING, value));
}

export function clampPredictability(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PREDICTABILITY;
  }
  return Math.min(MAX_PREDICTABILITY, Math.max(MIN_PREDICTABILITY, value));
}

export function clampBreathingCadence(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(
    MAX_BREATHING_CADENCE_SECONDS,
    Math.max(MIN_BREATHING_CADENCE_SECONDS, value),
  );
}

export function sanitizeSensoryMoodKnobs(raw: unknown): SensoryMoodKnobs {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SENSORY_MOOD_KNOBS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    overloadCeiling: clampOverloadCeiling(obj.overloadCeiling),
    predictability: clampPredictability(obj.predictability),
    breathingCadenceSeconds: clampBreathingCadence(obj.breathingCadenceSeconds),
  };
}

export function translateOverloadCeiling(
  overloadCeilingInput: unknown,
): OverloadTranslation {
  const overload = clampOverloadCeiling(overloadCeilingInput);
  const brightnessCeiling =
    MIN_STAGE_BRIGHTNESS + (1.0 - MIN_STAGE_BRIGHTNESS) * overload;
  const motionDampener = overload;
  const contrastShift =
    MIN_CONTRAST_SCALE + (1.0 - MIN_CONTRAST_SCALE) * overload;

  return {
    brightnessCeiling,
    motionDampener,
    contrastShift,
  };
}

export function translatePredictability(
  predictabilityInput: unknown,
): PredictabilityTranslation {
  const pred = clampPredictability(predictabilityInput);
  // At predictability=0 (raw step jumps allowed), alpha=1.0 (instant response).
  // At predictability=1 (maximum smoothing), alpha=MIN_SMOOTHING_ALPHA (0.05).
  const smoothingAlpha =
    MIN_SMOOTHING_ALPHA + (1.0 - MIN_SMOOTHING_ALPHA) * (1.0 - pred);
  // At predictability=1, random noise is fully attenuated (0.0) in favor of cyclic harmonic rhythm.
  const noiseScale = 1.0 - pred;
  const harmonicBias = pred;

  return {
    smoothingAlpha,
    noiseScale,
    harmonicBias,
  };
}

export function applyPredictabilityFilter(
  previousValue: number,
  targetValue: number,
  predictability: unknown,
): number {
  if (!Number.isFinite(previousValue)) return targetValue;
  if (!Number.isFinite(targetValue)) return previousValue;
  const { smoothingAlpha } = translatePredictability(predictability);
  return previousValue + smoothingAlpha * (targetValue - previousValue);
}

export function calculateBreathingLFO(
  timeSeconds: number,
  cadenceSecondsInput: unknown,
  amplitude: number = DEFAULT_BREATHING_LFO_AMPLITUDE,
): number {
  const cadence = clampBreathingCadence(cadenceSecondsInput);
  if (cadence === null || cadence <= 0) {
    return 0;
  }
  if (typeof timeSeconds !== 'number' || !Number.isFinite(timeSeconds)) {
    return 0;
  }
  const safeAmp =
    typeof amplitude === 'number' && Number.isFinite(amplitude)
      ? amplitude
      : DEFAULT_BREATHING_LFO_AMPLITUDE;

  return safeAmp * Math.sin((2 * Math.PI * timeSeconds) / cadence);
}

/**
 * Composes stage brightness ceiling with downstream flash governor clamp.
 *
 * DOWNSTREAM SAFETY INVARIANT:
 * The flash governor (packages/flash-guard/) enforces WCAG 2.3.1 and broadcast safety standards.
 * The governor scale is multiplicative and strictly bounds effective stage brightness.
 * This function guarantees that sensory brightness can never bypass or elevate above the governor clamp.
 */
export function composeBrightnessWithGovernor(
  sensoryBrightness: number,
  governorScale: number = 1.0,
): number {
  const safeSensory = Number.isFinite(sensoryBrightness)
    ? Math.min(1.0, Math.max(0.0, sensoryBrightness))
    : 1.0;
  const safeGovernor = Number.isFinite(governorScale)
    ? Math.min(1.0, Math.max(0.0, governorScale))
    : 1.0;

  const multiplied = safeSensory * safeGovernor;
  // Invariant guarantee: cannot exceed governor scale
  return Math.min(multiplied, safeGovernor);
}

export function verifyFlashGovernorInvariant(
  effectiveBrightness: number,
  governorScale: number,
): boolean {
  return effectiveBrightness <= governorScale + 1e-9;
}

export type SensoryMoodSubscriber = (knobs: SensoryMoodKnobs) => void;

export class SensoryTranslationService {
  private knobs: SensoryMoodKnobs;
  private readonly subscribers = new Set<SensoryMoodSubscriber>();

  constructor(initialKnobs?: Partial<SensoryMoodKnobs>) {
    this.knobs = this.loadInitialKnobs(initialKnobs);
  }

  private loadInitialKnobs(
    override?: Partial<SensoryMoodKnobs>,
  ): SensoryMoodKnobs {
    if (override) {
      return sanitizeSensoryMoodKnobs(override);
    }
    const stored = readStored(SENSORY_MOOD_KNOBS_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return sanitizeSensoryMoodKnobs(parsed);
      } catch {
        // Fall back to defaults on corrupt storage
      }
    }
    return { ...DEFAULT_SENSORY_MOOD_KNOBS };
  }

  getKnobs(): SensoryMoodKnobs {
    return { ...this.knobs };
  }

  setKnobs(partial: Partial<SensoryMoodKnobs>): SensoryMoodKnobs {
    const next: SensoryMoodKnobs = {
      overloadCeiling:
        partial.overloadCeiling !== undefined
          ? clampOverloadCeiling(partial.overloadCeiling)
          : this.knobs.overloadCeiling,
      predictability:
        partial.predictability !== undefined
          ? clampPredictability(partial.predictability)
          : this.knobs.predictability,
      breathingCadenceSeconds:
        partial.breathingCadenceSeconds !== undefined
          ? clampBreathingCadence(partial.breathingCadenceSeconds)
          : this.knobs.breathingCadenceSeconds,
    };

    if (
      next.overloadCeiling === this.knobs.overloadCeiling &&
      next.predictability === this.knobs.predictability &&
      next.breathingCadenceSeconds === this.knobs.breathingCadenceSeconds
    ) {
      return this.knobs;
    }

    this.knobs = next;
    writeStored(SENSORY_MOOD_KNOBS_STORAGE_KEY, JSON.stringify(next));
    this.notifySubscribers();
    return this.knobs;
  }

  resetKnobs(): SensoryMoodKnobs {
    return this.setKnobs(DEFAULT_SENSORY_MOOD_KNOBS);
  }

  subscribe(subscriber: SensoryMoodSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notifySubscribers(): void {
    for (const sub of this.subscribers) {
      sub({ ...this.knobs });
    }
  }

  /**
   * Translates the active dials into physical rendering parameters for a frame at `timeSeconds`.
   * Enforces downstream flash governor invariant.
   */
  translate(
    timeSeconds: number,
    governorScale: number = 1.0,
  ): SensoryModulationFrame {
    const overload = translateOverloadCeiling(this.knobs.overloadCeiling);
    const pred = translatePredictability(this.knobs.predictability);
    const breathingExpansionFactor = calculateBreathingLFO(
      timeSeconds,
      this.knobs.breathingCadenceSeconds,
    );
    const effectiveBrightness = composeBrightnessWithGovernor(
      overload.brightnessCeiling,
      governorScale,
    );

    return {
      brightnessCeiling: overload.brightnessCeiling,
      motionDampener: overload.motionDampener,
      contrastShift: overload.contrastShift,
      smoothingAlpha: pred.smoothingAlpha,
      noiseScale: pred.noiseScale,
      harmonicBias: pred.harmonicBias,
      breathingExpansionFactor,
      effectiveBrightness,
    };
  }

  filterStep(previous: number, current: number): number {
    return applyPredictabilityFilter(
      previous,
      current,
      this.knobs.predictability,
    );
  }

  getLFO(timeSeconds: number): number {
    return calculateBreathingLFO(
      timeSeconds,
      this.knobs.breathingCadenceSeconds,
    );
  }
}

let globalService: SensoryTranslationService | null = null;

export function getSensoryTranslationService(): SensoryTranslationService {
  if (!globalService) {
    globalService = new SensoryTranslationService();
  }
  return globalService;
}

export function getSensoryMoodKnobs(): SensoryMoodKnobs {
  return getSensoryTranslationService().getKnobs();
}

export function setSensoryMoodKnobs(
  partial: Partial<SensoryMoodKnobs>,
): SensoryMoodKnobs {
  return getSensoryTranslationService().setKnobs(partial);
}

export function resetSensoryMoodKnobs(): SensoryMoodKnobs {
  return getSensoryTranslationService().resetKnobs();
}

export function subscribeToSensoryMoodKnobs(
  listener: SensoryMoodSubscriber,
): () => void {
  return getSensoryTranslationService().subscribe(listener);
}

export function resetSensoryTranslationServiceStateForTests(
  initial?: Partial<SensoryMoodKnobs>,
): void {
  globalService = new SensoryTranslationService(initial);
}

/**
 * Convenience: current sensory motion dampener (0.0–1.0) derived from the
 * overload ceiling dial. Composes multiplicatively with the accessibility
 * motion scale.
 */
export function getSensoryMotionDampener(): number {
  return getSensoryTranslationService().translate(0, 1.0).motionDampener;
}

/**
 * Convenience: current sensory brightness ceiling (0.3–1.0) derived from the
 * overload ceiling dial. Composes multiplicatively with the accessibility
 * brightness ceiling via the 'sensory' stage-luminance channel.
 */
export function getSensoryBrightnessCeiling(): number {
  return getSensoryTranslationService().translate(0, 1.0).brightnessCeiling;
}
