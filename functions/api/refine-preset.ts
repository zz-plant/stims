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
    const { currentSource, instruction } = (await request.json()) as {
      currentSource: string;
      instruction: string;
    };

    if (!currentSource || !instruction) {
      return new Response('Missing currentSource or instruction', {
        status: 400,
      });
    }

    const systemPrompt = `You are a MilkDrop preset editor. Given an existing preset and a refinement instruction, modify ONLY the requested aspects while keeping everything else unchanged.

Rules:
1. Return ONLY the complete [preset00] section
2. Only change what the instruction asks for
3. Keep all unchanged fields identical
4. Preserve the original structure and formatting
5. Do NOT add new wave/shape definitions unless asked
6. Do NOT include explanations or markdown`;

    const userPrompt = `Existing preset:
${currentSource}

Instruction: ${instruction}

Return the complete modified preset.`;

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
  if (response.includes('[preset00]')) {
    const start = response.indexOf('[preset00]');
    const rest = response.slice(start);
    const end = rest.indexOf('\n\n', '[preset00]'.length);
    return end > 0 ? rest.slice(0, end) : rest;
  }
  return response;
}
