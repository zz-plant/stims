/**
 * Core Web Vitals from real visits: one beacon each for LCP, INP and CLS,
 * sent when the browser settles the value (usually as the page is hidden).
 *
 * Google ranks pages partly on these three as measured in visitors' Chrome
 * browsers, and the Chrome UX Report leaves out origins without enough
 * traffic, so production had no way to say whether Stims passes. The canvas
 * work this app does on the main thread is exactly what INP punishes.
 *
 * The metric rides in the event name, the dataset's only index, the same way
 * `shader-exec-*` and `substitution-*` do. Rows carry the usual visitor
 * context plus a coarse page class, never the address.
 */
import {
  type CLSMetric,
  type INPMetric,
  type LCPMetric,
  onCLS,
  onINP,
  onLCP,
} from 'web-vitals';
import {
  TELEMETRY_NAVIGATION_TYPES,
  type TelemetryEvent,
} from '../edge-contracts.ts';
import { parseURLParams } from '../url-params.ts';
import {
  readTelemetryContext,
  resolveTelemetryEndpoint,
} from './telemetry-context.ts';

type VitalMetric = LCPMetric | INPMetric | CLSMetric;

export type WebVitalsObservers = {
  onLCP: (report: (metric: LCPMetric) => void) => void;
  onINP: (report: (metric: INPMetric) => void) => void;
  onCLS: (report: (metric: CLSMetric) => void) => void;
};

/**
 * Three metrics per page view, and each bfcache restore starts three more.
 * Twelve covers a visitor who goes back and forth a few times.
 */
const MAX_TRANSMITS_PER_SESSION = 12;
let transmitted = 0;
let installed = false;

/**
 * The page class for a URL. Read from the navigation entry, not `location`:
 * the workspace rewrites the address as presets change, so by the time a
 * vital settles `location` names whatever was playing last.
 */
export function classifyTelemetryPage(
  href: string,
): NonNullable<TelemetryEvent['page']> {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return 'other';
  }
  const { routing } = parseURLParams(url.searchParams);
  if (routing.previewMode) return 'embed';
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return routing.presetId ? 'preset' : 'home';
  }
  if (/^\/(?:discover|author)\/[^/]+\/?$/u.test(url.pathname)) return 'hub';
  return 'other';
}

let landingPage: TelemetryEvent['page'];

function readLandingPage(): TelemetryEvent['page'] {
  if (landingPage !== undefined) return landingPage;
  const entry =
    typeof performance !== 'undefined' &&
    typeof performance.getEntriesByType === 'function'
      ? performance.getEntriesByType('navigation')[0]
      : undefined;
  const href =
    entry?.name ?? (typeof location === 'undefined' ? '' : location.href);
  landingPage = href ? classifyTelemetryPage(href) : undefined;
  return landingPage;
}

function navigationTypeOf(
  metric: VitalMetric,
): TelemetryEvent['navigationType'] {
  return (TELEMETRY_NAVIGATION_TYPES as readonly string[]).includes(
    metric.navigationType,
  )
    ? (metric.navigationType as TelemetryEvent['navigationType'])
    : undefined;
}

function sendVital(metric: VitalMetric) {
  if (transmitted >= MAX_TRANSMITS_PER_SESSION) return;
  if (!Number.isFinite(metric.value) || metric.value < 0) return;
  const endpoint = resolveTelemetryEndpoint();
  if (!endpoint) return;
  const navigationType = navigationTypeOf(metric);
  const page = readLandingPage();
  const payload: TelemetryEvent = {
    event: `vital-${metric.name.toLowerCase()}`,
    // CLS is a small unitless score; the timings are whole milliseconds.
    vitalValue:
      metric.name === 'CLS'
        ? Math.round(metric.value * 10000) / 10000
        : Math.round(metric.value),
    ...(navigationType ? { navigationType } : {}),
    ...(page ? { page } : {}),
    ...readTelemetryContext(),
  };
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        endpoint,
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
      );
      transmitted++;
    }
  } catch {
    // Telemetry must never surface as a user-visible failure.
  }
}

/**
 * Starts observing. Safe to call after first paint: the library reads the
 * buffered LCP, layout-shift and event-timing entries from before it ran.
 */
export function installWebVitalsTelemetry(
  observers: WebVitalsObservers = { onLCP, onINP, onCLS },
) {
  if (installed) return;
  installed = true;
  observers.onLCP(sendVital);
  observers.onINP(sendVital);
  observers.onCLS(sendVital);
}

/** Test-only reset of the install guard, cap and cached page class. */
export function resetWebVitalsTelemetryForTests() {
  installed = false;
  transmitted = 0;
  landingPage = undefined;
}
