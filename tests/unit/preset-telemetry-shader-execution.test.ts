import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { noteShaderExecution } from '../../src/js/core/services/preset-telemetry.ts';

/**
 * The counter that makes "how often are we approximating in the wild?"
 * answerable. The endpoint only resolves on a deployed origin, so these tests
 * stand up a minimal location + sendBeacon and read the payload the edge
 * function would receive — asserting the two properties the report queries
 * depend on: the mode is in the event name (the dataset's only index), and
 * shader-free presets are not counted at all.
 */

type Beacon = { url: string; body: Record<string, unknown> };

const pending: Promise<void>[] = [];
const flush = async () => {
  await Promise.all(pending.splice(0, pending.length));
};

let beacons: Beacon[] = [];
let originalLocation: unknown;
let originalNavigator: unknown;

beforeEach(async () => {
  beacons = [];
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
        // Bun's Blob.text() is async; the sender is fire-and-forget, so the
        // decode is queued here and awaited by the assertions below.
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
  if (originalLocation) {
    Object.defineProperty(
      globalThis,
      'location',
      originalLocation as PropertyDescriptor,
    );
  } else {
    delete (globalThis as Record<string, unknown>).location;
  }
  if (originalNavigator) {
    Object.defineProperty(
      globalThis,
      'navigator',
      originalNavigator as PropertyDescriptor,
    );
  }
});

describe('noteShaderExecution', () => {
  test('puts the mode in the event name and the backend in renderer', async () => {
    noteShaderExecution('conway-preset', 'translated', 'webgpu');
    await flush();

    expect(beacons).toHaveLength(1);
    expect(beacons[0]?.url).toBe('https://toil.fyi/api/telemetry');
    expect(beacons[0]?.body).toEqual({
      event: 'shader-exec-translated',
      renderer: 'webgpu',
      presetId: 'conway-preset',
    });
  });

  test('records the denominator too, so a rate can be computed', async () => {
    noteShaderExecution('good-preset', 'direct', 'webgl');
    await flush();

    expect(beacons[0]?.body.event).toBe('shader-exec-direct');
    // The contract's enum spells the WebGL path 'webgl2', matching the rest
    // of the dataset rather than inventing a third spelling.
    expect(beacons[0]?.body.renderer).toBe('webgl2');
  });

  test('sends nothing for a preset with no shader text', async () => {
    noteShaderExecution('plain-preset', 'none', 'webgpu');
    noteShaderExecution('unknown-preset', null, 'webgpu');
    await flush();

    expect(beacons).toEqual([]);
  });

  test('carries no identifying data beyond the catalog slug', async () => {
    noteShaderExecution('some-preset', 'unsupported', 'webgpu');
    await flush();

    expect(Object.keys(beacons[0]?.body ?? {}).sort()).toEqual([
      'event',
      'presetId',
      'renderer',
    ]);
  });
});
