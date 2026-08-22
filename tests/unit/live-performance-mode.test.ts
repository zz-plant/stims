import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  getLivePerformanceMode,
  isLivePerformanceModeActive,
  resetLivePerformanceModeForTests,
  setLivePerformanceMode,
  subscribeLivePerformanceMode,
  toggleLivePerformanceMode,
} from '../../src/js/core/live-performance-mode.ts';

beforeEach(() => {
  resetLivePerformanceModeForTests();
  globalThis.localStorage?.clear?.();
});

describe('live performance mode', () => {
  test('is off until asked for', () => {
    expect(getLivePerformanceMode()).toBe(false);
    expect(isLivePerformanceModeActive()).toBe(false);
  });

  test('publishes a document attribute the per-frame paths can read', () => {
    setLivePerformanceMode(true);
    // The render and power paths run per frame and cannot wait for React
    // state to propagate, so the attribute is the contract.
    expect(document.documentElement.dataset.livePerformance).toBe('true');
    expect(isLivePerformanceModeActive()).toBe(true);

    setLivePerformanceMode(false);
    expect(document.documentElement.dataset.livePerformance).toBeUndefined();
    expect(isLivePerformanceModeActive()).toBe(false);
  });

  test('notifies subscribers only on real changes', () => {
    const listener = mock();
    subscribeLivePerformanceMode(listener);

    setLivePerformanceMode(true);
    setLivePerformanceMode(true);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(toggleLivePerformanceMode()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('unsubscribing stops delivery', () => {
    const listener = mock();
    const unsubscribe = subscribeLivePerformanceMode(listener);
    unsubscribe();
    setLivePerformanceMode(true);
    expect(listener).not.toHaveBeenCalled();
  });

  test('survives storage being unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    try {
      resetLivePerformanceModeForTests();
      // Private-mode storage denial must not stop a show from starting.
      expect(() => setLivePerformanceMode(true)).not.toThrow();
      expect(isLivePerformanceModeActive()).toBe(true);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      }
    }
  });
});
