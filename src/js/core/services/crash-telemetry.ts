import { getDeviceEnvironmentProfile } from '../../utils/browser/device-detect.ts';
import { getDevicePerformanceProfile } from '../device-profile.ts';
import type { TelemetryEvent } from '../edge-contracts.ts';
import { createLogger } from '../logger.ts';
import { resolveOptionalApiUrl } from './optional-api.ts';

const logger = createLogger('CrashTelemetry');

const STORAGE_KEY = 'stims:crash-telemetry';
const MAX_ENTRIES = 200;
// Crash loops can record entries every frame; cap what one session sends so
// a broken deployment never turns clients into a telemetry firehose.
const MAX_TRANSMITS_PER_SESSION = 10;
let transmittedCount = 0;

export type CrashTelemetryEntry = {
  type:
    | 'error'
    | 'unhandledrejection'
    | 'webgpu-device-lost'
    | 'webgpu-uncaptured-error'
    | 'webgl-context-lost'
    | 'manual';
  timestamp: number;
  iso: string;
  message: string;
  stack?: string;
  detail?: Record<string, unknown>;
};

export type CrashTelemetryReport = {
  summary: {
    total: number;
    errors: number;
    unhandledRejections: number;
    webgpuDeviceLost: number;
    webgpuUncapturedErrors: number;
    webglContextLost: number;
    firstAt: string | null;
    lastAt: string | null;
  };
  environment: {
    userAgent?: string;
    platform?: string;
    vendor?: string;
    deviceMemory?: number;
    hardwareConcurrency?: number;
    isMobile: boolean;
    isLowPower: boolean;
    lowPowerReason: string | null;
  };
  entries: CrashTelemetryEntry[];
};

const entries: CrashTelemetryEntry[] = [];
let installed = false;

function sanitizeMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeStack(value: unknown): string | undefined {
  if (value instanceof Error && typeof value.stack === 'string') {
    return value.stack;
  }
  return undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[object]';
  }
}

function pushEntry(entry: CrashTelemetryEntry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
  persistReport();
  transmitEntry(entry);
}

export function buildCrashTelemetryTransmitPayload(
  entry: CrashTelemetryEntry,
): TelemetryEvent {
  return {
    event: `crash:${entry.type}`,
    error: entry.message.slice(0, 256),
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}

function transmitEntry(entry: CrashTelemetryEntry) {
  if (transmittedCount >= MAX_TRANSMITS_PER_SESSION) {
    return;
  }
  // Optional service: resolves to null in dev, on localhost, and in tests,
  // so crash reporting only leaves the device on configured deployments.
  const endpoint = resolveOptionalApiUrl('/api/telemetry');
  if (!endpoint) {
    return;
  }
  transmittedCount += 1;
  const body = JSON.stringify(buildCrashTelemetryTransmitPayload(entry));
  try {
    // sendBeacon survives page teardown — the common case when reporting a
    // crash; fall back to keepalive fetch when it is unavailable or refuses
    // the payload.
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(
        endpoint,
        new Blob([body], { type: 'application/json' }),
      )
    ) {
      return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never break the app it is reporting on.
  }
}

function parseErrorEventDetail(event: ErrorEvent): Record<string, unknown> {
  return {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error ? safeStringify(event.error) : undefined,
  };
}

function parseRejectionEventDetail(
  event: PromiseRejectionEvent,
): Record<string, unknown> {
  return {
    reason:
      event.reason instanceof Error
        ? event.reason.message
        : safeStringify(event.reason),
  };
}

export function recordCrashTelemetryError(
  message: string,
  options?: { stack?: string; detail?: Record<string, unknown> },
) {
  pushEntry({
    type: 'manual',
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    message,
    stack: options?.stack,
    detail: options?.detail,
  });
  logger.error(message, options?.detail ?? '');
}

export function recordWebGpuDeviceLost(info: unknown) {
  const reason =
    info && typeof info === 'object' && 'reason' in info
      ? String((info as { reason: unknown }).reason)
      : 'unknown';
  const message =
    info && typeof info === 'object' && 'message' in info
      ? String((info as { message: unknown }).message)
      : '';
  pushEntry({
    type: 'webgpu-device-lost',
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    message: `WebGPU device lost: ${reason}`,
    detail: { reason, message },
  });
  logger.error(`WebGPU device lost: ${reason}`, { reason, message });
}

export function recordWebGpuUncapturedError(
  event: { error?: { message?: string } | null } | null | undefined,
) {
  const message = event?.error?.message ?? 'unknown';
  pushEntry({
    type: 'webgpu-uncaptured-error',
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    message: `WebGPU uncaptured error: ${message}`,
    detail: { message },
  });
  logger.error(`WebGPU uncaptured error: ${message}`, { message });
}

export function recordWebGLContextLost(
  event?: { statusMessage?: string } | null,
) {
  const statusMessage =
    event &&
    typeof event.statusMessage === 'string' &&
    event.statusMessage.trim().length > 0
      ? event.statusMessage.trim()
      : 'unknown';
  pushEntry({
    type: 'webgl-context-lost',
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    message: `WebGL context lost: ${statusMessage}`,
    detail: { statusMessage },
  });
  logger.error(`WebGL context lost: ${statusMessage}`, { statusMessage });
}

export function getCrashTelemetryReport(): CrashTelemetryReport {
  const env =
    typeof navigator !== 'undefined'
      ? {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          vendor: navigator.vendor,
          deviceMemory: (navigator as Navigator & { deviceMemory?: number })
            .deviceMemory,
          hardwareConcurrency: navigator.hardwareConcurrency,
        }
      : {};
  const perf = getDevicePerformanceProfile();
  const deviceEnv = getDeviceEnvironmentProfile();

  return {
    summary: {
      total: entries.length,
      errors: entries.filter((e) => e.type === 'error').length,
      unhandledRejections: entries.filter(
        (e) => e.type === 'unhandledrejection',
      ).length,
      webgpuDeviceLost: entries.filter((e) => e.type === 'webgpu-device-lost')
        .length,
      webgpuUncapturedErrors: entries.filter(
        (e) => e.type === 'webgpu-uncaptured-error',
      ).length,
      webglContextLost: entries.filter((e) => e.type === 'webgl-context-lost')
        .length,
      firstAt: entries[0]?.iso ?? null,
      lastAt: entries[entries.length - 1]?.iso ?? null,
    },
    environment: {
      ...env,
      isMobile: deviceEnv.isMobile,
      isLowPower: perf.lowPower,
      lowPowerReason: perf.reason,
    },
    entries: entries.slice(),
  };
}

export function flushCrashTelemetryReport(): CrashTelemetryReport {
  const report = getCrashTelemetryReport();
  logger.warn(`Crash telemetry report:\n${JSON.stringify(report, null, 2)}`);
  return report;
}

function persistReport() {
  try {
    const payload = JSON.stringify(entries.slice(-50));
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // Ignore storage failures (e.g., private mode).
  }
}

function restoreReport() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as CrashTelemetryEntry[];
    if (!Array.isArray(parsed)) {
      return;
    }
    entries.push(...parsed.slice(-MAX_ENTRIES));
  } catch {
    // Ignore parse/storage failures.
  }
}

export function resetCrashTelemetryForTests() {
  installed = false;
  entries.length = 0;
  transmittedCount = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function installCrashTelemetry() {
  if (installed) {
    return;
  }
  installed = true;

  if (typeof window === 'undefined') {
    return;
  }

  restoreReport();

  window.addEventListener('error', (event: ErrorEvent) => {
    pushEntry({
      type: 'error',
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      message: sanitizeMessage(event.error ?? event.message),
      stack: sanitizeStack(event.error),
      detail: parseErrorEventDetail(event),
    });
  });

  window.addEventListener(
    'unhandledrejection',
    (event: PromiseRejectionEvent) => {
      pushEntry({
        type: 'unhandledrejection',
        timestamp: Date.now(),
        iso: new Date().toISOString(),
        message: sanitizeMessage(event.reason),
        stack: sanitizeStack(event.reason),
        detail: parseRejectionEventDetail(event),
      });
    },
  );

  // Expose a global helper so users can dump the report from the console.
  (
    window as typeof window & { __stims_crash_report?: () => void }
  ).__stims_crash_report = flushCrashTelemetryReport;
}
