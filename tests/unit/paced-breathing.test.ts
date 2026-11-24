import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getActiveAccessibilityPreference,
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import { getGuidedBreathing } from '../../src/js/core/services/guided-breathing.ts';
import {
  closeBreathingSetup,
  getBreathingSetupRequest,
  isPacedBreathingActive,
  openBreathingSetup,
  readBreatheParam,
  startPacedBreathing,
  stopPacedBreathing,
} from '../../src/js/frontend/paced-breathing.ts';

beforeEach(() => {
  localStorage.clear();
  resetAccessibilityPreferenceState();
});

afterEach(() => {
  stopPacedBreathing();
  closeBreathingSetup();
});

describe('paced breathing session', () => {
  test('turns Reduce flashing on for the session and back off after', () => {
    // On by default; this visitor turned it off.
    setAccessibilityPreference({ reduceFlashing: false });
    const stop = startPacedBreathing({
      rate: 6,
      shape: 'even',
      lengthMs: null,
    });
    expect(isPacedBreathingActive()).toBe(true);
    expect(getGuidedBreathing()?.breathsPerMinute).toBe(6);
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
    stop();
    expect(isPacedBreathingActive()).toBe(false);
    expect(getGuidedBreathing()).toBeNull();
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(false);
  });

  test('leaves a visitor who already reduces flashing as they were', () => {
    setAccessibilityPreference({ reduceFlashing: true });
    startPacedBreathing({ rate: 6, shape: 'even', lengthMs: null });
    stopPacedBreathing();
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
  });

  test('a timed session ends on its own', async () => {
    startPacedBreathing({ rate: 6, shape: 'longer-out', lengthMs: 30 });
    expect(isPacedBreathingActive()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(isPacedBreathingActive()).toBe(false);
    expect(getGuidedBreathing()).toBeNull();
  });

  test('starting again replaces the running session', () => {
    setAccessibilityPreference({ reduceFlashing: false });
    startPacedBreathing({ rate: 5, shape: 'even', lengthMs: null });
    startPacedBreathing({ rate: 7, shape: 'longer-out', lengthMs: null });
    expect(getGuidedBreathing()?.breathsPerMinute).toBe(7);
    stopPacedBreathing();
    expect(getGuidedBreathing()).toBeNull();
    expect(getActiveAccessibilityPreference().reduceFlashing).toBe(false);
  });
});

describe('breathing setup request', () => {
  test('opens with a clamped rate and closes', () => {
    openBreathingSetup({ rate: 9 });
    expect(getBreathingSetupRequest()).toEqual({ rate: 7 });
    closeBreathingSetup();
    expect(getBreathingSetupRequest()).toBeNull();
  });

  test('reads ?breathe= links', () => {
    expect(readBreatheParam('?breathe=5.5')).toBe(5.5);
    expect(readBreatheParam('?preset=x&breathe=6')).toBe(6);
    expect(readBreatheParam('?breathe=40')).toBe(7);
    expect(readBreatheParam('?breathe=abc')).toBeNull();
    expect(readBreatheParam('?preset=x')).toBeNull();
  });
});
