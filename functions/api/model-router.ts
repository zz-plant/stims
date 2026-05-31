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

interface Classification {
  complexity: 'simple' | 'moderate' | 'complex';
  needsReasoning: boolean;
}

interface RouterResult {
  model: string;
  tier: string;
  classification: Classification;
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
    const { description, task } = (await request.json()) as {
      description: string;
      task: 'generate' | 'refine' | 'explain' | 'vision';
      currentSource?: string;
    };

    if (task === 'vision') {
      return json({ model: '@cf/google/gemma-4-26b-a4b-it', tier: 'vision' });
    }

    let classification: Classification = {
      complexity: 'simple',
      needsReasoning: false,
    };

    if (env.AI && description?.length > 0) {
      try {
        const result = await env.AI.run(
          '@cf/ibm-granite/granite-4.0-h-micro',
          {
            messages: [
              {
                role: 'system',
                content:
                  'Classify this request. Output ONLY JSON: {"complexity":"simple|moderate|complex","needsReasoning":true|false}. Consider: under 6 words = simple, 6-15 = moderate, 15+ with technical terms = complex. Requests involving math, physics, patterns, multiple interactions = needsReasoning.',
              },
              { role: 'user', content: description },
            ],
          },
        );
        try {
          const parsed = JSON.parse(
            (result.response || '').replace(/```json|```/g, '').trim(),
          );
          classification = {
            complexity: parsed.complexity || 'simple',
            needsReasoning: !!parsed.needsReasoning,
          };
        } catch {
          classification.complexity =
            description.split(' ').length > 10 ? 'moderate' : 'simple';
        }
      } catch {
        classification.complexity =
          description.split(' ').length > 10 ? 'moderate' : 'simple';
      }
    }

    const { model, tier } = selectModel(task, classification);

    return json({
      model,
      tier,
      classification,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Router error' },
      500,
    );
  }
}

function selectModel(
  task: string,
  c: Classification,
): { model: string; tier: string } {
  switch (task) {
    case 'generate':
      if (c.needsReasoning) {
        return {
          model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
          tier: 'reasoning',
        };
      }
      if (c.complexity === 'complex') {
        return {
          model: '@cf/qwen/qwen2.5-coder-32b-instruct',
          tier: 'primary-coder',
        };
      }
      if (c.complexity === 'moderate') {
        return {
          model: '@cf/qwen/qwen3-30b-a3b-fp8',
          tier: 'small-moe',
        };
      }
      return {
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        tier: 'small-moe',
      };

    case 'refine':
      return {
        model: '@cf/meta/llama-4-scout-17b-16e-instruct',
        tier: 'primary',
      };

    case 'explain':
      return {
        model: '@cf/ibm-granite/granite-4.0-h-micro',
        tier: 'micro',
      };

    case 'vision':
      return {
        model: '@cf/google/gemma-4-26b-a4b-it',
        tier: 'vision',
      };

    default:
      return {
        model: '@cf/meta/llama-4-scout-17b-16e-instruct',
        tier: 'primary',
      };
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
