import { buildGeneratePrompt } from '../../assets/js/milkdrop/preset-prompt.ts';

interface Env {
  AI: {
    run: (
      model: string,
      opts: {
        messages: Array<{ role: string; content: string }>;
        image?: string;
      },
    ) => Promise<{ response: string }>;
  };
}

export async function onRequest(context: {
  request: Request;
  env: Env;
}) {
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
    const { image } = (await request.json()) as { image: string };

    if (!image) {
      return new Response('image is required', { status: 400 });
    }

    let description = '';

    if (env.AI) {
      const visionResult = await env.AI.run(
        '@cf/meta/llama-4-scout-17b-16e-instruct',
        {
          messages: [
            {
              role: 'user',
              content:
                'Describe the visual characteristics of this image in under 3 sentences, focusing on colors, shapes, patterns, motion, and mood.',
            },
          ],
          image,
        },
      );
      description = visionResult.response.trim();
    } else {
      description = 'abstract geometric patterns with vibrant colors';
    }

    let milkSource = '';

    if (env.AI) {
      const systemPrompt = buildGeneratePrompt(description, 'moderate');
      const userPrompt = `Generate a MilkDrop preset that: ${description}`;

      const genResult = await env.AI.run(
        '@cf/meta/llama-4-scout-17b-16e-instruct',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
      );

      const response = genResult.response;
      const startIdx = response.indexOf('[preset00]');
      if (startIdx >= 0) {
        milkSource = '[preset00]\n' + response.slice(startIdx + 9).trim();
      } else {
        milkSource = '[preset00]\n' + response.trim();
      }
    } else {
      milkSource =
        '[preset00]\nfRating=4.0\nfDecay=0.96\nnWaveMode=1\nfZoom=1.0\nfWarp=1.0\nfRot=0.0\n';
    }

    return new Response(
      JSON.stringify({ description, milkSource }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Image-to-preset failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
