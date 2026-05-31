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
    const { currentSource, instruction, history } = (await request.json()) as {
      currentSource: string;
      instruction: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!currentSource || !instruction) {
      return new Response('Missing currentSource or instruction', {
        status: 400,
      });
    }

    if (instruction.toLowerCase().startsWith('explain') || instruction.toLowerCase().startsWith('describe')) {
      const explainPrompt = `Explain this MilkDrop preset in 2-3 sentences, focusing on visual look, audio reactivity, and notable features. Preset source:\n${currentSource}`;

      if (env.AI) {
        const result = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
          messages: [{ role: 'user', content: explainPrompt }],
        });
        return new Response(
          JSON.stringify({
            explanation: result.response.trim(),
            milkSource: currentSource,
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

    const systemPrompt = `You are a MilkDrop preset editor. Given an existing preset and a refinement instruction, modify ONLY the requested aspects while keeping everything else unchanged.

Rules:
1. Return ONLY the complete [preset00] section
2. Only change what the instruction asks for
3. Keep all unchanged fields identical
4. Preserve the original structure and formatting
5. Do NOT add new wave/shape definitions unless asked
6. Do NOT include explanations or markdown
${history ? 'Previous refinements:\n' + history.map(h => `${h.role}: ${h.content}`).join('\n') : ''}`;

    const userPrompt = `Existing preset (active features: wave rendering, audio-reactive zoom, per-frame expressions):
${currentSource}

Instruction: ${instruction}

Return the complete modified preset. Keep all unchanged fields identical.`;

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
      milkSource = extractMilkSection(result.response);
    } else {
      return new Response(
        JSON.stringify({ error: 'AI binding not available' }),
        { status: 500 },
      );
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
        error: error instanceof Error ? error.message : 'Refinement failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

function extractMilkSection(response: string): string {
  let cleaned = response.replace(/```[\w]*\n?/g, '').trim();

  const start = cleaned.indexOf('[preset00]');
  if (start < 0) return cleaned;

  const after = cleaned.slice(start);
  const nextSection = after.slice('[preset00]'.length).match(/\n\[(\w+)\]/);
  const end = nextSection
    ? after.indexOf('\n[' + nextSection[1] + ']', '[preset00]'.length)
    : after.length;

  return after.slice(0, end).trim();
}
