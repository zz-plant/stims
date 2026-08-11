import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  buildCrashTelemetryTransmitPayload,
  flushCrashTelemetryReport,
  getCrashTelemetryReport,
  installCrashTelemetry,
  recordCrashTelemetryError,
  recordWebGpuDeviceLost,
  recordWebGpuUncapturedError,
  resetCrashTelemetryForTests,
} from '../../src/js/core/services/crash-telemetry.ts';

describe('crash telemetry', () => {
  beforeEach(() => {
    resetCrashTelemetryForTests();
  });

  test('records a manual error and includes it in the report', () => {
    recordCrashTelemetryError('test error', { stack: 'at test' });
    const report = getCrashTelemetryReport();

    expect(report.summary.total).toBe(1);
    expect(report.summary.errors).toBe(0);
    expect(report.entries[0]?.type).toBe('manual');
    expect(report.entries[0]?.message).toBe('test error');
    expect(report.entries[0]?.stack).toBe('at test');
  });

  test('records WebGPU device loss', () => {
    recordWebGpuDeviceLost({
      reason: 'destroyed',
      message: 'device destroyed',
    });
    const report = getCrashTelemetryReport();

    expect(report.summary.webgpuDeviceLost).toBe(1);
    expect(report.entries[0]?.message).toContain('destroyed');
  });

  test('records WebGPU uncaptured errors', () => {
    recordWebGpuUncapturedError({ error: { message: 'out of memory' } });
    const report = getCrashTelemetryReport();

    expect(report.summary.webgpuUncapturedErrors).toBe(1);
    expect(report.entries[0]?.message).toContain('out of memory');
  });

  test('installs global error listeners without throwing', () => {
    expect(() => installCrashTelemetry()).not.toThrow();
  });

  test('censors persisted entries to the last 50', () => {
    for (let i = 0; i < 60; i += 1) {
      recordCrashTelemetryError(`error-${i}`);
    }

    const stored = localStorage.getItem('stims:crash-telemetry');
    const parsed = JSON.parse(stored ?? '[]') as unknown[];
    expect(parsed.length).toBe(50);
  });

  test('flush returns a complete report', () => {
    recordCrashTelemetryError('flushed');
    const report = flushCrashTelemetryReport();

    expect(report.summary.total).toBe(1);
    expect(report.environment.isMobile).toBe(false);
    expect(report.environment.isLowPower).toBeDefined();
  });

  test('builds the /api/telemetry payload from a crash entry', () => {
    const payload = buildCrashTelemetryTransmitPayload({
      type: 'webgl-context-lost',
      timestamp: 1,
      iso: '1970-01-01T00:00:00.001Z',
      message: 'WebGL context lost: power saving',
    });

    expect(payload.event).toBe('crash:webgl-context-lost');
    expect(payload.error).toBe('WebGL context lost: power saving');
  });

  test('does not transmit when no optional API endpoint is configured', () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      // Test env resolves the optional API to null (localhost), so recording
      // must stay local instead of attempting a network call.
      recordCrashTelemetryError('local-only crash');
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
