import { describe, expect, test } from 'bun:test';
import { onRequest as refine } from '../../functions/api/refine-preset.ts';

const currentSource = '[preset00]\nfDecay=0.98\nfZoom=1.00';

function post(value: unknown): Request {
  return new Request('https://toil.fyi/api/refine-preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

function chatCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('refine preset endpoint', () => {
  test('reads hosted chat-completion output from the requested model', async () => {
    const models: string[] = [];
    const ai: WorkersAI = {
      run: async (model) => {
        models.push(model);
        return chatCompletion('<think>zoom</think>[preset00]\nfZoom=1.04');
      },
    };
    const response = await refine({
      request: post({
        currentSource,
        instruction: 'zoom in faster',
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
      }),
      env: { AI: ai },
    });
    expect(response.status).toBe(200);
    expect(models).toEqual(['@cf/qwen/qwen3-30b-a3b-fp8']);
    expect(await response.json()).toEqual({
      milkSource: '[preset00]\nfZoom=1.04',
    });
  });

  test('reads hosted chat-completion output for explanations', async () => {
    const ai: WorkersAI = {
      run: async () => chatCompletion(' Slow blue tunnel. '),
    };
    const response = await refine({
      request: post({ currentSource, instruction: 'Explain this preset' }),
      env: { AI: ai },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      explanation: 'Slow blue tunnel.',
      milkSource: currentSource,
    });
  });

  test('keeps reading legacy text output', async () => {
    const ai: WorkersAI = {
      run: async () => ({ response: '```\n[preset00]\nfDecay=0.9\n```' }),
    };
    const response = await refine({
      request: post({ currentSource, instruction: 'shorter trails' }),
      env: { AI: ai },
    });
    expect(await response.json()).toEqual({
      milkSource: '[preset00]\nfDecay=0.9',
    });
  });

  test('reports empty model output instead of returning a blank preset', async () => {
    const ai: WorkersAI = { run: async () => chatCompletion('   ') };
    const response = await refine({
      request: post({ currentSource, instruction: 'brighter' }),
      env: { AI: ai },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Model returned no output.',
    });
  });
});
