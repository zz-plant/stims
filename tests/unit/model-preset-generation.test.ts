import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { onRequest as generatePresetRequest } from '../../functions/api/generate-preset.ts';
import { SynthesizePanel } from '../../src/js/frontend/SynthesizePanel.tsx';
import {
  generatePreset,
  generatePresetFromImage,
} from '../../src/js/milkdrop/preset-generator.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

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

  test('keeps provider capability visible in the rendered panel', () => {
    // Renders the real panel through the workspace harness instead of
    // grepping its source. The template-synthesizer ban that used to live
    // here as a text assertion is covered by the generation tests above:
    // every route goes through generatePreset/generatePresetFromImage, whose
    // fetch calls these tests intercept and inspect.
    const rendered = renderWorkspace(createElement(SynthesizePanel));
    try {
      expect(rendered.text()).toContain('Hosted model');
      expect(rendered.text()).toContain('Local Ollama');
    } finally {
      rendered.dispose();
    }
  });

  test('generates a compiled preset from an image via the hosted route', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        description: 'a violet nebula over dark water',
        milkSource: validMilkSource,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const compiled = await generatePresetFromImage('aGVsbG8=');

    expect(compiled.source.raw).toBe(validMilkSource.trim());
    expect(compiled.source.title).toBe(
      'AI (image): a violet nebula over dark water',
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/image-to-preset');
    expect(JSON.parse(String(init.body))).toEqual({ image: 'aGVsbG8=' });
  });

  test('passes prompt guidance through to the image route', async () => {
    const fetchMock = mock(async () =>
      Response.json({ milkSource: validMilkSource }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generatePresetFromImage('aGVsbG8=', {
      guidance: 'neon rings\nColor palette: cyberpunk.',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      image: 'aGVsbG8=',
      guidance: 'neon rings\nColor palette: cyberpunk.',
    });
  });

  test('surfaces hosted image-route failures with a configuration hint', async () => {
    const fetchMock = mock(
      async () => new Response('not found', { status: 404 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(generatePresetFromImage('aGVsbG8=')).rejects.toThrow(
      /404.*image-to-preset endpoint/,
    );
  });

  test('surfaces the image field in the rendered panel', () => {
    const rendered = renderWorkspace(createElement(SynthesizePanel));
    try {
      expect(rendered.text()).toContain('Reference image');
      expect(
        rendered.container.querySelector('input[type="file"]'),
      ).not.toBeNull();
    } finally {
      rendered.dispose();
    }
  });
});
