interface Env {
  AI: {
    run: (model: string, opts: { messages: Array<{ role: string; content: string }> }) => Promise<{ response: string }>;
  };
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { sourceA, sourceB, instruction } = (await request.json()) as {
      sourceA: string;
      sourceB: string;
      instruction?: string;
    };

    const defaultInstruction =
      instruction ||
      'blend the wave patterns and motion from preset A with the color scheme and atmosphere of preset B';

    if (env.AI) {
      const result = await env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct', {
        messages: [
          {
            role: 'system',
            content: `You are a MilkDrop preset blender. Given two presets and an instruction, create a single unified preset.

Rules:
1. Return ONLY the complete [preset00] section
2. ${defaultInstruction}
3. Keep the combined preset coherent \u2014 don't just concatenate
4. The result should feel like a single creative vision, not two pasted together
5. No markdown, no explanations`,
          },
          {
            role: 'user',
            content: `Preset A (wave/motion source):
${sourceA}

Preset B (color/atmosphere source):
${sourceB}

Instruction: ${defaultInstruction}`,
          },
        ],
      });

      return json({ milkSource: cleanSource(result.response) });
    }

    return json({ error: 'AI binding not available' }, 500);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Blend failed' },
      500,
    );
  }
}

function cleanSource(raw: string): string {
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
