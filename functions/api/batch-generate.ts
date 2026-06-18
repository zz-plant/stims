interface Env {
  AI: {
    run: (
      model: string,
      opts: { messages: Array<{ role: string; content: string }> },
    ) => Promise<{ response: string }>;
  };
  DB: unknown;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { description, count = 3 } = (await request.json()) as {
      description: string;
      count?: number;
    };

    const n = Math.min(Math.max(count, 1), 5);
    const results: string[] = [];

    if (env.AI) {
      const promises = Array.from({ length: n }, (_, i) => {
        const variationSeed =
          i === 0
            ? ''
            : `\nVariation seed: ${i + 1}/${n}. Make this noticeably different from the base style while keeping the same mood.`;
        return env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct', {
          messages: [
            {
              role: 'system',
              content:
                'Generate a complete [preset00] section for a MilkDrop visualizer preset. Output ONLY the .milk format with key=value pairs.\n\nRules:\n1. Set wave_mode (1-7) for visible output\n2. Use audio registers: bass, mid, treb, bass_att, mid_att, treb_att\n3. Set decay (0.94-0.99) for motion trails\n4. Set zoom, warp, rot for camera movement\n5. Include at least 2 per_frame equations\n6. No markdown, no explanations \u2014 just the [preset00] section',
            },
            {
              role: 'user',
              content: `Create a MilkDrop preset: ${description}${variationSeed}`,
            },
          ],
        });
      });

      const responses = await Promise.all(promises);
      results.push(
        ...responses.map((r: { response: string }) =>
          cleanMilkSource(r.response),
        ),
      );
    }

    return json({ presets: results });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Batch failed' },
      500,
    );
  }
}

function cleanMilkSource(raw: string): string {
  let s = raw.replace(/```[\w]*\n?/g, '').trim();
  if (!s.includes('[preset00]')) s = `[preset00]\n${s}`;
  return s;
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
