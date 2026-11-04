import { describe, expect, test } from 'bun:test';
import { onRequest } from '../../functions/api/telemetry.ts';

/**
 * The column layout production queries depend on. Analytics Engine addresses
 * blobs by position, so the visitor context is appended after the original
 * five and an unknown value is written as '' rather than passed through.
 */

type DataPoint = { blobs?: string[]; doubles?: number[]; indexes?: string[] };

async function post(body: Record<string, unknown>) {
  const points: DataPoint[] = [];
  const response = await onRequest({
    request: new Request('https://toil.fyi/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-ipcountry': 'NZ' },
      body: JSON.stringify(body),
    }),
    env: { STIMS_TELEMETRY: { writeDataPoint: (point) => points.push(point) } },
  });
  return { response, points };
}

describe('/api/telemetry', () => {
  test('appends slow-frame attribution after the existing columns', async () => {
    const { points } = await post({
      event: 'preset-dwell',
      fps: 40,
      engineMajor: 117,
      simulationMs: 4.5,
      renderMs: 3,
      gpuMs: 7,
      cadenceMs: 25,
      qualityStep: 'balanced',
      renderScale: 0.96,
      flashGuard: 'on',
      flashSampler: 'worker',
    });
    expect(points[0]?.blobs?.slice(13)).toEqual(['balanced', 'on', 'worker']);
    expect(points[0]?.doubles?.[0]).toBe(40);
    expect(points[0]?.doubles?.[4]).toBe(117);
    expect(points[0]?.doubles?.slice(5)).toEqual([4.5, 3, 7, 25, 0.96]);
  });

  test('an older client leaves the attribution columns empty', async () => {
    const { response, points } = await post({
      event: 'preset-dwell',
      fps: 40,
    });
    expect(response.status).toBe(204);
    expect(points[0]?.blobs?.slice(13)).toEqual(['', '', '']);
    expect(points[0]?.doubles?.slice(5)).toEqual([0, 0, 0, 0, 0]);
  });

  test('an unknown or malformed value never becomes a column value', async () => {
    const { response, points } = await post({
      event: 'preset-dwell',
      simulationMs: 'slow',
      cadenceMs: -4,
      qualityStep: 'session-1234',
      flashGuard: 'maybe',
      flashSampler: 'gpu',
    });
    expect(response.status).toBe(204);
    expect(points[0]?.blobs?.slice(13)).toEqual(['', '', '']);
    expect(points[0]?.doubles?.[5]).toBe(0);
    expect(points[0]?.doubles?.[8]).toBe(0);
  });

  test('appends orientation, device, audio source and arrival after the original blobs', async () => {
    const { response, points } = await post({
      event: 'preset-dwell',
      renderer: 'webgpu',
      presetId: 'shifter-curlique',
      orientation: 'portrait',
      device: 'phone',
      audioSource: 'demo',
      arrival: 'search',
    });

    expect(response.status).toBe(204);
    expect(points[0]?.blobs).toEqual([
      'preset-dwell',
      'webgpu',
      'shifter-curlique',
      '',
      'NZ',
      'portrait',
      'phone',
      'demo',
      'search',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });

  test('appends the OS, engine and WebView flag, and the major as a double', async () => {
    const { points } = await post({
      event: 'growth-audio-started',
      os: 'android',
      engine: 'chromium',
      engineMajor: 117,
      androidWebView: true,
    });

    expect(points[0]?.blobs?.slice(10)).toEqual([
      'android',
      'chromium',
      'webview',
      '',
      '',
      '',
    ]);
    expect(points[0]?.doubles?.[4]).toBe(117);
  });

  test('stores nothing but the coarse values', async () => {
    const { points } = await post({
      event: 'growth-audio-started',
      os: 'Android 13',
      engine: 'Chrome/117.0.5938.153',
      engineMajor: 117.5938153,
      androidWebView: 'wv',
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)',
    });

    expect(points[0]?.blobs?.slice(10)).toEqual(Array(6).fill(''));
    expect(points[0]?.doubles?.[4]).toBe(0);
    expect(JSON.stringify(points[0])).not.toContain('Pixel 7');
  });

  test.each([[0], [-1], [1000], [1234567890], ['117'], [null]])(
    'stores an engine major of %p as unknown',
    async (engineMajor) => {
      const { points } = await post({ event: 'x', engineMajor });
      expect(points[0]?.doubles?.[4]).toBe(0);
    },
  );

  test('appends the surface an action was run from', async () => {
    const { points } = await post({
      event: 'action:open-editor',
      surface: 'menu',
    });

    expect(points[0]?.blobs?.[0]).toBe('action:open-editor');
    expect(points[0]?.blobs?.[9]).toBe('menu');
  });

  test('writes an unknown context value as empty', async () => {
    const { points } = await post({
      event: 'preset-dwell',
      orientation: 'sideways',
      device: '<script>',
      audioSource: 'spotify',
      arrival: 'https://www.google.com/',
      surface: 'toolbar',
    });

    expect(points[0]?.blobs?.slice(5)).toEqual(Array(11).fill(''));
  });

  test('keeps accepting beacons from clients that send no context', async () => {
    const { response, points } = await post({ event: 'growth-demo-started' });

    expect(response.status).toBe(204);
    expect(points[0]?.blobs?.slice(5)).toEqual(Array(11).fill(''));
    expect(points[0]?.doubles?.[4]).toBe(0);
  });
});
