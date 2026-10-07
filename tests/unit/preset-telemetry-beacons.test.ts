import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  notePresetFrame,
  notePresetShown,
  noteShaderExecution,
} from '../../src/js/core/services/preset-telemetry.ts';
import {
  resetTelemetryContextForTests,
  setTelemetryAudioSource,
} from '../../src/js/core/services/telemetry-context.ts';
import { resetDeviceDetectCache } from '../../src/js/utils/browser/device-detect.ts';

/**
 * The beacons production queries depend on. The endpoint only resolves on a
 * deployed origin, so these tests stand up a minimal location + sendBeacon
 * and read the payload the edge function would receive.
 *
 * Shader execution: the mode is in the event name (the dataset's only index),
 * and shader-free presets are not counted at all. Dwell: each beacon carries
 * the frame rate and backend the visitor saw, the only field data on how
 * Stims performs on real hardware.
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
    expect(beacons[0]?.body).toMatchObject({
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

  test('sends nothing from an automated browser', async () => {
    // Our own Playwright runs against toil.fyi were counted as visitors.
    Object.assign(navigator, { webdriver: true });
    noteShaderExecution('probe-preset', 'direct', 'webgpu');
    await flush();

    expect(beacons).toEqual([]);
  });

  test('sends nothing for a preset with no shader text', async () => {
    noteShaderExecution('plain-preset', 'none', 'webgpu');
    noteShaderExecution('unknown-preset', null, 'webgpu');
    await flush();

    expect(beacons).toEqual([]);
  });

  test('carries no identifying data beyond the slug and coarse context', async () => {
    noteShaderExecution('some-preset', 'unsupported', 'webgpu');
    await flush();

    expect(Object.keys(beacons[0]?.body ?? {}).sort()).toEqual([
      'audioSource',
      'device',
      'event',
      'orientation',
      'presetId',
      'renderer',
    ]);
  });
});

describe('preset dwell beacons', () => {
  // Module state persists across tests: show a sentinel first so the preset
  // under test is the one flushed, then drop the sentinel's own beacon.
  const startFresh = async (presetId: string, backend: 'webgl' | 'webgpu') => {
    notePresetShown(`sentinel-${presetId}`);
    notePresetShown(presetId, backend);
    await flush();
    beacons = [];
  };

  test('reports the rendered frame rate and backend of the preset left', async () => {
    await startFresh('steady-preset', 'webgpu');
    for (let frame = 0; frame < 90; frame += 1) notePresetFrame(1000 / 30);
    notePresetShown('next-preset', 'webgpu');
    await flush();

    expect(beacons).toHaveLength(1);
    expect(beacons[0]?.body).toMatchObject({
      presetId: 'steady-preset',
      renderer: 'webgpu',
      fps: 30,
    });
  });

  test('spells the WebGL path webgl2, like the rest of the dataset', async () => {
    await startFresh('webgl-preset', 'webgl');
    for (let frame = 0; frame < 120; frame += 1) notePresetFrame(1000 / 60);
    notePresetShown('next-preset', 'webgl');
    await flush();

    expect(beacons[0]?.body).toMatchObject({ renderer: 'webgl2', fps: 60 });
  });

  test('counts only the frames rendered since the preset was shown', async () => {
    await startFresh('slow-preset', 'webgpu');
    for (let frame = 0; frame < 90; frame += 1) notePresetFrame(1000 / 60);
    notePresetShown('fast-preset', 'webgpu');
    for (let frame = 0; frame < 48; frame += 1) notePresetFrame(1000 / 24);
    notePresetShown('last-preset', 'webgpu');
    await flush();

    expect(beacons.map((beacon) => beacon.body.fps)).toEqual([60, 24]);
  });

  test('says how the screen was held and what audio was live', async () => {
    const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844,
    });
    Object.assign(navigator, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    resetDeviceDetectCache();
    try {
      await startFresh('phone-preset', 'webgpu');
      setTelemetryAudioSource('demo');
      notePresetShown('next-preset', 'webgpu');
      await flush();

      expect(beacons[0]?.body).toMatchObject({
        presetId: 'phone-preset',
        orientation: 'portrait',
        device: 'phone',
        audioSource: 'demo',
      });
    } finally {
      if (width) Object.defineProperty(window, 'innerWidth', width);
      if (height) Object.defineProperty(window, 'innerHeight', height);
      resetDeviceDetectCache();
      resetTelemetryContextForTests();
    }
  });

  test('omits fps when too little was rendered to measure a rate', async () => {
    await startFresh('brief-preset', 'webgpu');
    for (let frame = 0; frame < 10; frame += 1) notePresetFrame(1000 / 60);
    notePresetShown('next-preset', 'webgpu');
    await flush();

    expect(beacons[0]?.body).not.toHaveProperty('fps');
    expect(beacons[0]?.body.renderer).toBe('webgpu');
  });
});
