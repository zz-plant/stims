import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { MIN_STAGE_BRIGHTNESS } from '../../src/js/core/accessibility-preferences.ts';
import {
  applyPredictabilityFilter,
  calculateBreathingLFO,
  clampBreathingCadence,
  clampOverloadCeiling,
  clampPredictability,
  composeBrightnessWithGovernor,
  DEFAULT_BREATHING_LFO_AMPLITUDE,
  DEFAULT_OVERLOAD_CEILING,
  DEFAULT_PREDICTABILITY,
  DEFAULT_SENSORY_MOOD_KNOBS,
  getSensoryMoodKnobs,
  MAX_BREATHING_CADENCE_SECONDS,
  MAX_OVERLOAD_CEILING,
  MAX_PREDICTABILITY,
  MIN_BREATHING_CADENCE_SECONDS,
  MIN_CONTRAST_SCALE,
  MIN_OVERLOAD_CEILING,
  MIN_PREDICTABILITY,
  MIN_SMOOTHING_ALPHA,
  resetSensoryMoodKnobs,
  resetSensoryTranslationServiceStateForTests,
  SENSORY_MOOD_KNOBS_STORAGE_KEY,
  SensoryTranslationService,
  sanitizeSensoryMoodKnobs,
  setSensoryMoodKnobs,
  subscribeToSensoryMoodKnobs,
  translateOverloadCeiling,
  translatePredictability,
  verifyFlashGovernorInvariant,
} from '../../src/js/core/services/sensory-translation.ts';

beforeEach(() => {
  localStorage.clear();
  resetSensoryTranslationServiceStateForTests();
});

afterAll(() => {
  localStorage.clear();
  resetSensoryTranslationServiceStateForTests();
});

describe('Sensory translation: clamping & sanitization', () => {
  test('clampOverloadCeiling enforces [0.0, 1.0] and handles invalid inputs', () => {
    expect(clampOverloadCeiling(0)).toBe(MIN_OVERLOAD_CEILING);
    expect(clampOverloadCeiling(0.7)).toBe(0.7);
    expect(clampOverloadCeiling(1.0)).toBe(MAX_OVERLOAD_CEILING);

    // Below min / above max
    expect(clampOverloadCeiling(-0.5)).toBe(MIN_OVERLOAD_CEILING);
    expect(clampOverloadCeiling(1.5)).toBe(MAX_OVERLOAD_CEILING);

    // Non-finite or invalid
    expect(clampOverloadCeiling(Number.NaN)).toBe(DEFAULT_OVERLOAD_CEILING);
    expect(clampOverloadCeiling(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_OVERLOAD_CEILING,
    );
    expect(clampOverloadCeiling('0.8')).toBe(DEFAULT_OVERLOAD_CEILING);
    expect(clampOverloadCeiling(null)).toBe(DEFAULT_OVERLOAD_CEILING);
    expect(clampOverloadCeiling(undefined)).toBe(DEFAULT_OVERLOAD_CEILING);
  });

  test('clampPredictability enforces [0.0, 1.0] and handles invalid inputs', () => {
    expect(clampPredictability(0)).toBe(MIN_PREDICTABILITY);
    expect(clampPredictability(0.42)).toBe(0.42);
    expect(clampPredictability(1)).toBe(MAX_PREDICTABILITY);

    // Below min / above max
    expect(clampPredictability(-10)).toBe(MIN_PREDICTABILITY);
    expect(clampPredictability(2.5)).toBe(MAX_PREDICTABILITY);

    // Non-finite or invalid
    expect(clampPredictability(Number.NaN)).toBe(DEFAULT_PREDICTABILITY);
    expect(clampPredictability('0.5')).toBe(DEFAULT_PREDICTABILITY);
    expect(clampPredictability(null)).toBe(DEFAULT_PREDICTABILITY);
    expect(clampPredictability(undefined)).toBe(DEFAULT_PREDICTABILITY);
  });

  test('clampBreathingCadence enforces null or [4.0, 12.0]', () => {
    expect(clampBreathingCadence(null)).toBeNull();
    expect(clampBreathingCadence(undefined)).toBeNull();

    // Valid range
    expect(clampBreathingCadence(4.0)).toBe(MIN_BREATHING_CADENCE_SECONDS);
    expect(clampBreathingCadence(6.5)).toBe(6.5);
    expect(clampBreathingCadence(12.0)).toBe(MAX_BREATHING_CADENCE_SECONDS);

    // Clamping to bounds
    expect(clampBreathingCadence(1.0)).toBe(MIN_BREATHING_CADENCE_SECONDS);
    expect(clampBreathingCadence(18.0)).toBe(MAX_BREATHING_CADENCE_SECONDS);

    // Invalid non-numbers
    expect(clampBreathingCadence('6')).toBeNull();
    expect(clampBreathingCadence(Number.NaN)).toBeNull();
    expect(clampBreathingCadence({})).toBeNull();
  });

  test('sanitizeSensoryMoodKnobs validates full object safely', () => {
    expect(sanitizeSensoryMoodKnobs(null)).toEqual(DEFAULT_SENSORY_MOOD_KNOBS);
    expect(sanitizeSensoryMoodKnobs('invalid')).toEqual(
      DEFAULT_SENSORY_MOOD_KNOBS,
    );

    const sanitized = sanitizeSensoryMoodKnobs({
      overloadCeiling: 2.0,
      predictability: -1.0,
      breathingCadenceSeconds: 20,
    });
    expect(sanitized).toEqual({
      overloadCeiling: 1.0,
      predictability: 0.0,
      breathingCadenceSeconds: 12.0,
    });
  });
});

describe('Sensory translation: mathematical translation', () => {
  test('translateOverloadCeiling maps overload ceiling to brightness, motion, and contrast', () => {
    // Default / full setting (1.0)
    const full = translateOverloadCeiling(1.0);
    expect(full.brightnessCeiling).toBe(1.0);
    expect(full.motionDampener).toBe(1.0);
    expect(full.contrastShift).toBe(1.0);

    // Maximum dampening setting (0.0)
    const zero = translateOverloadCeiling(0.0);
    expect(zero.brightnessCeiling).toBe(MIN_STAGE_BRIGHTNESS);
    expect(zero.motionDampener).toBe(0.0);
    expect(zero.contrastShift).toBe(MIN_CONTRAST_SCALE);

    // Mid setting (0.5)
    const mid = translateOverloadCeiling(0.5);
    expect(mid.brightnessCeiling).toBeCloseTo(0.3 + 0.7 * 0.5, 6);
    expect(mid.motionDampener).toBe(0.5);
    expect(mid.contrastShift).toBeCloseTo(0.6 + 0.4 * 0.5, 6);
  });

  test('translatePredictability scales low-pass alpha, noise attenuation, and harmonic bias', () => {
    // Zero predictability (raw rapid step jumps allowed)
    const low = translatePredictability(0.0);
    expect(low.smoothingAlpha).toBe(1.0); // instant response, no low-pass lag
    expect(low.noiseScale).toBe(1.0); // full random noise
    expect(low.harmonicBias).toBe(0.0);

    // Maximum predictability (1.0) (heavy smoothing, cyclic rhythm)
    const high = translatePredictability(1.0);
    expect(high.smoothingAlpha).toBe(MIN_SMOOTHING_ALPHA); // heavy low-pass filtering
    expect(high.noiseScale).toBe(0.0); // noise fully suppressed
    expect(high.harmonicBias).toBe(1.0); // maximum periodic bias

    // Mid setting (0.5)
    const mid = translatePredictability(0.5);
    expect(mid.smoothingAlpha).toBeCloseTo(1.0 - 0.95 * 0.5, 6);
    expect(mid.noiseScale).toBe(0.5);
    expect(mid.harmonicBias).toBe(0.5);
  });

  test('applyPredictabilityFilter dampens step jumps according to predictability', () => {
    // With predictability = 0.0 (alpha = 1.0), jump from 10 to 20 is instantaneous
    expect(applyPredictabilityFilter(10, 20, 0.0)).toBe(20);

    // With predictability = 1.0 (alpha = 0.05), jump is heavily smoothed
    const filteredHigh = applyPredictabilityFilter(10, 20, 1.0);
    expect(filteredHigh).toBeCloseTo(10 + 0.05 * 10, 6);

    // Handles non-finite inputs gracefully
    expect(applyPredictabilityFilter(Number.NaN, 20, 0.5)).toBe(20);
    expect(applyPredictabilityFilter(10, Number.NaN, 0.5)).toBe(10);
  });

  test('calculateBreathingLFO produces exact continuous sinusoidal expansion', () => {
    // Inactive when cadence is null
    expect(calculateBreathingLFO(0, null)).toBe(0);
    expect(calculateBreathingLFO(5.5, null)).toBe(0);

    // Inactive when time is invalid
    expect(calculateBreathingLFO(Number.NaN, 6.0)).toBe(0);

    const cadence = 6.0; // 6-second breathing cycle
    const amp = DEFAULT_BREATHING_LFO_AMPLITUDE; // 0.02

    // t = 0 -> sin(0) = 0
    expect(calculateBreathingLFO(0, cadence)).toBeCloseTo(0, 6);

    // t = 1.5s (T/4) -> peak expansion +0.02
    expect(calculateBreathingLFO(1.5, cadence)).toBeCloseTo(amp, 6);

    // t = 3.0s (T/2) -> return to baseline 0
    expect(calculateBreathingLFO(3.0, cadence)).toBeCloseTo(0, 6);

    // t = 4.5s (3T/4) -> peak contraction -0.02
    expect(calculateBreathingLFO(4.5, cadence)).toBeCloseTo(-amp, 6);

    // t = 6.0s (T) -> full cycle return to 0
    expect(calculateBreathingLFO(6.0, cadence)).toBeCloseTo(0, 6);

    // Periodicity check: f(t) == f(t + T)
    const val1 = calculateBreathingLFO(1.23, cadence);
    const val2 = calculateBreathingLFO(1.23 + cadence, cadence);
    expect(val1).toBeCloseTo(val2, 6);

    // Custom amplitude support
    const customAmp = 0.05;
    expect(calculateBreathingLFO(1.5, cadence, customAmp)).toBeCloseTo(
      customAmp,
      6,
    );
  });
});

describe('Sensory translation: downstream flash governor safety invariant', () => {
  test('composeBrightnessWithGovernor strictly respects governor clamp', () => {
    // Normal case without governor dimming (governor = 1.0)
    expect(composeBrightnessWithGovernor(1.0, 1.0)).toBe(1.0);
    expect(composeBrightnessWithGovernor(0.5, 1.0)).toBe(0.5);

    // Governor active dimming to 0.40
    const dimmed = composeBrightnessWithGovernor(1.0, 0.4);
    expect(dimmed).toBe(0.4); // Cannot exceed governor scale
    expect(verifyFlashGovernorInvariant(dimmed, 0.4)).toBe(true);

    // Both dials dimmed: sensory ceiling 0.5 * governor 0.4 = 0.20
    const doubleDimmed = composeBrightnessWithGovernor(0.5, 0.4);
    expect(doubleDimmed).toBeCloseTo(0.2, 6);
    expect(verifyFlashGovernorInvariant(doubleDimmed, 0.4)).toBe(true);

    // Governor blackout (0.0) -> effective brightness is 0.0
    expect(composeBrightnessWithGovernor(1.0, 0.0)).toBe(0.0);
    expect(composeBrightnessWithGovernor(0.0, 1.0)).toBe(0.0);
  });

  test('governor scale strictly bounds effective brightness across all value combinations', () => {
    const testValues = [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    for (const sensory of testValues) {
      for (const governor of testValues) {
        const effective = composeBrightnessWithGovernor(sensory, governor);
        expect(effective).toBeLessThanOrEqual(governor + 1e-9);
        expect(effective).toBeLessThanOrEqual(sensory + 1e-9);
        expect(verifyFlashGovernorInvariant(effective, governor)).toBe(true);
      }
    }
  });
});

describe('Sensory translation: service & subscription lifecycle', () => {
  test('initializes with default values and translates frames', () => {
    const service = new SensoryTranslationService();
    expect(service.getKnobs()).toEqual(DEFAULT_SENSORY_MOOD_KNOBS);

    const frame = service.translate(0, 1.0);
    expect(frame.brightnessCeiling).toBe(1.0);
    expect(frame.motionDampener).toBe(1.0);
    expect(frame.contrastShift).toBe(1.0);
    expect(frame.smoothingAlpha).toBeCloseTo(1.0 - 0.95 * 0.5, 6);
    expect(frame.noiseScale).toBe(0.5);
    expect(frame.harmonicBias).toBe(0.5);
    expect(frame.breathingExpansionFactor).toBe(0);
    expect(frame.effectiveBrightness).toBe(1.0);
  });

  test('setKnobs updates state, notifies subscribers, and persists to storage', () => {
    const service = new SensoryTranslationService();
    let notifiedKnobs: unknown = null;

    const unsubscribe = service.subscribe((knobs) => {
      notifiedKnobs = knobs;
    });

    service.setKnobs({
      overloadCeiling: 0.6,
      predictability: 0.8,
      breathingCadenceSeconds: 8.0,
    });

    expect(service.getKnobs()).toEqual({
      overloadCeiling: 0.6,
      predictability: 0.8,
      breathingCadenceSeconds: 8.0,
    });
    expect(notifiedKnobs).toEqual({
      overloadCeiling: 0.6,
      predictability: 0.8,
      breathingCadenceSeconds: 8.0,
    });

    // Check storage persistence
    const stored = localStorage.getItem(SENSORY_MOOD_KNOBS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed.overloadCeiling).toBe(0.6);
    expect(parsed.predictability).toBe(0.8);
    expect(parsed.breathingCadenceSeconds).toBe(8.0);

    // Unsubscribe verification
    unsubscribe();
    notifiedKnobs = null;
    service.setKnobs({ overloadCeiling: 0.2 });
    expect(notifiedKnobs).toBeNull();
  });

  test('resetKnobs restores defaults and notifies subscribers', () => {
    const service = new SensoryTranslationService();
    service.setKnobs({
      overloadCeiling: 0.3,
      predictability: 0.1,
      breathingCadenceSeconds: 4.0,
    });

    const reset = service.resetKnobs();
    expect(reset).toEqual(DEFAULT_SENSORY_MOOD_KNOBS);
    expect(service.getKnobs()).toEqual(DEFAULT_SENSORY_MOOD_KNOBS);
  });

  test('singleton exports coordinate through shared service', () => {
    expect(getSensoryMoodKnobs()).toEqual(DEFAULT_SENSORY_MOOD_KNOBS);

    let observed: unknown = null;
    const unsub = subscribeToSensoryMoodKnobs((k) => {
      observed = k;
    });

    setSensoryMoodKnobs({
      overloadCeiling: 0.75,
      breathingCadenceSeconds: 6.0,
    });

    expect(getSensoryMoodKnobs().overloadCeiling).toBe(0.75);
    expect(getSensoryMoodKnobs().breathingCadenceSeconds).toBe(6.0);
    expect((observed as { overloadCeiling?: number })?.overloadCeiling).toBe(
      0.75,
    );

    resetSensoryMoodKnobs();
    expect(getSensoryMoodKnobs()).toEqual(DEFAULT_SENSORY_MOOD_KNOBS);
    unsub();
  });

  test('service reloads persisted values across instances', () => {
    const s1 = new SensoryTranslationService();
    s1.setKnobs({ overloadCeiling: 0.45, predictability: 0.85 });

    // New instance loads from localStorage
    const s2 = new SensoryTranslationService();
    expect(s2.getKnobs().overloadCeiling).toBe(0.45);
    expect(s2.getKnobs().predictability).toBe(0.85);
  });
});
