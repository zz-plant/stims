/**
 * Warms the edge cache for the most-shared preset cards.
 *
 * A cold card render costs ~850ms of resvg work; a warm one is ~100ms. More
 * importantly, the crawler's *first* fetch is the one that can fail — and a
 * failed render serves the generic card, which unfurlers then cache for that
 * URL indefinitely. Warming removes that window for the presets most likely
 * to be shared.
 *
 * Ranked by the catalog's curated `order` field (1 = most prominent); there
 * is no view or share telemetry to rank by.
 *
 * Safe to re-run against production: every request is bounded by a timeout and
 * retried with backoff, so a flaky edge response costs a delay rather than a
 * hole in the warm set. A card that answers 200 with a body too small to be a
 * real render has silently fallen back to the generic card, which is the exact
 * failure this script exists to prevent — so it is reported as loudly as a
 * transport error, and the run exits non-zero either way. A green run means
 * every card in the set is cached and real.
 *
 * GETs only. Usage:
 *   bun run scripts/warm-og-cards.ts [--limit 150] [--offset 0]
 *                                    [--concurrency 8] [--timeout-ms 10000]
 *                                    [--attempts 3] [--backoff-ms 500]
 * Env: SITE_BASE (default https://toil.fyi), CATALOG_URL
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type WarmOptions = {
  limit: number;
  offset: number;
  concurrency: number;
  timeoutMs: number;
  attempts: number;
  backoffMs: number;
};

/** Widest fan-out the warm will use. Past this the edge sees abuse, not a warm. */
export const MAX_CONCURRENCY = 32;

/** Ceiling on a single backoff sleep, so a typo cannot stall a run for minutes. */
export const MAX_BACKOFF_MS = 15_000;

/**
 * A real card renders to tens of kilobytes; the generic fallback is a few
 * kilobytes. Body size is the only tell available from outside the Worker, so
 * it is the whole signal — and it is why a fallback cannot pass for a warm.
 */
export const SUSPICIOUS_CARD_BYTES = 20_000;

/** How long to wait for a single catalog fetch before trying the next source. */
const CATALOG_TIMEOUT_MS = 10_000;

/**
 * Every numeric flag, with the range that makes it meaningful. A limit or a
 * concurrency that parses to a number but not a sane one used to be accepted
 * silently: `--concurrency 0` spawned no workers at all and reported
 * `warmed=0 failed=0` as a clean run.
 */
const FLAG_SPECS: Array<[keyof WarmOptions, string, number, number, number]> = [
  ['limit', '--limit', 150, 1, 5000],
  ['offset', '--offset', 0, 0, Number.MAX_SAFE_INTEGER],
  ['concurrency', '--concurrency', 8, 1, MAX_CONCURRENCY],
  ['timeoutMs', '--timeout-ms', 10_000, 500, 60_000],
  ['attempts', '--attempts', 3, 1, 5],
  ['backoffMs', '--backoff-ms', 500, 0, MAX_BACKOFF_MS],
];

/** Thrown for a flag the operator has to fix; carries no stack worth printing. */
export class UsageError extends Error {}

export function warmUsage(): string {
  const flags = FLAG_SPECS.map(
    ([, flag, fallback, min, max]) =>
      `  ${flag.padEnd(14)}${String(fallback).padStart(6)}  ${min}–${max === Number.MAX_SAFE_INTEGER ? '∞' : max}`,
  );
  return [
    'Usage: bun run scripts/warm-og-cards.ts [flags]',
    ...flags,
    '            default    range',
  ].join('\n');
}

export function parseWarmOptions(argv: string[]): WarmOptions {
  const parsed: Record<string, number> = {};
  for (const [key, flag, fallback, min, max] of FLAG_SPECS) {
    const i = argv.indexOf(flag);
    if (i === -1) {
      parsed[key] = fallback;
      continue;
    }
    const raw = argv[i + 1];
    const n = Number(raw);
    const shown = raw === undefined || raw === '' ? '(nothing)' : raw;
    if (raw === undefined || !Number.isInteger(n)) {
      throw new UsageError(
        `${flag} needs a whole number, got ${JSON.stringify(shown)}.`,
      );
    }
    if (n < min || n > max) {
      throw new UsageError(
        `${flag} must be between ${min} and ${
          max === Number.MAX_SAFE_INTEGER ? '∞' : max
        }, got ${n}.`,
      );
    }
    parsed[key] = n;
  }
  return parsed as WarmOptions;
}

export type CardOutcome = {
  status: number;
  bytes: number;
  /** ok = warm and real · suspicious = 200 but a fallback · failed = no card. */
  verdict: 'ok' | 'suspicious' | 'failed';
  attempts: number;
  /** Why there is no card: a transport error, or null when the edge answered. */
  detail: string | null;
};

/**
 * The slice of `fetch` this script uses. Narrower than `typeof fetch` on
 * purpose: the card path needs a status and a body, and a caller supplying its
 * own transport should not have to reimplement `preconnect` to do it.
 */
export type CardFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export type WarmSummary = {
  requested: number;
  warmed: number;
  failed: number;
  suspicious: Array<{ id: string; bytes: number }>;
  failures: Array<{ id: string; detail: string }>;
  elapsedMs: number;
};

/** Trailing-slash tolerant, so a base pasted with one cannot double the path. */
export function cardUrl(base: string, id: string): string {
  return `${base.replace(/\/$/, '')}/api/og-preset?id=${encodeURIComponent(id)}`;
}

/**
 * The presets to warm, most prominent first. The catalog's `order` is the only
 * ranking available, so a slice is a promise about which cards the run
 * promised to warm — an empty slice is a misconfigured run, not a success.
 */
export function planTargets(
  presets: Array<{ id: string; order: number }>,
  options: Pick<WarmOptions, 'limit' | 'offset'>,
): string[] {
  return presets
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(options.offset, options.offset + options.limit)
    .map((p) => p.id);
}

export function classifyCardBody(
  status: number,
  bytes: number,
): CardOutcome['verdict'] {
  if (status !== 200 || bytes === 0) return 'failed';
  return bytes < SUSPICIOUS_CARD_BYTES ? 'suspicious' : 'ok';
}

/**
 * Retry what the edge would answer with on a bad minute, and only that. A 404
 * is a bug in the id or the route and repeating it just spends the run's
 * budget; a 5xx, a 429, or a dead connection is worth another attempt.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Exponential, capped: `attempt` is 1-based, so the first wait is the base. */
export function backoffDelay(base: number, attempt: number): number {
  if (base <= 0) return 0;
  return Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `timed out after ${timeoutMs}ms`;
    }
    return err.message;
  }
  return String(err);
}

export async function fetchCardWithRetry(
  url: string,
  options: {
    timeoutMs: number;
    attempts: number;
    backoffMs: number;
    fetchImpl?: CardFetch;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<CardOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));

  let last: CardOutcome = {
    status: 0,
    bytes: 0,
    verdict: 'failed',
    attempts: 0,
    detail: 'no attempt was made',
  };

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    let outcome: CardOutcome;
    try {
      const res = await doFetch(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const bytes = (await res.arrayBuffer()).byteLength;
      outcome = {
        status: res.status,
        bytes,
        verdict: classifyCardBody(res.status, bytes),
        attempts: attempt,
        detail: null,
      };
    } catch (err) {
      outcome = {
        status: 0,
        bytes: 0,
        verdict: 'failed',
        attempts: attempt,
        detail: describeFetchError(err, options.timeoutMs),
      };
    }
    last = outcome;

    const transient =
      outcome.detail !== null || isRetryableStatus(outcome.status);
    if (!transient || attempt === options.attempts) return outcome;
    await sleep(backoffDelay(options.backoffMs, attempt));
  }
  return last;
}

function describeOutcome(id: string, outcome: CardOutcome): string {
  const attempts =
    outcome.attempts > 1 ? ` (${outcome.attempts} attempts)` : '';
  if (outcome.detail) return `${id}: ${outcome.detail}${attempts}`;
  return `${id}: HTTP ${outcome.status}, ${outcome.bytes}b${attempts}`;
}

export async function warmCards(
  ids: string[],
  options: {
    base: string;
    concurrency: number;
    timeoutMs: number;
    attempts: number;
    backoffMs: number;
    fetchImpl?: CardFetch;
    sleep?: (ms: number) => Promise<void>;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<WarmSummary> {
  const summary: WarmSummary = {
    requested: ids.length,
    warmed: 0,
    failed: 0,
    suspicious: [],
    failures: [],
    elapsedMs: 0,
  };

  let done = 0;
  let cursor = 0;
  const start = Date.now();

  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const outcome = await fetchCardWithRetry(
        cardUrl(options.base, id),
        options,
      );
      if (outcome.verdict === 'ok') {
        summary.warmed++;
      } else if (outcome.verdict === 'suspicious') {
        summary.suspicious.push({ id, bytes: outcome.bytes });
      } else {
        summary.failed++;
        summary.failures.push({ id, detail: describeOutcome(id, outcome) });
      }
      if (++done % 25 === 0) options.onProgress?.(done, ids.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, ids.length) }, worker),
  );
  summary.elapsedMs = Date.now() - start;
  return summary;
}

/**
 * Non-zero when any card is not warm-and-real. A fallback answers 200, so
 * exit status is the only signal a wrapper or CI step can act on.
 */
export function exitCodeFor(summary: WarmSummary): number {
  return summary.failed > 0 || summary.suspicious.length > 0 ? 1 : 0;
}

export function formatWarmSummary(summary: WarmSummary): string {
  const lines = [
    `warmed=${summary.warmed} failed=${summary.failed} in ${(
      summary.elapsedMs / 1000
    ).toFixed(1)}s`,
  ];

  if (summary.suspicious.length > 0) {
    lines.push(
      '',
      `${summary.suspicious.length} card(s) returned a suspiciously small body — these fell back to the generic card:`,
    );
    for (const { id, bytes } of summary.suspicious.slice(0, 20)) {
      lines.push(`  ${id} (${bytes}b)`);
    }
    if (summary.suspicious.length > 20) {
      lines.push(`  … ${summary.suspicious.length - 20} more`);
    }
  }

  if (summary.failures.length > 0) {
    lines.push('', `${summary.failures.length} card(s) could not be warmed:`);
    for (const { detail } of summary.failures.slice(0, 20)) {
      lines.push(`  ${detail}`);
    }
    if (summary.failures.length > 20) {
      lines.push(`  … ${summary.failures.length - 20} more`);
    }
  }

  if (exitCodeFor(summary) !== 0) {
    lines.push(
      '',
      "Unwarmed cards are the crawler's first fetch, which can fail and get",
      'the generic card cached for that URL. Re-run this script for the ids',
      'above; if they keep failing, raise --timeout-ms/--attempts and check the',
      'edge log for that id before sharing a link to it.',
    );
  }

  return lines.join('\n');
}

type Catalog = { presets: Array<{ id: string; order: number }> };

async function loadCatalog(sources: string[]): Promise<Catalog | null> {
  for (const source of sources) {
    try {
      const text = source.startsWith('http')
        ? await fetch(source, {
            signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
          }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          })
        : readFileSync(source, 'utf8');
      const parsed = JSON.parse(text) as Catalog;
      console.log(`catalog: ${source} (${parsed.presets.length} presets)`);
      return parsed;
    } catch {
      // A missing or unreadable source is not fatal — try the next one.
    }
  }
  return null;
}

async function main() {
  let options: WarmOptions;
  try {
    options = parseWarmOptions(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✖ ${message}\n\n${warmUsage()}`);
    process.exit(2);
  }

  const base = (process.env.SITE_BASE || 'https://toil.fyi').replace(/\/$/, '');
  const catalogSources = [
    process.env.CATALOG_URL,
    join('public', 'milkdrop-presets', 'catalog.json'),
    `${base}/milkdrop-presets/catalog.json`,
  ].filter((v): v is string => Boolean(v));

  const catalog = await loadCatalog(catalogSources);
  if (!catalog) {
    console.error(
      `✖ Could not load the preset catalog from any source. Tried:\n  ${catalogSources.join(
        '\n  ',
      )}`,
    );
    process.exit(2);
  }

  const targets = planTargets(catalog.presets, options);
  if (targets.length === 0) {
    console.error(
      `✖ --offset ${options.offset} --limit ${options.limit} selects none of the ` +
        `${catalog.presets.length} presets in the catalog. Nothing was warmed.`,
    );
    process.exit(2);
  }

  console.log(
    `Warming ${targets.length} cards from rank ${options.offset + 1} ` +
      `(concurrency ${options.concurrency}, timeout ${options.timeoutMs}ms, ` +
      `${options.attempts} attempts)\n`,
  );

  const summary = await warmCards(targets, {
    base,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    attempts: options.attempts,
    backoffMs: options.backoffMs,
    onProgress: (done, total) => console.log(`  … ${done}/${total}`),
  });

  // exitCode rather than exit(): the summary is the diagnostic, and exiting
  // here can truncate it when stdout is a pipe.
  process.exitCode = exitCodeFor(summary);
  console.log(`\n${formatWarmSummary(summary)}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
