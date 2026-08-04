// Cron-triggered Worker: backfills preset embeddings into D1 + Vectorize.
// Replaces the manual `scripts/embed-preset-catalog.ts` run.
// Deploy: wrangler deploy --config wrangler.cron.jsonc

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<void>;
}
interface VectorizeIndex {
  insert(vectors: Array<{ id: string; values: number[] }>): Promise<void>;
  query(
    vector: number[],
    options?: { topK?: number },
  ): Promise<{ matches: Array<{ id: string; score: number }> }>;
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
  ASSET_URL?: string;
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
const BATCH_SIZE = 25;

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
    await env.VECTOR_INDEX.insert([{ id: presetId, values: embedding }]);
  }
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

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const result = await backfill(env);
      return new Response(JSON.stringify(result), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
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
