/**
 * Triggers an on-demand embeddings backfill run on the deployed
 * stims-embed-backfill Worker.
 *
 * The 15-minute cron on that Worker is retired: embeddings only need
 * refreshing when preset catalog content or visual descriptions change,
 * which happens in this repo's catalog pipeline, not continuously. Run this
 * after `catalog:generate` or `generate:descriptions` change what presets are
 * described as — it POSTs the Worker's authenticated backfill route until a
 * run reports no work left, so a changed description set fully re-embeds in
 * one command. Each run covers up to 100 presets (the Worker's per-run
 * subrequest budget).
 *
 * Re-runs are cheap by design: the Worker compares each stored description
 * against the text it would write now and skips rows that are already up to
 * date, so an unnecessary run is one catalog fetch plus one D1 read.
 */
// Usage:
//   BACKFILL_TOKEN=<token> bun run scripts/trigger-embed-backfill.ts
//   BACKFILL_TOKEN=<token> EMBED_BACKFILL_URL=<url> bun run scripts/trigger-embed-backfill.ts

const DEFAULT_URL = 'https://stims-embed-backfill.kanavj.workers.dev';
// 40 runs x 100 presets clears any catalog this repo is likely to ship; the
// loop also exits on the first no-work run, so this is only a runaway guard.
const MAX_RUNS = 40;

export {};

type BackfillResult = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

const url = process.env.EMBED_BACKFILL_URL || DEFAULT_URL;
const token = process.env.BACKFILL_TOKEN;
if (!token) {
  console.error('BACKFILL_TOKEN is required.');
  process.exit(1);
}

for (let run = 1; run <= MAX_RUNS; run += 1) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    console.error(
      `Run ${run} failed: HTTP ${response.status} ${await response.text()}`,
    );
    process.exit(1);
  }

  const result = (await response.json()) as BackfillResult;
  console.log(
    `run ${run}: total=${result.total} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped}`,
  );

  if (result.failed > 0) {
    console.error(
      'Run had failures; stopping to avoid looping on a persistent error.',
    );
    process.exit(1);
  }
  if (result.succeeded === 0) {
    console.log(`Backfill complete after ${run} run(s).`);
    process.exit(0);
  }
}

console.error(`Stopped after ${MAX_RUNS} runs without reaching a no-work run.`);
process.exit(1);
