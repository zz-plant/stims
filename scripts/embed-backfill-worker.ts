// Cron-triggered Worker: backfills preset embeddings into D1 + Vectorize.
// Deploy: wrangler deploy --config wrangler.cron.jsonc

import { toVectorizeId } from '../src/js/milkdrop/vectorize-id.ts';

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<void>;
}

interface VectorizeIndex {
  upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, string>;
    }>,
  ): Promise<void>;
  query(
    vector: number[],
    options?: { topK?: number },
  ): Promise<{ matches: Array<{ id: string; score: number }> }>;
}

interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

interface Env {
  AI: {
    run: (
      model: string,
      opts: { text: string[] },
    ) => Promise<{ data: number[][] }>;
  };
  DB: D1Database;
  VECTOR_INDEX?: VectorizeIndex;
  STATIC_R2?: R2Bucket;
  ASSET_URL?: string;
  BACKFILL_TOKEN?: string;
}

// Cloudflare Workers runtime types
interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const CATALOG_URL = 'https://toil.fyi/milkdrop-presets/catalog.json';
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
// Per-run cap. Each preset costs ~3 subrequests (AI + D1 + Vectorize), so 100
// stays well inside the 1000-subrequest budget while clearing a multi-thousand
// preset catalog within a day at the 15-minute cron cadence.
const BATCH_SIZE = 100;
// Rows per invocation when mirroring existing D1 embeddings into Vectorize.
const SYNC_PAGE_SIZE = 500;
const VECTORIZE_UPSERT_CHUNK = 100;

interface CatalogEntry {
  id: string;
  title: string;
  author?: string;
  tags?: string[];
}

interface CatalogDocument {
  presets?: CatalogEntry[];
}

function describePreset(entry: CatalogEntry): string {
  const parts: string[] = [];
  parts.push(`Preset titled "${entry.title}"`);
  if (entry.author) {
    parts.push(`by ${entry.author}`);
  }
  if (entry.tags && entry.tags.length > 0) {
    const moodTags = entry.tags.filter(
      (t) =>
        !t.startsWith('collection:') &&
        !t.startsWith('source:') &&
        t !== 'preset',
    );
    if (moodTags.length > 0) {
      parts.push(`described as ${moodTags.join(', ')}`);
    }
  }
  return parts.join(', ');
}

async function fetchCatalog(env: Env): Promise<CatalogEntry[]> {
  const url = env.ASSET_URL ?? CATALOG_URL;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog: ${response.status}`);
  }
  const doc = (await response.json()) as CatalogDocument | CatalogEntry[];
  return Array.isArray(doc) ? doc : (doc.presets ?? []);
}

async function getExistingIds(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    'SELECT preset_id FROM preset_embeddings',
  ).all<{ preset_id: string }>();
  return new Set(results.map((r) => r.preset_id));
}

async function embedDescription(
  env: Env,
  description: string,
): Promise<number[]> {
  const result = await env.AI.run(EMBED_MODEL, { text: [description] });
  return result.data[0];
}

async function storeEmbedding(
  env: Env,
  presetId: string,
  embedding: number[],
  description: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO preset_embeddings (preset_id, embedding, description)
     VALUES (?, ?, ?)`,
  )
    .bind(presetId, JSON.stringify(embedding), description)
    .run();

  if (env.VECTOR_INDEX) {
    await env.VECTOR_INDEX.upsert([
      {
        id: toVectorizeId(presetId),
        values: embedding,
        metadata: { presetId },
      },
    ]);
  }
}

// One-time/idempotent migration: mirror embeddings already stored in D1 into
// Vectorize. Pages through `preset_embeddings`; callers re-POST with the
// returned nextOffset until done=true.
async function syncVectorize(
  env: Env,
  offset: number,
): Promise<{ synced: number; nextOffset: number; done: boolean }> {
  if (!env.VECTOR_INDEX) {
    throw new Error('VECTOR_INDEX binding is not configured');
  }

  const { results } = await env.DB.prepare(
    'SELECT preset_id, embedding FROM preset_embeddings ORDER BY preset_id LIMIT ?1 OFFSET ?2',
  )
    .bind(SYNC_PAGE_SIZE, offset)
    .all<{ preset_id: string; embedding: string }>();

  let synced = 0;
  for (let i = 0; i < results.length; i += VECTORIZE_UPSERT_CHUNK) {
    const chunk = results.slice(i, i + VECTORIZE_UPSERT_CHUNK).map((row) => ({
      id: toVectorizeId(row.preset_id),
      values: JSON.parse(row.embedding) as number[],
      metadata: { presetId: row.preset_id },
    }));
    await env.VECTOR_INDEX.upsert(chunk);
    synced += chunk.length;
  }

  return {
    synced,
    nextOffset: offset + results.length,
    done: results.length < SYNC_PAGE_SIZE,
  };
}

async function backfill(env: Env): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}> {
  const catalog = await fetchCatalog(env);
  const existing = await getExistingIds(env);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  for (const entry of catalog) {
    if (processed >= BATCH_SIZE) break;

    if (existing.has(entry.id)) {
      skipped++;
      continue;
    }

    processed++;
    try {
      const description = describePreset(entry);
      const embedding = await embedDescription(env, description);
      await storeEmbedding(env, entry.id, embedding, description);
      succeeded++;
    } catch (error) {
      failed++;
      console.error(
        `FAIL: ${entry.id} - ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return {
    total: catalog.length,
    succeeded,
    failed,
    skipped,
  };
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      backfill(env).then((result) => {
        console.log(
          `[embed-backfill] total=${result.total} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped}`,
        );
      }),
    );
  },

  // Manual trigger. Requires `Authorization: Bearer <BACKFILL_TOKEN>` so the
  // public workers.dev URL can't be used to burn AI neurons; the cron path
  // above does the routine work.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST' && request.method !== 'PUT') {
      return new Response('Method not allowed', { status: 405 });
    }

    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!env.BACKFILL_TOKEN || token !== env.BACKFILL_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }

    // PUT /static/<key> — streams the body into the static-assets bucket.
    // Used by scripts/sync-previews-r2.ts to publish preset previews.
    if (request.method === 'PUT') {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/static/')) {
        return new Response('Not found', { status: 404 });
      }
      if (!env.STATIC_R2) {
        return new Response('STATIC_R2 binding is not configured', {
          status: 500,
        });
      }
      const key = decodeURIComponent(url.pathname.slice('/static/'.length));
      if (!key || key.includes('..')) {
        return new Response('Invalid key', { status: 400 });
      }
      await env.STATIC_R2.put(key, request.body, {
        httpMetadata: {
          contentType:
            request.headers.get('content-type') || 'application/octet-stream',
        },
      });
      return new Response(JSON.stringify({ ok: true, key }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const url = new URL(request.url);
      if (url.searchParams.get('mode') === 'sync-vectorize') {
        const offset = Number.parseInt(
          url.searchParams.get('offset') || '0',
          10,
        );
        const result = await syncVectorize(env, offset);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await backfill(env);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Backfill failed',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  },
};
