import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  getMicrophoneCapabilityFromState,
  queryMicrophonePermissionState,
} from '../assets/js/core/services/microphone-permission-service.ts';

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

describe('microphone permission service', () => {
  test('returns unsupported when getUserMedia is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...originalNavigator,
        mediaDevices: undefined,
      },
    });

    await expect(queryMicrophonePermissionState()).resolves.toBe('unsupported');
  });

  test('returns unknown when permissions API is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...originalNavigator,
        mediaDevices: { getUserMedia: mock(async () => new MediaStream()) },
        permissions: undefined,
      },
    });

    await expect(queryMicrophonePermissionState()).resolves.toBe('unknown');
  });

  test('returns denied/prompt/granted from permissions query', async () => {
    for (const state of ['denied', 'prompt', 'granted'] as const) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
          ...originalNavigator,
          mediaDevices: { getUserMedia: mock(async () => new MediaStream()) },
          permissions: {
            query: mock(async () => ({ state })),
          },
        },
      });

      await expect(queryMicrophonePermissionState()).resolves.toBe(state);
    }
  });

  test('maps unknown fallback and denied to reasons', () => {
    expect(getMicrophoneCapabilityFromState('unknown')).toEqual({
      supported: true,
      state: 'unknown',
      reason:
        'Unable to read microphone permission state. The browser will still prompt when needed.',
    });

    expect(getMicrophoneCapabilityFromState('denied')).toEqual({
      supported: true,
      state: 'denied',
      reason: 'Microphone access is blocked for this site.',
    });
  });
});
