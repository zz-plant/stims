import { buildGeneratePrompt } from '../../assets/js/milkdrop/preset-prompt.ts';

interface Env {
  AI: {
    run: (
      model: string,
      opts: { messages: Array<{ role: string; content: string }> },
    ) => Promise<{ response: string }>;
  };
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
    const { description, complexity = 'moderate' } = (await request.json()) as {
      description: string;
      complexity?: string;
    };

    if (!description || description.length < 3) {
      return new Response('Description too short', { status: 400 });
    }

    const systemPrompt = buildGeneratePrompt(description, complexity);
    const userPrompt = `Generate a MilkDrop preset that: ${description}`;

    let milkSource = '';

    if (env.AI) {
      const result = await env.AI.run(
        '@cf/meta/llama-4-scout-17b-16e-instruct',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
      );
      const response = result.response;
      const startIdx = response.indexOf('[preset00]');
      if (startIdx >= 0) {
        milkSource = '[preset00]\n' + response.slice(startIdx + 9).trim();
      } else {
        milkSource = '[preset00]\n' + response.trim();
      }
    } else {
      milkSource = '[preset00]\nfRating=4.0\nfDecay=0.96\nnWaveMode=1\nfZoom=1.0\nfWarp=1.0\nfRot=0.0\n';
    }

    return new Response(JSON.stringify({ milkSource }), {
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
