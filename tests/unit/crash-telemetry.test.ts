import {
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
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
    recordWebGpuDeviceLost({ reason: 'destroyed', message: 'device destroyed' });
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

  test('captures global errors when installed', () => {
    installCrashTelemetry();

    const event = new ErrorEvent('error', {
      message: 'global error',
      error: new Error('global error'),
      filename: 'test.js',
      lineno: 1,
      colno: 1,
    });
    window.dispatchEvent(event);

    const report = getCrashTelemetryReport();
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
    expect(report.entries.some((e) => e.message === 'global error')).toBe(true);
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
});
