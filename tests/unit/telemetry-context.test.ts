import { afterEach, describe, expect, test } from 'bun:test';
import {
  classifyTelemetryViewport,
  readTelemetryContext,
  resetTelemetryContextForTests,
  setTelemetryAudioSource,
} from '../../src/js/core/services/telemetry-context.ts';

afterEach(() => {
  resetTelemetryContextForTests();
});

describe('classifyTelemetryViewport', () => {
  test('files a phone held upright as a portrait phone', () => {
    expect(classifyTelemetryViewport(390, 844, true)).toEqual({
      orientation: 'portrait',
      device: 'phone',
    });
  });

  test('keeps a phone a phone when it is turned sideways', () => {
    expect(classifyTelemetryViewport(844, 390, true)).toEqual({
      orientation: 'landscape',
      device: 'phone',
    });
  });

  test('separates tablets from phones by the short side', () => {
    expect(classifyTelemetryViewport(1024, 768, true)).toEqual({
      orientation: 'landscape',
      device: 'tablet',
    });
  });

  test('treats a near-square screen as square', () => {
    expect(classifyTelemetryViewport(800, 780, false)).toEqual({
      orientation: 'square',
      device: 'desktop',
    });
  });

  test('does not file a narrow desktop window as a phone', () => {
    expect(classifyTelemetryViewport(390, 844, false)).toEqual({
      orientation: 'portrait',
      device: 'desktop',
    });
  });

  test('reports nothing for a viewport with no size', () => {
    expect(classifyTelemetryViewport(0, 0, true)).toEqual({});
  });
});

describe('setTelemetryAudioSource', () => {
  test('reports the live source, and none once it stops', () => {
    setTelemetryAudioSource('microphone');
    expect(readTelemetryContext().audioSource).toBe('microphone');
    setTelemetryAudioSource(null);
    expect(readTelemetryContext().audioSource).toBe('none');
  });

  test('never passes an unknown source through', () => {
    setTelemetryAudioSource('spotify');
    expect(readTelemetryContext().audioSource).toBe('none');
  });
});
