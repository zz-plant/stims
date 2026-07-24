import { buildGeneratePrompt } from '../../src/js/milkdrop/preset-prompt.ts';

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
      opts: {
        messages?: Array<{ role: string; content: string }>;
        image?: string;
        text?: string[];
      },
    ) => Promise<{ response?: string; data?: number[][] }>;
  };
  DB: D1Database;
}

const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const GENERATION_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';

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
    let imageBase64: string | undefined;

    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('image');
      if (file instanceof File) {
        const buffer = await file.arrayBuffer();
        imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      }
    } else {
      const body = (await request.json()) as { image: string };
      imageBase64 = body.image;
    }

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let description = '';

    if (env.AI) {
      const visionResult = await env.AI.run(VISION_MODEL, {
        messages: [
          {
            role: 'user',
            content:
              'Describe the visual characteristics of this image in under 3 sentences, focusing on colors, shapes, patterns, motion, and mood.',
          },
        ],
        image: imageBase64,
      });
      description = (visionResult.response || '').trim();
    } else {
      description = 'abstract geometric patterns with vibrant colors';
    }

    if (env.DB && env.AI && description) {
      try {
        const embResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [description],
        });
        const queryEmbedding = embResult.data?.[0];
        if (queryEmbedding) {
          const { results } = await env.DB.prepare(
            'SELECT preset_id, embedding FROM preset_embeddings',
          ).all<{ preset_id: string; embedding: string }>();

          for (const row of results) {
            const stored = JSON.parse(row.embedding) as number[];
            const score = cosineSimilarity(queryEmbedding, stored);
            if (score > 0.88) {
              return new Response(
                JSON.stringify({
                  description,
                  milkSource: `/* cached from: ${row.preset_id} */`,
                  cached: true,
                }),
                {
                  headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                  },
                },
              );
            }
          }
        }
      } catch {
        // Cache miss — proceed to generation
      }
    }

    let milkSource = '';

    if (env.AI) {
      const systemPrompt = buildGeneratePrompt(description, 'moderate');
      const userPrompt = `Generate a MilkDrop preset that: ${description}`;

      const genResult = await env.AI.run(GENERATION_MODEL, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const response = genResult.response || '';
      const startIdx = response.indexOf('[preset00]');
      if (startIdx >= 0) {
        milkSource = `[preset00]\n${response.slice(startIdx + 9).trim()}`;
      } else {
        milkSource = `[preset00]\n${response.trim()}`;
      }
    } else {
      milkSource =
        '[preset00]\nfRating=4.0\nfDecay=0.96\nnWaveMode=1\nfZoom=1.0\nfWarp=1.0\nfRot=0.0\n';
    }

    return new Response(JSON.stringify({ description, milkSource }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : 'Image-to-preset failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
