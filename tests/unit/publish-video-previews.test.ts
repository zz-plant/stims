import { expect, test } from 'bun:test';
import { publishWithRetry } from '../../scripts/publish-video-previews.ts';

test('a batch publication waits for rate limits and continues with the same request', async () => {
  let requests = 0;
  const waits: number[] = [];
  const response = await publishWithRetry(
    async () => {
      requests++;
      if (requests <= 2)
        return new Response(null, {
          status: 429,
          headers: requests === 2 ? { 'Retry-After': '5' } : {},
        });
      return new Response('published', { status: 201 });
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  expect(response.status).toBe(201);
  expect(requests).toBe(3);
  expect(waits).toEqual([60_000, 5000]);
});

test('persistent rate limits have bounded retries and other errors return immediately', async () => {
  let requests = 0;
  const waits: number[] = [];
  const response = await publishWithRetry(
    async () => {
      requests++;
      return new Response(null, { status: 429 });
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  expect(response.status).toBe(429);
  expect(requests).toBe(4);
  expect(waits).toHaveLength(3);
  const error = await publishWithRetry(
    async () => new Response(null, { status: 503 }),
    async () => {
      throw new Error('Unexpected retry');
    },
  );
  expect(error.status).toBe(503);
});
