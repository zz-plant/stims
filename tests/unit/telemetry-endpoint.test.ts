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
    ]);
  });

  test('writes an unknown context value as empty', async () => {
    const { points } = await post({
      event: 'preset-dwell',
      orientation: 'sideways',
      device: '<script>',
      audioSource: 'spotify',
      arrival: 'https://www.google.com/',
    });

    expect(points[0]?.blobs?.slice(5)).toEqual(['', '', '', '']);
  });

  test('keeps accepting beacons from clients that send no context', async () => {
    const { response, points } = await post({ event: 'growth-demo-started' });

    expect(response.status).toBe(204);
    expect(points[0]?.blobs?.slice(5)).toEqual(['', '', '', '']);
  });
});
