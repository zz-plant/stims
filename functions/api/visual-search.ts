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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

    const { results } = await env.DB.prepare(
      'SELECT preset_id, embedding FROM preset_embeddings',
    ).all<{ preset_id: string; embedding: string }>();

    const scored = results
      .map((row) => {
        const storedEmbedding = JSON.parse(row.embedding) as number[];
        const score = queryEmbedding.length
          ? cosineSimilarity(queryEmbedding, storedEmbedding)
          : 0;
        return { presetId: row.preset_id, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return new Response(JSON.stringify({ results: scored }), {
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
