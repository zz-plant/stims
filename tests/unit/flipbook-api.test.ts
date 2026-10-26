import { describe, expect, test } from 'bun:test';
import { onRequest } from '../../functions/api/flipbooks/[[path]].ts';
import { quantizePreviewFrame } from '../../src/js/utils/media/preview-flipbook.ts';

function fixture() {
  const objects = new Map<string, Uint8Array>();
  let transforms = 0;
  const video = new Uint8Array([
    0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115,
    111, 109,
  ]);
  const bucket = {
    async get(key: string) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        size: bytes.length,
        arrayBuffer: async () => bytes.slice().buffer,
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      };
    },
    async put(key: string, value: string | Uint8Array) {
      objects.set(
        key,
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      );
    },
    async delete(keys: string[]) {
      for (const key of keys) objects.delete(key);
    },
  };
  const frame = quantizePreviewFrame(
    Uint8Array.from({ length: 32 * 18 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : i % 128,
    ),
  );
  const body = {
    title: 'A </script> title',
    presetId: 'shifter-curlique',
    source: '[preset00]\nzoom=1',
    clip: {
      version: 1,
      width: 32,
      height: 18,
      delayMs: 500,
      frames: [frame, frame],
    },
  };
  const env = {
    STATIC_R2: bucket,
    VIDEO_PREVIEWS_ENABLED: 'true',
    VIDEO_UPLOAD_LIMITER: { limit: async () => ({ success: true }) },
    MEDIA: {
      input(input: ReadableStream<Uint8Array>) {
        return {
          transform: () => ({
            output: () => ({
              response: async () => {
                expect(
                  (await new Response(input).text()).startsWith('GIF89a'),
                ).toBe(true);
                transforms++;
                return new Response(video, {
                  headers: { 'Content-Type': 'video/mp4' },
                });
              },
            }),
          }),
        };
      },
    },
  };
  const request = (
    method: string,
    path = '',
    data?: unknown,
    headers?: Record<string, string>,
  ) =>
    onRequest({
      request: new Request(`https://toil.fyi/api/flipbooks/${path}`, {
        method,
        headers: {
          Origin: 'https://toil.fyi',
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
      env,
    });
  return { request, objects, body, env, video, transforms: () => transforms };
}

describe('public flipbook publishing', () => {
  test('stores the transformed MP4 before publishing, serves ranges, and reuses it', async () => {
    const f = fixture();
    const result = await (await f.request('POST', '', f.body)).json();
    const video = await f.request('GET', `${result.id}.mp4`);
    expect(video.status).toBe(200);
    expect(video.headers.get('content-type')).toBe('video/mp4');
    expect(new Uint8Array(await video.arrayBuffer())).toEqual(f.video);
    const range = await f.request('GET', `${result.id}.mp4`, undefined, {
      Range: 'bytes=4-7',
    });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('ftyp');
    expect(await (await f.request('HEAD', `${result.id}.mp4`)).text()).toBe('');
    expect((await (await f.request('GET', result.id)).json()).videoReady).toBe(
      true,
    );
    expect((await f.request('POST', '', f.body)).status).toBe(200);
    expect(f.transforms()).toBe(1);
    await f.request('DELETE', result.id, undefined, {
      Authorization: `Bearer ${result.deleteToken}`,
    });
    expect(f.objects.size).toBe(0);
  });

  test('a failed media conversion publishes no record or assets', async () => {
    const f = fixture();
    f.env.MEDIA.input = () => {
      throw new Error('Service unavailable');
    };
    expect((await f.request('POST', '', f.body)).status).toBe(503);
    expect(f.objects.size).toBe(0);
  });

  test('publishes once, serves real GIF bytes with ranges, and requires its deletion token', async () => {
    const f = fixture();
    const response = await f.request('POST', '', f.body);
    expect(response.status).toBe(201);
    const published = await response.json();
    expect(published.url).toMatch(/^https:\/\/toil.fyi\/s\/[a-f0-9]{64}$/);
    expect(published.deleteToken).toBeString();
    const id = published.url.split('/').pop();
    const gif = await f.request('GET', `${id}.gif`);
    expect(gif.headers.get('content-type')).toBe('image/gif');
    expect((await gif.text()).startsWith('GIF89a')).toBe(true);
    const ranged = await f.request('GET', `${id}.gif`, undefined, {
      Range: 'bytes=0-5',
    });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('GIF89a');
    const head = await f.request('HEAD', `${id}.gif`);
    expect(await head.text()).toBe('');
    expect((await f.request('DELETE', id)).status).toBe(403);
    expect(
      (
        await f.request('DELETE', id, undefined, {
          Authorization: `Bearer ${published.deleteToken}`,
        })
      ).status,
    ).toBe(204);
    expect((await f.request('GET', `${id}.gif`)).status).toBe(404);
  });

  test('fails closed on disabled publishing, missing limiter, foreign origin and oversized streaming bodies', async () => {
    const f = fixture();
    f.env.VIDEO_PREVIEWS_ENABLED = 'false';
    expect((await f.request('POST', '', f.body)).status).toBe(503);
    f.env.VIDEO_PREVIEWS_ENABLED = 'true';
    expect(
      (
        await f.request('POST', '', f.body, {
          Origin: 'https://elsewhere.test',
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.request('POST', '', { ...f.body, source: 'x'.repeat(130_000) }))
        .status,
    ).toBe(400);
    expect(f.objects.size).toBe(0);
    const response = await onRequest({
      request: new Request('https://toil.fyi/api/flipbooks/', {
        method: 'POST',
        headers: {
          Origin: 'https://toil.fyi',
          'Content-Type': 'application/json',
        },
        body: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(2_000_001));
            c.close();
          },
        }),
      }),
      env: f.env,
    });
    expect(response.status).toBe(413);
  });
});
