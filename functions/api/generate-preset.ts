import { buildGeneratePrompt } from '../../src/js/milkdrop/preset-prompt.ts';
import {
  allowedModelOrNull,
  enforceAiRateLimit,
} from './_ai-guard.ts';

interface Env {
  AI?: WorkersAI;
  AI_RATE_LIMITER?: RateLimiter;
}

interface Classification {
  complexity: 'simple' | 'moderate' | 'complex';
  needsReasoning: boolean;
}

async function classify(
  description: string,
  ai: NonNullable<Env['AI']>,
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
  if (c.needsReasoning || c.complexity === 'complex') {
    return '@cf/qwen/qwen2.5-coder-32b-instruct';
  }
  return '@cf/qwen/qwen3-30b-a3b-fp8';
}

function cleanModelOutput(raw: string): string {
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\w]*\n?/g, '')
    .trim();
  const startIdx = cleaned.indexOf('[preset00]');
  if (startIdx >= 0) {
    cleaned = `[preset00]\n${cleaned.slice(startIdx + 10).trim()}`;
  } else if (cleaned.length > 0) {
    cleaned = `[preset00]\n${cleaned}`;
  }
  return cleaned;
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

  if (!env.AI) {
    return new Response(
      JSON.stringify({
        error: 'Model inference is not available on this deployment.',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const limited = await enforceAiRateLimit(request, env.AI_RATE_LIMITER);
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      description: string;
      complexity?: string;
      model?: string;
    };

    if (!body.description || body.description.length < 3) {
      return new Response('Description too short', { status: 400 });
    }

    const selectedModel =
      allowedModelOrNull(body.model) ||
      selectModel('generate', await classify(body.description, env.AI));

    const systemPrompt = buildGeneratePrompt(
      body.description,
      body.complexity || 'moderate',
    );
    const userPrompt = `Generate a MilkDrop preset that: ${body.description}`;

    const result = await env.AI.run(selectedModel, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const rawResponse = result.response?.trim();
    if (!rawResponse) {
      return new Response(
        JSON.stringify({ error: 'Model returned no output.' }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    const milkSource = cleanModelOutput(rawResponse);
    if (!milkSource.includes('[preset00]')) {
      return new Response(
        JSON.stringify({
          error: 'Model output did not contain a [preset00] section.',
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    let title = 'AI Generated';
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
      // Keep the honest generic title when title generation is unavailable.
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
