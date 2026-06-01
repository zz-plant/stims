import { buildGeneratePrompt } from '../../assets/js/milkdrop/preset-prompt.ts';

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
        text?: string[];
      },
    ) => Promise<{ response?: string; data?: number[][] }>;
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

interface Classification {
  complexity: 'simple' | 'moderate' | 'complex';
  needsReasoning: boolean;
}

async function classify(
  description: string,
  ai: Env['AI'],
): Promise<Classification> {
  const classification: Classification = {
    complexity: 'simple',
    needsReasoning: false,
  };

  if (!ai || !description) return classification;

  try {
    const result = await ai.run('@cf/ibm-granite/granite-4.0-h-micro', {
      messages: [
        {
          role: 'system',
          content:
            'Classify this request. Output ONLY JSON: {"complexity":"simple|moderate|complex","needsReasoning":true|false}. Consider: under 6 words = simple, 6-15 = moderate, 15+ with technical terms = complex. Requests involving math, physics, patterns, multiple interactions = needsReasoning.',
        },
        { role: 'user', content: description },
      ],
    });
    try {
      const parsed = JSON.parse(
        (result.response || '').replace(/```json|```/g, '').trim(),
      );
      return {
        complexity: parsed.complexity || 'simple',
        needsReasoning: !!parsed.needsReasoning,
      };
    } catch {
      // fall through
    }
  } catch {
    // fall through
  }

  classification.complexity =
    description.split(' ').length > 10 ? 'moderate' : 'simple';
  return classification;
}

function selectModel(_task: string, c: Classification): string {
  if (!c.needsReasoning && c.complexity === 'moderate') {
    return '@cf/qwen/qwen3-30b-a3b-fp8';
  }
  if (c.needsReasoning) {
    return '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b';
  }
  if (c.complexity === 'complex') {
    return '@cf/qwen/qwen2.5-coder-32b-instruct';
  }
  return '@cf/qwen/qwen3-30b-a3b-fp8';
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
      complexity?: string;
      model?: string;
    };

    if (!body.description || body.description.length < 3) {
      return new Response('Description too short', { status: 400 });
    }

    if (env.DB && env.AI) {
      try {
        const embResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [body.description],
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
        // Cache miss or DB unavailable — proceed to generation
      }
    }

    const selectedModel =
      body.model ||
      (env.AI
        ? selectModel('generate', await classify(body.description, env.AI))
        : '@cf/meta/llama-4-scout-17b-16e-instruct');

    const systemPrompt = buildGeneratePrompt(
      body.description,
      body.complexity || 'moderate',
    );
    const userPrompt = `Generate a MilkDrop preset that: ${body.description}`;

    let milkSource = '';

    if (env.AI) {
      const result = await env.AI.run(selectedModel, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      const response = result.response || '';
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

    let title = 'AI Generated';
    if (env.AI) {
      try {
        const nameResult = await env.AI.run(
          '@cf/ibm-granite/granite-4.0-h-micro',
          {
            messages: [
              {
                role: 'system',
                content:
                  'Generate a short, evocative title (3-6 words) for this MilkDrop visualizer preset. Be creative. Output only the title.',
              },
              { role: 'user', content: milkSource.slice(0, 500) },
            ],
          },
        );
        title = (nameResult.response || '').trim().replace(/["']/g, '');
        if (title.length > 60) title = title.slice(0, 60);
      } catch {
        // Use fallback title
      }
    }

    return new Response(JSON.stringify({ milkSource, title }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Generation failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
