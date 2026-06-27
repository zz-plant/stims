interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

interface Env {
  AI: {
    run: (
      model: string,
      opts: { text: string[] },
    ) => Promise<{ data: number[][] }>;
  };
  DB: D1Database;
}

type CachedEmbedding = {
  presetId: string;
  vector: Float32Array;
  norm: number;
};

let embeddingCache: CachedEmbedding[] | null = null;
let embeddingCacheTimestamp = 0;
const EMBEDDING_CACHE_TTL_MS = 60_000;
const MAX_EMBEDDINGS_SCAN = 5000;

async function loadEmbeddingCache(env: Env): Promise<CachedEmbedding[]> {
  if (
    embeddingCache &&
    Date.now() - embeddingCacheTimestamp < EMBEDDING_CACHE_TTL_MS
  ) {
    return embeddingCache;
  }

  const { results } = await env.DB.prepare(
    'SELECT preset_id, embedding FROM preset_embeddings LIMIT ?1',
  )
    .bind(MAX_EMBEDDINGS_SCAN)
    .all<{ preset_id: string; embedding: string }>();

  embeddingCache = results.map((row) => {
    const vector = new Float32Array(JSON.parse(row.embedding) as number[]);
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    return {
      presetId: row.preset_id,
      vector,
      norm: Math.sqrt(norm),
    };
  });
  embeddingCacheTimestamp = Date.now();
  return embeddingCache;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

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
    const body = (await request.json()) as {
      description: string;
      embedOnly?: boolean;
    };

    if (!body.description || body.description.length < 3) {
      return new Response('Description too short', { status: 400 });
    }

    let queryEmbedding: number[] = [];

    if (env.AI) {
      const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: [body.description],
      });
      queryEmbedding = result.data[0];
    }

    if (body.embedOnly) {
      return new Response(JSON.stringify({ embedding: queryEmbedding }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (!queryEmbedding.length) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const cache = await loadEmbeddingCache(env);
    const queryVec = new Float32Array(queryEmbedding);
    let queryNorm = 0;
    for (let i = 0; i < queryVec.length; i++) {
      queryNorm += queryVec[i] * queryVec[i];
    }
    queryNorm = Math.sqrt(queryNorm);

    if (queryNorm === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const scored: Array<{ presetId: string; score: number }> = [];
    for (let i = 0; i < cache.length; i++) {
      const entry = cache[i];
      if (!entry || entry.norm === 0) continue;
      const dot = dotProduct(queryVec, entry.vector);
      scored.push({
        presetId: entry.presetId,
        score: dot / (queryNorm * entry.norm),
      });
    }

    scored.sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({ results: scored.slice(0, 5) }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Search failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
