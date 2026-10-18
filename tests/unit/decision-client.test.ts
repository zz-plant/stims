import { describe, expect, test } from 'bun:test';
import type { DecisionRequest } from '../../src/js/core/decision-model.ts';
import { requestDecision } from '../../src/js/core/services/decision-client.ts';

const request: DecisionRequest = {
  task: 'prompt-match',
  state: { prompt: 'a blue spiral' },
  images: [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ],
};

describe('decision client', () => {
  test('unavailable configuration fails before transmitting media', async () => {
    let sent = false;
    await expect(
      requestDecision(request, {
        endpoint: null,
        fetcher: async () => {
          sent = true;
          return new Response();
        },
      }),
    ).rejects.toThrow('unavailable');
    expect(sent).toBe(false);
  });

  test('malformed service answers never reach the consumer', async () => {
    await expect(
      requestDecision(request, {
        endpoint: 'https://example.com/api/decide',
        fetcher: async () => Response.json({ answers: { structure_match: 1 } }),
      }),
    ).rejects.toThrow();
  });

  test('HTTP failures preserve an actionable status without echoing private input', async () => {
    await expect(
      requestDecision(request, {
        endpoint: 'https://example.com/api/decide',
        fetcher: async () => new Response('private payload', { status: 429 }),
      }),
    ).rejects.toThrow('429');
  });

  test('a cancelled request sends nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    let sent = false;
    await expect(
      requestDecision(request, {
        endpoint: 'https://example.com/api/decide',
        signal: controller.signal,
        fetcher: async () => {
          sent = true;
          return new Response();
        },
      }),
    ).rejects.toThrow();
    expect(sent).toBe(false);
  });
});
