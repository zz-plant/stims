/**
 * Warming exists to remove the crawler's first fetch, the one that can fail and
 * get the generic card cached for a URL indefinitely. That makes a fallback
 * response the exact failure this script is supposed to be able to prove absent
 * — and it is invisible from outside, because a Worker that cannot render
 * still answers 200 with a few kilobytes of generic card. Body size is the only
 * tell, so the script has to both detect it and refuse to report a clean run.
 *
 * These tests are the reason the run is safe to repeat against production: a
 * bad minute on the edge costs a delay, not a hole in the warm set, and a run
 * that could not warm what it promised says so in its exit status.
 */
import { describe, expect, test } from 'bun:test';
import {
  backoffDelay,
  cardUrl,
  classifyCardBody,
  exitCodeFor,
  fetchCardWithRetry,
  formatWarmSummary,
  MAX_BACKOFF_MS,
  MAX_CONCURRENCY,
  parseWarmOptions,
  planTargets,
  SUSPICIOUS_CARD_BYTES,
  UsageError,
  type WarmSummary,
  warmCards,
} from '../../scripts/warm-og-cards.ts';

/** A card that rendered for real: well over the fallback size. */
const realCard = (bytes = 60_000) => new Uint8Array(bytes);

/** A card that fell back to the generic render: 200, but a few kilobytes. */
const fallbackCard = (bytes = 4_821) => new Uint8Array(bytes);

const response = (status: number, body: Uint8Array) =>
  ({
    status,
    arrayBuffer: async () =>
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
  }) as Response;

const noSleep = () => Promise.resolve();

describe('parseWarmOptions', () => {
  test('defaults warm the top of the catalog with retries and a timeout', () => {
    const options = parseWarmOptions([]);

    expect(options).toEqual({
      limit: 150,
      offset: 0,
      concurrency: 8,
      timeoutMs: 10_000,
      attempts: 3,
      backoffMs: 500,
    });
  });

  test('accepts a well-formed flag set', () => {
    const options = parseWarmOptions([
      '--limit',
      '10',
      '--offset',
      '5',
      '--concurrency',
      '2',
      '--timeout-ms',
      '1000',
      '--attempts',
      '4',
      '--backoff-ms',
      '0',
    ]);

    expect(options).toEqual({
      limit: 10,
      offset: 5,
      concurrency: 2,
      timeoutMs: 1000,
      attempts: 4,
      backoffMs: 0,
    });
  });

  // Every one of these used to be accepted and then misbehave: `--limit abc`
  // silently warmed 150 cards, `--concurrency 0` spawned no workers and
  // reported `warmed=0 failed=0` as a clean run.
  test.each([
    [['--concurrency', '0'], '--concurrency must be between'],
    [['--concurrency', '-4'], '--concurrency must be between'],
    [
      ['--concurrency', String(MAX_CONCURRENCY + 1)],
      '--concurrency must be between',
    ],
    [['--limit', '0'], '--limit must be between'],
    [['--offset', '-1'], '--offset must be between'],
    [['--timeout-ms', '10'], '--timeout-ms must be between'],
    [['--attempts', '0'], '--attempts must be between'],
    [['--attempts', '2.5'], '--attempts needs a whole number'],
    [['--limit', 'many'], '--limit needs a whole number'],
    [['--limit'], '--limit needs a whole number'],
  ])('rejects %p', (argv, message) => {
    let thrown: unknown;
    try {
      parseWarmOptions(argv as string[]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UsageError);
    expect((thrown as Error).message).toContain(message);
  });
});

describe('planTargets', () => {
  const presets = [
    { id: 'third', order: 3 },
    { id: 'first', order: 1 },
    { id: 'fourth', order: 4 },
    { id: 'second', order: 2 },
  ];

  test('warms the most prominent presets first', () => {
    // The catalog's curated order is the only ranking there is, and the window
    // into it is what the offset slices.
    expect(planTargets(presets, { offset: 0, limit: 2 })).toEqual([
      'first',
      'second',
    ]);
    expect(planTargets(presets, { offset: 2, limit: 2 })).toEqual([
      'third',
      'fourth',
    ]);
  });

  test('an offset past the end of the catalog selects nothing', () => {
    // The caller turns this into a non-zero exit: a run that promised to warm
    // cards and warmed none is a misconfiguration, not a success.
    expect(planTargets(presets, { offset: 99, limit: 10 })).toEqual([]);
  });

  test("does not reorder the caller's catalog", () => {
    const order = presets.map((p) => p.id);

    planTargets(presets, { offset: 0, limit: 3 });

    expect(presets.map((p) => p.id)).toEqual(order);
  });
});

describe('classifyCardBody', () => {
  test('a real render is ok', () => {
    expect(classifyCardBody(200, SUSPICIOUS_CARD_BYTES)).toBe('ok');
  });

  test('a 200 that is too small to be a render is suspicious, not ok', () => {
    expect(classifyCardBody(200, SUSPICIOUS_CARD_BYTES - 1)).toBe('suspicious');
    expect(classifyCardBody(200, 0)).toBe('failed');
  });

  test('a non-200 is a failure whatever the body size', () => {
    expect(classifyCardBody(404, realCard().byteLength)).toBe('failed');
    expect(classifyCardBody(500, 0)).toBe('failed');
  });
});

describe('backoffDelay', () => {
  test('grows exponentially from the configured base', () => {
    expect(backoffDelay(500, 1)).toBe(500);
    expect(backoffDelay(500, 2)).toBe(1000);
    expect(backoffDelay(500, 3)).toBe(2000);
  });

  test('is capped, so no flag combination can stall a run for minutes', () => {
    expect(backoffDelay(MAX_BACKOFF_MS, 5)).toBe(MAX_BACKOFF_MS);
  });

  test('a zero base waits not at all', () => {
    expect(backoffDelay(0, 3)).toBe(0);
  });
});

describe('fetchCardWithRetry', () => {
  const options = {
    timeoutMs: 1000,
    attempts: 3,
    backoffMs: 10,
    sleep: noSleep,
  };

  test('a real card succeeds on the first attempt', async () => {
    const calls: number[] = [];
    const outcome = await fetchCardWithRetry(cardUrl('https://x', 'a'), {
      ...options,
      fetchImpl: async () => {
        calls.push(1);
        return response(200, realCard());
      },
    });

    expect(calls).toHaveLength(1);
    expect(outcome).toMatchObject({
      status: 200,
      verdict: 'ok',
      attempts: 1,
      detail: null,
    });
  });

  test('encodes the id, so a preset name cannot break the request', () => {
    expect(cardUrl('https://x', 'a b&c')).toBe(
      'https://x/api/og-preset?id=a%20b%26c',
    );
  });

  test('bounds every request with a timeout', async () => {
    let signal: AbortSignal | undefined;
    await fetchCardWithRetry(cardUrl('https://x', 'a'), {
      ...options,
      fetchImpl: async (_url, init) => {
        signal = init?.signal as AbortSignal;
        return response(200, realCard());
      },
    });

    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('retries a 5xx and reports the attempt count', async () => {
    let attempts = 0;
    const slept: number[] = [];
    const outcome = await fetchCardWithRetry(cardUrl('https://x', 'a'), {
      ...options,
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetchImpl: async () => {
        attempts++;
        return response(503, new Uint8Array(0));
      },
    });

    expect(attempts).toBe(3);
    expect(slept).toEqual([10, 20]);
    expect(outcome).toMatchObject({ status: 503, verdict: 'failed' });
    expect(outcome.attempts).toBe(3);
  });

  test('a 5xx that clears is a warmed card, not a failure', async () => {
    let attempts = 0;
    const outcome = await fetchCardWithRetry(cardUrl('https://x', 'a'), {
      ...options,
      fetchImpl: async () => {
        attempts++;
        return attempts < 2
          ? response(500, new Uint8Array(0))
          : response(200, realCard());
      },
    });

    expect(attempts).toBe(2);
    expect(outcome.verdict).toBe('ok');
  });

  test('does not retry a 404, which repeating cannot fix', async () => {
    let attempts = 0;
    const outcome = await fetchCardWithRetry(cardUrl('https://x', 'gone'), {
      ...options,
      fetchImpl: async () => {
        attempts++;
        return response(404, new Uint8Array(0));
      },
    });

    expect(attempts).toBe(1);
    expect(outcome).toMatchObject({ status: 404, verdict: 'failed' });
  });

  test('a hung request is retried and reported as a timeout, not a mystery', async () => {
    let attempts = 0;
    const outcome = await fetchCardWithRetry(cardUrl('https://x', 'slow'), {
      ...options,
      timeoutMs: 1000,
      fetchImpl: async () => {
        attempts++;
        const err = new Error('The operation timed out');
        err.name = 'TimeoutError';
        throw err;
      },
    });

    expect(attempts).toBe(3);
    expect(outcome.detail).toBe('timed out after 1000ms');
    expect(outcome.verdict).toBe('failed');
  });

  test('a fallback body is surfaced even when the request succeeded', async () => {
    const outcome = await fetchCardWithRetry(cardUrl('https://x', 'a'), {
      ...options,
      fetchImpl: async () => response(200, fallbackCard()),
    });

    // 200, no error, one attempt — and still not a warmed card.
    expect(outcome).toMatchObject({ status: 200, verdict: 'suspicious' });
    expect(outcome.detail).toBeNull();
  });
});

describe('warmCards', () => {
  const warm = () => ({
    base: 'https://x',
    concurrency: 2,
    timeoutMs: 1000,
    attempts: 2,
    backoffMs: 0,
    sleep: noSleep,
    fetchImpl: async (url: string) => {
      const id = new URL(url).searchParams.get('id') ?? '';
      if (id === 'missing') return response(404, new Uint8Array(0));
      if (id === 'fallback') return response(200, fallbackCard());
      if (id === 'flaky') {
        flakyAttempts++;
        if (flakyAttempts < 2) return response(502, new Uint8Array(0));
      }
      return response(200, realCard());
    },
  });
  let flakyAttempts = 0;

  test('warms every card in the set and counts the rest', async () => {
    flakyAttempts = 0;
    const summary = await warmCards(['a', 'b', 'flaky'], warm());

    expect(summary.requested).toBe(3);
    expect(summary.warmed).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.suspicious).toEqual([]);
  });

  test('a fallback body fails the run even though the request returned 200', async () => {
    const summary = await warmCards(['fallback'], warm());

    expect(summary.warmed).toBe(0);
    expect(summary.suspicious).toEqual([{ id: 'fallback', bytes: 4821 }]);
    expect(exitCodeFor(summary)).toBe(1);
  });

  test('a card that never warmed is a failure with the reason attached', async () => {
    const summary = await warmCards(['missing'], warm());

    expect(summary.failed).toBe(1);
    // No attempt count, because a 404 was not retried: the run spent its
    // whole budget on the one request and moved on.
    expect(summary.failures).toEqual([
      { id: 'missing', detail: 'missing: HTTP 404, 0b' },
    ]);
    expect(exitCodeFor(summary)).toBe(1);
  });

  test('warms every id exactly once, whatever the concurrency', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const seen: string[] = [];
    const summary = await warmCards(ids, {
      ...warm(),
      concurrency: 5,
      fetchImpl: async (url: string) => {
        seen.push(new URL(url).searchParams.get('id') ?? '');
        return response(200, realCard());
      },
    });

    expect(seen.sort()).toEqual([...ids].sort());
    expect(summary.warmed).toBe(12);
  });

  test('reports progress every 25 cards, so a long run shows signs of life', async () => {
    const marks: Array<[number, number]> = [];
    await warmCards(
      Array.from({ length: 30 }, (_, i) => `p${i}`),
      {
        ...warm(),
        onProgress: (done, total) => marks.push([done, total]),
      },
    );

    // The final tally comes from the summary, so the progress line only has to
    // mark cadence — it is not a completion report and does not repeat the end.
    expect(marks).toEqual([[25, 30]]);
  });
});

describe('formatWarmSummary', () => {
  const base: WarmSummary = {
    requested: 3,
    warmed: 3,
    failed: 0,
    suspicious: [],
    failures: [],
    elapsedMs: 1_234,
  };

  test('a clean run reports the tally and nothing to act on', () => {
    const text = formatWarmSummary(base);

    expect(text).toBe('warmed=3 failed=0 in 1.2s');
    expect(exitCodeFor(base)).toBe(0);
  });

  test('a fallback names the id and its size, and says the run did not pass', () => {
    const summary: WarmSummary = {
      ...base,
      warmed: 2,
      suspicious: [{ id: 'fallback', bytes: 4_821 }],
    };
    const text = formatWarmSummary(summary);

    expect(text).toContain('fell back to the generic card');
    expect(text).toContain('fallback (4821b)');
    expect(exitCodeFor(summary)).toBe(1);
  });

  test('a failure keeps the reason and the next thing to try', () => {
    const summary: WarmSummary = {
      ...base,
      warmed: 2,
      failed: 1,
      failures: [
        { id: 'slow', detail: 'slow: timed out after 1000ms (2 attempts)' },
      ],
    };
    const text = formatWarmSummary(summary);

    expect(text).toContain('could not be warmed');
    expect(text).toContain('slow: timed out after 1000ms (2 attempts)');
    expect(text).toContain('--timeout-ms/--attempts');
  });

  test('truncates a long list but never hides that it was truncated', () => {
    const summary: WarmSummary = {
      ...base,
      warmed: 0,
      failed: 25,
      failures: Array.from({ length: 25 }, (_, i) => ({
        id: `p${i}`,
        detail: `p${i}: HTTP 500, 0b`,
      })),
    };
    const text = formatWarmSummary(summary);

    expect(text).toContain('… 5 more');
    expect(exitCodeFor(summary)).toBe(1);
  });
});

/**
 * The unit tests above cover the decision logic; this one covers the part that
 * only shows up in a real process. A non-zero exit is the entire contract for
 * anything automating a warm, and a summary printed after a bare `exit()` can
 * be lost when stdout is a pipe — so the exit status and the printed report are
 * asserted together, against a local stand-in for the edge.
 */
describe('warm-og-cards end to end', () => {
  /**
   * Async spawn, not spawnSync: the stand-in edge is served by this process, so
   * blocking the event loop would deadlock the very requests under test.
   * `port: 0` hands out a free port per test, so a stray listener cannot make a
   * rerun flaky.
   */
  const runAgainst = async (
    handler: (id: string, attempt: number) => Response,
    args: string[],
  ): Promise<{ status: number; stdout: string; stderr: string }> => {
    const attempts = new Map<string, number>();
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const id = new URL(req.url).searchParams.get('id') ?? '';
        if (id === 'catalog') {
          return new Response(
            JSON.stringify({
              presets: [
                { id: 'warm', order: 1 },
                { id: 'fallback', order: 2 },
                { id: 'gone', order: 3 },
              ],
            }),
            { status: 200 },
          );
        }
        attempts.set(id, (attempts.get(id) ?? 0) + 1);
        return handler(id, attempts.get(id) ?? 1);
      },
    });

    try {
      const child = Bun.spawn({
        cmd: ['bun', 'run', 'scripts/warm-og-cards.ts', ...args],
        cwd: process.cwd(),
        env: {
          ...process.env,
          SITE_BASE: `http://127.0.0.1:${server.port}`,
          CATALOG_URL: `http://127.0.0.1:${server.port}/catalog?id=catalog`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { status, stdout, stderr };
    } finally {
      server.stop(true);
    }
  };

  test('exits 0 and reports a clean tally when every card is warm', async () => {
    const run = await runAgainst(
      () => new Response(new Uint8Array(60_000), { status: 200 }),
      ['--limit', '1'],
    );

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('warmed=1 failed=0');
  });

  test('exits non-zero and still prints the report when a card falls back', async () => {
    const run = await runAgainst(
      (id) =>
        id === 'fallback'
          ? new Response(new Uint8Array(4821), { status: 200 })
          : new Response(new Uint8Array(60_000), { status: 200 }),
      ['--limit', '2'],
    );

    expect(run.status).toBe(1);
    // The report is the diagnostic, and it has to survive the non-zero exit.
    expect(run.stdout).toContain('warmed=1 failed=0');
    expect(run.stdout).toContain('fallback (4821b)');
    expect(run.stdout).toContain('fell back to the generic card');
  });

  test('exits non-zero when a card cannot be warmed at all', async () => {
    const run = await runAgainst(
      (id) =>
        id === 'gone'
          ? new Response('nope', { status: 404 })
          : new Response(new Uint8Array(60_000), { status: 200 }),
      ['--limit', '3'],
    );

    expect(run.status).toBe(1);
    expect(run.stdout).toContain('gone: HTTP 404');
  });

  test('a card the edge hiccups on is retried and still counted warm', async () => {
    const run = await runAgainst(
      (_id, attempt) =>
        attempt < 2
          ? new Response('busy', { status: 503 })
          : new Response(new Uint8Array(60_000), { status: 200 }),
      ['--limit', '1', '--backoff-ms', '1'],
    );

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('warmed=1 failed=0');
  });

  test('a misconfigured flag exits before any request is made', async () => {
    // Nothing is fetched: the run is over before it starts, and the message
    // says which flag and which range rather than reporting a clean run.
    const run = await runAgainst(
      () => new Response(new Uint8Array(60_000), { status: 200 }),
      ['--concurrency', '0'],
    );

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('--concurrency must be between 1 and 32');
    expect(run.stdout).not.toContain('warmed=');
  });

  test('an offset past the end of the catalog is a failure, not an empty run', async () => {
    const run = await runAgainst(
      () => new Response(new Uint8Array(60_000), { status: 200 }),
      ['--offset', '99999'],
    );

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Nothing was warmed');
    expect(run.stdout).not.toContain('warmed=');
  });
});
