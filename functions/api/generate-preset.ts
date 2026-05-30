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

    const systemPrompt = buildSystemPrompt(complexity);
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
      milkSource = extractMilkSource(result.response);
    } else {
      milkSource = generateFallbackPreset(description);
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

function buildSystemPrompt(complexity: string): string {
  return `You are a MilkDrop preset equation generator.
Output ONLY the [preset00] section of a .milk file with key=value pairs.

Available functions: sin cos tan asin acos atan atan2 abs sqrt pow mod floor ceil sqr clamp step smoothstep log exp sigmoid sign frac rand if above below equal min max

Available audio registers: bass mid treb bass_att mid_att treb_att beat rms vol time frame

Set wave_mode (1-7) for visibility. Use q1-q8 for state. Set decay (0.95-0.99) for trails.

${complexity === 'simple' ? 'Use 5-10 fields. Avoid custom waves/shapes.' : 'You can use custom waves (wave_N_per_point_N) and shapes (shape_N_per_frame_N) for more complex visuals.'}

Do NOT include markdown, explanations, or code fences. Only the [preset00] section.`;
}

function extractMilkSource(response: string): string {
  if (response.includes('[preset00]')) {
    const start = response.indexOf('[preset00]');
    const end = response.indexOf('\n\n', start);
    const section =
      end > start ? response.slice(start, end + 1) : response.slice(start);
    return '[preset00]\n' + section.replace(/^\[preset00\]\n?/i, '');
  }
  return '[preset00]\n' + response.replace(/^[\s\S]*?(\w+)=/, '$1=');
}

function generateFallbackPreset(description: string): string {
  const lower = description.toLowerCase();
  const waveMode =
    lower.includes('blob') || lower.includes('circular')
      ? 7
      : lower.includes('wave') || lower.includes('flow')
        ? 1
        : 2;
  const zoom = lower.includes('zoom') || lower.includes('close') ? 1.5 : 1.0;
  const warpMod = lower.includes('warp') || lower.includes('bend') ? 2.0 : 1.0;
  const rot = lower.includes('spin') || lower.includes('rotate') ? 0.5 : 0.0;
  const bassReact =
    lower.includes('pulse') || lower.includes('beat') ? '0.5' : '0.2';

  return `[preset00]
fRating=4.0
fDecay=0.96
nWaveMode=${waveMode}
fWaveScale=1.2
fWaveAlpha=0.85
bAdditiveWaves=0
fZoom=${zoom}
fWarp=${warpMod}
fRot=${rot}
fGammaAdj=2.0
fSx=1.0
fSy=1.0
fCx=0.5
fCy=0.5
per_frame_1=decay=0.96;
per_frame_2=zoom=1.0+bass*${bassReact};
per_frame_3=rot=time*0.02;
`;
}
