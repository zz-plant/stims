import { afterEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onRequest as generatePresetRequest } from '../../functions/api/generate-preset.ts';
import { generatePreset } from '../../src/js/milkdrop/preset-generator.ts';

const validMilkSource = `[preset00]
fRating=5.0
fDecay=0.98
nWaveMode=7
fZoom=1.02
per_frame_1=zoom=1.02+bass_att*0.02
per_pixel_1=zoom=(zoom-1)*rad+1
`;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('model-backed preset generation', () => {
  test('uses the selected loopback OpenAI-compatible model without an API key', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        choices: [{ message: { content: validMilkSource } }],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const compiled = await generatePreset(
      'slow violet rings responding to bass',
      {
        provider: {
          kind: 'openai-compatible',
          endpoint: 'http://127.0.0.1:11434/v1',
          model: 'gemma4:26b',
        },
      } as never,
    );

    expect(compiled.source.raw).toBe(validMilkSource.trim());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gemma4:26b',
      messages: [
        { role: 'system' },
        {
          role: 'user',
          content:
            'Generate a MilkDrop preset that: slow violet rings responding to bass',
        },
      ],
    });
  });

  test('rejects non-loopback direct model endpoints before sending a prompt', async () => {
    const fetchMock = mock();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generatePreset('private prompt', {
        provider: {
          kind: 'openai-compatible',
          endpoint: 'https://models.example.com/v1',
          model: 'example-model',
        },
      } as never),
    ).rejects.toThrow('loopback');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('reports the hosted generator as unavailable instead of returning a template', async () => {
    const response = await generatePresetRequest({
      request: new Request('https://toil.fyi/api/generate-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'glowing ocean pulse' }),
      }),
      env: {} as never,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Model inference is not available on this deployment.',
    });
  });

  test('keeps provider capability visible and never calls the template synthesizer', () => {
    const panelSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src/js/frontend/SynthesizePanel.tsx'),
      'utf8',
    );

    expect(panelSource).not.toContain('synthesizeEELPreset');
    expect(panelSource).toContain('Hosted model');
    expect(panelSource).toContain('Local Ollama');
  });
});
