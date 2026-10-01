import { buildGeneratePrompt } from '../../src/js/milkdrop/preset-prompt.ts';
import { enforceAiRateLimit, type RateLimiter } from './_ai-guard.ts';

interface Env {
  AI: {
    run: (
      model: string,
      opts: {
        messages?: Array<{ role: string; content: string }>;
        image?: string;
      },
    ) => Promise<{ response?: string }>;
  };
  AI_RATE_LIMITER?: RateLimiter;
}

const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const GENERATION_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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

  const limited = await enforceAiRateLimit(request, env.AI_RATE_LIMITER);
  if (limited) return limited;

  try {
    let imageBase64: string | undefined;
    let guidance = '';

    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('image');
      if (file instanceof File) {
        const buffer = await file.arrayBuffer();
        imageBase64 = arrayBufferToBase64(buffer);
      }
      const guidanceField = formData.get('guidance');
      if (typeof guidanceField === 'string') {
        guidance = guidanceField;
      }
    } else {
      const body = (await request.json()) as {
        image: string;
        guidance?: string;
      };
      imageBase64 = body.image;
      guidance = typeof body.guidance === 'string' ? body.guidance : '';
    }
    guidance = guidance.trim().slice(0, 500);

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

    let milkSource = '';

    if (env.AI) {
      const combinedDescription = guidance
        ? `${description}\n\nAdditional user guidance: ${guidance}`
        : description;
      const systemPrompt = buildGeneratePrompt(combinedDescription, 'moderate');
      const userPrompt = `Generate a MilkDrop preset that: ${combinedDescription}`;

      const genResult = await env.AI.run(GENERATION_MODEL, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const response = genResult.response || '';
      const marker = '[preset00]';
      const startIdx = response.indexOf(marker);
      if (startIdx >= 0) {
        milkSource = `${marker}\n${response.slice(startIdx + marker.length).trim()}`;
      } else {
        milkSource = `${marker}\n${response.trim()}`;
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
