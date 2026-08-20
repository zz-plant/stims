/**
 * Publishes preset preview PNGs to the stims-static R2 bucket, which the site
 * Worker serves at /milkdrop-presets/previews/*.
 *
 * Previews are generated artifacts (scripts/generate-thumbnails.ts) and no
 * longer ship in git or the deploy bundle — run this after regenerating them.
 * Pass filenames to upload a subset; otherwise every PNG is uploaded, 12 at a
 * time.
 */
// Usage:
//   BACKFILL_TOKEN=<token> bun run scripts/sync-previews-r2.ts            # all previews
//   BACKFILL_TOKEN=<token> bun run scripts/sync-previews-r2.ts a.png b.png # specific files
//
// The token is the stims-embed-backfill worker secret (rotate with
// `wrangler secret put BACKFILL_TOKEN --config wrangler.cron.jsonc`).

import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const PREVIEWS_DIR = resolve(
  import.meta.dirname || '.',
  '..',
  'public/milkdrop-presets/previews',
);
const UPLOAD_BASE =
  process.env.UPLOAD_BASE || 'https://stims-embed-backfill.kanavj.workers.dev';
const CONCURRENCY = 12;

const token = process.env.BACKFILL_TOKEN;
if (!token) {
  console.error('BACKFILL_TOKEN is required.');
  process.exit(1);
}

const requested = process.argv.slice(2).map((f) => basename(f));
const files = (
  requested.length > 0
    ? requested
    : readdirSync(PREVIEWS_DIR).filter((f) => f.endsWith('.png'))
).sort();

let uploaded = 0;
let failed = 0;

async function uploadOne(file: string): Promise<void> {
  const key = `milkdrop-presets/previews/${file}`;
  const body = await Bun.file(`${PREVIEWS_DIR}/${file}`).arrayBuffer();
  const response = await fetch(
    `${UPLOAD_BASE}/static/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/png',
      },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
}

async function worker(queue: string[]): Promise<void> {
  for (;;) {
    const file = queue.shift();
    if (!file) return;
    try {
      await uploadOne(file);
      uploaded++;
    } catch (error) {
      failed++;
      console.error(
        `FAIL ${file}: ${error instanceof Error ? error.message : error}`,
      );
    }
    if ((uploaded + failed) % 250 === 0) {
      console.log(`progress: ${uploaded + failed}/${files.length}`);
    }
  }
}

const queue = [...files];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

console.log(
  `done: uploaded=${uploaded} failed=${failed} total=${files.length}`,
);
process.exit(failed > 0 ? 1 : 0);
