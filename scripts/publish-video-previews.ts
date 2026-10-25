/**
 * Publishes harvested flipbooks to R2, committing each preset pointer last.
 *
 * Run generate:previews --flipbooks first. --dry-run validates and prepares
 * every asset without credentials or network writes. Otherwise BACKFILL_TOKEN
 * authorizes the existing stims-embed-backfill upload endpoint.
 *
 * Usage: bun run previews:publish-video -- --ids=shifter-curlique --dry-run
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  presetFlipbookKey,
  publishedFlipbook,
  sha256,
} from '../functions/shared/flipbook-store.ts';
import { encodeJpeg } from '../functions/shared/jpeg-encoder.ts';
import {
  decodePreviewFrame,
  encodeFlipbookGif,
  validateFlipbook,
} from '../src/js/utils/media/preview-flipbook.ts';
import { loadAllCatalogEntries } from './generate-thumbnails.ts';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const idsArg = args.find((arg) => arg.startsWith('--ids='));
  const ids = idsArg
    ? idsArg.slice(6).split(',')
    : readdirSync('output/flipbooks')
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -5));
  const token = process.env.BACKFILL_TOKEN;
  if (!dryRun && !token)
    throw new Error(
      'BACKFILL_TOKEN is required; --dry-run performs no uploads.',
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
      data.title.length > 160
    )
      throw new Error(`Invalid preview identity for ${id}.`);
    const clip = validateFlipbook(data.clip);
    const source = await Bun.file(
      resolve('public', entry.file.slice(1)),
    ).text();
    if (new TextEncoder().encode(source).length > 128_000)
      throw new Error(`Source exceeds the sharing budget for ${id}.`);
    const hash = await sha256(
      JSON.stringify({ title: data.title, presetId: id, source, clip }),
    );
    const record = publishedFlipbook(hash, data.title, id, source, clip);
    const assets: { key: string; type: string; body: string | Uint8Array }[] = [
      {
        key: `flipbooks/${hash}.gif`,
        type: 'image/gif',
        body: encodeFlipbookGif(clip),
      },
      {
        key: `flipbooks/${hash}.jpg`,
        type: 'image/jpeg',
        body: encodeJpeg(
          decodePreviewFrame(clip.frames[0]),
          clip.width,
          clip.height,
          80,
        ),
      },
      {
        key: `flipbooks/${hash}.json`,
        type: 'application/json',
        body: JSON.stringify(record),
      },
      {
        key: presetFlipbookKey(id),
        type: 'application/json',
        body: JSON.stringify({ id: hash }),
      },
    ];
    for (const asset of assets) {
      if (!dryRun) {
        const base =
          process.env.UPLOAD_BASE ||
          'https://stims-embed-backfill.kanavj.workers.dev';
        const response = await fetch(
          `${base}/static/${encodeURIComponent(asset.key)}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': asset.type,
            },
            body:
              typeof asset.body === 'string'
                ? asset.body
                : Uint8Array.from(asset.body).buffer,
          },
        );
        if (!response.ok)
          throw new Error(
            `Upload failed (${response.status}) for ${asset.key}.`,
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
