import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CLSMetric, INPMetric, LCPMetric } from 'web-vitals';
import { onRequest } from '../../functions/api/telemetry.ts';
import {
  buildReports,
  GOOD_VITAL_THRESHOLDS,
} from '../../scripts/telemetry-report.ts';
import { resetTelemetryContextForTests } from '../../src/js/core/services/telemetry-context.ts';
import {
  classifyTelemetryPage,
  installWebVitalsTelemetry,
  resetWebVitalsTelemetryForTests,
  type WebVitalsObservers,
} from '../../src/js/core/services/web-vitals-telemetry.ts';
import { resetDeviceDetectCache } from '../../src/js/utils/browser/device-detect.ts';

/**
 * Core Web Vitals beacons and the columns they land in. The library's
 * observers are replaced by ones the test fires, standing in for the browser
 * settling a value; the payload is then fed through the real endpoint so the
 * column positions production queries read are what is checked.
 */

type Beacon = Record<string, unknown>;
type Report = (metric: LCPMetric | INPMetric | CLSMetric) => void;

const pending: Promise<void>[] = [];
let beacons: Beacon[] = [];
let saved: Record<string, PropertyDescriptor | undefined> = {};

const flush = async () => {
  await Promise.all(pending.splice(0, pending.length));
};

function stubGlobal(name: string, value: unknown) {
  saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

function landOn(href: string) {
  stubGlobal('performance', {
    getEntriesByType: (type: string) =>
      type === 'navigation' ? [{ name: href }] : [],
  });
}

function installFakeObservers() {
  const reports: Partial<Record<'LCP' | 'INP' | 'CLS', Report>> = {};
  const observers: WebVitalsObservers = {
    onLCP: (report) => {
      reports.LCP = report as Report;
    },
    onINP: (report) => {
      reports.INP = report as Report;
    },
    onCLS: (report) => {
      reports.CLS = report as Report;
    },
  };
  installWebVitalsTelemetry(observers);
  return (
    name: 'LCP' | 'INP' | 'CLS',
    value: number,
    navigationType: LCPMetric['navigationType'] = 'navigate',
  ) =>
    reports[name]?.({
      name,
      value,
      rating: 'good',
      delta: value,
      id: `v6-${name}`,
      entries: [],
      navigationType,
      navigationId: 1,
    } as unknown as LCPMetric);
}

beforeEach(() => {
  beacons = [];
  saved = {};
  stubGlobal('location', {
    hostname: 'toil.fyi',
    origin: 'https://toil.fyi',
    href: 'https://toil.fyi/?preset=geiss-casino',
  });
  stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/148.0.0.0',
    sendBeacon: (_url: string, blob: Blob) => {
      pending.push(
        blob.text().then((text) => {
          beacons.push(JSON.parse(text));
        }),
      );
      return true;
    },
  });
  landOn('https://toil.fyi/');
  resetWebVitalsTelemetryForTests();
  resetTelemetryContextForTests();
  resetDeviceDetectCache();
});

afterEach(() => {
  for (const [name, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  resetWebVitalsTelemetryForTests();
});

describe('web vitals beacons', () => {
  test('each vital is its own event, timings in whole milliseconds', async () => {
    const fire = installFakeObservers();
    fire('LCP', 1843.6);
    fire('INP', 216.2);
    fire('CLS', 0.04213);
    await flush();
    expect(beacons.map((b) => [b.event, b.vitalValue])).toEqual([
      ['vital-lcp', 1844],
      ['vital-inp', 216],
      ['vital-cls', 0.0421],
    ]);
    expect(beacons[0]).toMatchObject({
      navigationType: 'navigate',
      page: 'home',
      engine: 'chromium',
    });
  });

  test('the page class is the landing page, not where the address went after', async () => {
    // location says a preset deep link; the navigation entry says the visit
    // landed on the home page, and only the landing page is sent.
    const fire = installFakeObservers();
    fire('LCP', 900);
    await flush();
    expect(beacons[0]?.page).toBe('home');
  });

  test('a zero layout shift is reported, a broken value is not', async () => {
    const fire = installFakeObservers();
    fire('CLS', 0);
    fire('INP', Number.NaN);
    await flush();
    expect(beacons.map((b) => [b.event, b.vitalValue])).toEqual([
      ['vital-cls', 0],
    ]);
  });

  test('a soft navigation is sent without a navigation type', async () => {
    const fire = installFakeObservers();
    fire('LCP', 700, 'soft-navigation' as LCPMetric['navigationType']);
    fire('LCP', 300, 'back-forward-cache');
    await flush();
    expect(beacons[0]?.navigationType).toBeUndefined();
    expect(beacons[1]?.navigationType).toBe('back-forward-cache');
  });

  test('one session sends at most twelve vitals', async () => {
    const fire = installFakeObservers();
    for (let i = 0; i < 20; i++) fire('LCP', 400, 'back-forward-cache');
    await flush();
    expect(beacons).toHaveLength(12);
  });

  test('a second install does not double every beacon', async () => {
    const fire = installFakeObservers();
    installWebVitalsTelemetry({
      onLCP: (report) => report({ name: 'LCP', value: 1 } as LCPMetric),
      onINP: () => {},
      onCLS: () => {},
    });
    fire('LCP', 1200);
    await flush();
    expect(beacons).toHaveLength(1);
  });

  test('an automated browser sends nothing', async () => {
    stubGlobal('navigator', {
      webdriver: true,
      sendBeacon: () => {
        throw new Error('webdriver sessions must not post');
      },
    });
    const fire = installFakeObservers();
    fire('LCP', 1200);
    await flush();
    expect(beacons).toHaveLength(0);
  });
});

describe('classifyTelemetryPage', () => {
  test('names each app page by kind', () => {
    expect(classifyTelemetryPage('https://toil.fyi/')).toBe('home');
    expect(classifyTelemetryPage('https://toil.fyi/?preset=geiss-casino')).toBe(
      'preset',
    );
    expect(classifyTelemetryPage('https://toil.fyi/discover/fractal')).toBe(
      'hub',
    );
    expect(classifyTelemetryPage('https://toil.fyi/author/geiss/')).toBe('hub');
    expect(
      classifyTelemetryPage('https://toil.fyi/?preset=geiss-casino&embed=true'),
    ).toBe('embed');
    expect(classifyTelemetryPage('https://toil.fyi/discover/a/b')).toBe(
      'other',
    );
    expect(classifyTelemetryPage('not a url')).toBe('other');
  });
});

describe('vital rows in the dataset', () => {
  async function post(body: Record<string, unknown>) {
    const points: { blobs?: string[]; doubles?: number[] }[] = [];
    await onRequest({
      request: new Request('https://toil.fyi/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env: {
        STIMS_TELEMETRY: { writeDataPoint: (point) => points.push(point) },
      },
    });
    return points[0];
  }

  test('lands the value in double11 and the page context in blob19 and blob20', async () => {
    const point = await post({
      event: 'vital-cls',
      vitalValue: 0,
      navigationType: 'prerender',
      page: 'preset',
    });
    expect(point?.blobs).toHaveLength(19);
    expect(point?.blobs?.slice(17)).toEqual(['prerender', 'preset']);
    expect(point?.doubles?.[10]).toBe(0);
    const lcp = await post({ event: 'vital-lcp', vitalValue: 2210 });
    expect(lcp?.doubles?.[10]).toBe(2210);
  });

  test('an unknown page or navigation type is written as empty', async () => {
    const point = await post({
      event: 'vital-lcp',
      vitalValue: -5,
      navigationType: 'teleport',
      page: '/presets/secret-draft',
    });
    expect(point?.blobs?.slice(17)).toEqual(['', '']);
    expect(point?.doubles?.[10]).toBe(0);
  });

  test('the report reads those columns against the good thresholds', () => {
    const report = buildReports(7).find((r) =>
      r.title.startsWith('Core Web Vitals'),
    );
    expect(report?.sql).toContain('quantileWeighted(0.75)(double11, 1)');
    expect(report?.sql).toContain('blob20 AS page');
    expect(GOOD_VITAL_THRESHOLDS).toEqual({
      'vital-lcp': 2500,
      'vital-inp': 200,
      'vital-cls': 0.1,
    });
  });
});
