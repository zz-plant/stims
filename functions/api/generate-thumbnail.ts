interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
  ): Promise<void>;
}

interface Env {
  AI: {
    run: (
      model: string,
      opts: { prompt: string },
    ) => Promise<{ image: ArrayBuffer; response?: unknown }>;
  };
  GALLERY_R2: R2Bucket;
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
    const { presetId, title, description } = (await request.json()) as {
      presetId: string;
      title: string;
      description: string;
    };

    if (!presetId || !title) {
      return new Response('presetId and title are required', { status: 400 });
    }

    const prompt = `Abstract music visualization scene: ${title}. ${description || ''} Stylized, psychedelic, trippy, colorful, geometric patterns, fractal shapes, neon lights.`.trim();

    let imageUrl = '';

    if (env.AI) {
      const result = await env.AI.run(
        '@cf/black-forest-labs/flux-1-schnell',
        { prompt },
      );

      const imageData = result.image;
      await env.GALLERY_R2.put(`thumbnails/${presetId}.webp`, imageData);

      imageUrl = `/r2/thumbnails/${presetId}.webp`;
    }

    return new Response(JSON.stringify({ imageUrl, presetId }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Thumbnail generation failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
