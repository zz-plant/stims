/**
 * Publishes harvested flipbooks through the site's Media binding, then updates
 * the preset pointer in R2. Use --wrangler with the existing CLI login, or
 * BACKFILL_TOKEN for the authenticated backfill endpoint. --dry-run performs
 * no uploads or conversions.
 *
 * Usage: bun run previews:publish-video -- --ids=shifter-curlique --wrangler
 */
import { readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  presetFlipbookKey,
  sha256,
} from '../functions/shared/flipbook-store.ts';
import {
  encodeFlipbookGif,
  validateFlipbook,
} from '../src/js/utils/media/preview-flipbook.ts';
import { loadAllCatalogEntries } from './generate-thumbnails.ts';

export async function publishWithRetry(
  request: () => Promise<Response>,
  wait: (delayMs: number) => Promise<unknown> = (delayMs) => Bun.sleep(delayMs),
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await request();
    if (response.status !== 429 || attempt === 3) return response;
    const seconds = Number(response.headers.get('Retry-After') ?? 60);
    const delay = Number.isFinite(seconds)
      ? Math.max(1, Math.min(60, seconds)) * 1000
      : 60_000;
    await response.body?.cancel();
    await wait(delay);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const wrangler = args.includes('--wrangler');
  const idsArg = args.find((arg) => arg.startsWith('--ids='));
  const site = new URL(
    args.find((arg) => arg.startsWith('--site='))?.slice(7) ||
      'https://toil.fyi',
  ).origin;
  const ids = idsArg
    ? idsArg.slice(6).split(',')
    : readdirSync('output/flipbooks')
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -5));
  const token = process.env.BACKFILL_TOKEN;
  if (!dryRun && !wrangler && !token)
    throw new Error(
      'Use --wrangler or BACKFILL_TOKEN to update preset pointers; --dry-run performs no uploads.',
    );
  const catalog = new Map(
    (await loadAllCatalogEntries()).map((entry) => [entry.id, entry]),
  );
  for (const id of ids) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id))
      throw new Error('Invalid preset id.');
    const entry = catalog.get(id);
    if (
      !entry?.file?.startsWith('/milkdrop-presets/') ||
      entry.file.includes('..') ||
      !entry.file.endsWith('.milk')
    )
      throw new Error(`No bundled source for ${id}.`);
    const data = await Bun.file(`output/flipbooks/${id}.json`).json();
    if (
      data.presetId !== id ||
      typeof data.title !== 'string' ||
      !data.title.trim() ||
      data.title.length > 160
    )
      throw new Error(`Invalid preview identity for ${id}.`);
    const clip = validateFlipbook(data.clip);
    // Apply the same flash rejection before making any publication request.
    encodeFlipbookGif(clip);
    const source = await Bun.file(
      resolve('public', entry.file.slice(1)),
    ).text();
    if (new TextEncoder().encode(source).length > 128_000)
      throw new Error(`Source exceeds the sharing budget for ${id}.`);
    const body = { title: data.title, presetId: id, source, clip };
    const hash = await sha256(JSON.stringify(body));
    if (!dryRun) {
      const existing = await fetch(`${site}/api/flipbooks/${hash}`);
      const ready = existing.ok && (await existing.json()).videoReady === true;
      if (!ready) {
        const response = await publishWithRetry(() =>
          fetch(`${site}/api/flipbooks/`, {
            method: 'POST',
            headers: { Origin: site, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
        const result = await response.json();
        if (!response.ok || result.id !== hash)
          throw new Error(
            `Publication failed for ${id} (${response.status}): ${result.error || 'unexpected identity'}`,
          );
      }
      const video = await fetch(`${site}/api/flipbooks/${hash}.mp4`, {
        method: 'HEAD',
      });
      if (
        !video.ok ||
        !video.headers.get('content-type')?.startsWith('video/mp4')
      )
        throw new Error(
          `The MP4 for ${id} is not ready; preset pointer was not updated.`,
        );
      const pointer = JSON.stringify({ id: hash });
      if (wrangler) {
        const folder = await mkdtemp(join(tmpdir(), 'stims-video-pointer-'));
        try {
          const file = join(folder, 'pointer.json');
          await Bun.write(file, pointer);
          const child = Bun.spawn(
            [
              'bunx',
              'wrangler',
              'r2',
              'object',
              'put',
              `stims-static/${presetFlipbookKey(id)}`,
              '--remote',
              '--file',
              file,
              '--content-type',
              'application/json',
            ],
            { stdout: 'pipe', stderr: 'pipe' },
          );
          const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          if (code !== 0)
            throw new Error(`Pointer upload failed: ${stderr || stdout}`);
        } finally {
          await rm(folder, { recursive: true, force: true });
        }
      } else {
        const base =
          process.env.UPLOAD_BASE ||
          'https://stims-embed-backfill.kanavj.workers.dev';
        const response = await fetch(
          `${base}/static/${encodeURIComponent(presetFlipbookKey(id))}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: pointer,
          },
        );
        if (!response.ok)
          throw new Error(
            `Pointer upload failed (${response.status}) for ${id}.`,
          );
      }
    }
    console.log(
      `${dryRun ? 'Prepared' : 'Published'} ${id}: ${clip.frames.length} frames, ${clip.frames.length * clip.delayMs} ms, ${hash}`,
    );
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
