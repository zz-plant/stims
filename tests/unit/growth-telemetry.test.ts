import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  noteGrowthEvent,
  resetGrowthTelemetryForTests,
} from '../../src/js/core/services/preset-telemetry.ts';

type Beacon = { url: string; body: Record<string, unknown> };
const pending: Promise<void>[] = [];
const flush = async () => {
  await Promise.all(pending.splice(0, pending.length));
};

let beacons: Beacon[] = [];
let originalLocation: unknown;
let originalNavigator: unknown;

beforeEach(() => {
  beacons = [];
  resetGrowthTelemetryForTests();
  originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: 'toil.fyi', origin: 'https://toil.fyi' },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      sendBeacon: (url: string, blob: Blob) => {
        pending.push(
          blob.text().then((text) => {
            beacons.push({ url, body: JSON.parse(text) });
          }),
        );
        return true;
      },
    },
  });
});

afterEach(() => {
  if (originalLocation)
    Object.defineProperty(
      globalThis,
      'location',
      originalLocation as PropertyDescriptor,
    );
  else delete (globalThis as Record<string, unknown>).location;
  if (originalNavigator)
    Object.defineProperty(
      globalThis,
      'navigator',
      originalNavigator as PropertyDescriptor,
    );
  else delete (globalThis as Record<string, unknown>).navigator;
});

describe('noteGrowthEvent', () => {
  test('records share outcomes with the preset slug and no raw URL', async () => {
    noteGrowthEvent('share-copied', 'geiss-casino');
    await flush();
    expect(beacons[0]?.url).toBe('https://toil.fyi/api/telemetry');
    expect(beacons[0]?.body).toEqual({
      event: 'growth-share-copied',
      presetId: 'geiss-casino',
    });
  });

  test('records landing and audible-start conversion events', async () => {
    noteGrowthEvent('embed-landing');
    noteGrowthEvent('discovery-landing');
    noteGrowthEvent('audio-started');
    await flush();
    expect(beacons.map((beacon) => beacon.body.event)).toEqual([
      'growth-embed-landing',
      'growth-discovery-landing',
      'growth-audio-started',
    ]);
  });
});
