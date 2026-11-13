import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, createElement } from 'react';
import { onRequest as generatePresetRequest } from '../../functions/api/generate-preset.ts';
import { SynthesizePanel } from '../../src/js/frontend/SynthesizePanel.tsx';
import {
  generatePreset,
  generatePresetFromImage,
  onDeviceModelAvailability,
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
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});

/**
 * Stands in for Chrome's `LanguageModel` (Prompt API): records what each call
 * was given, replays a download, and answers every prompt with `answer`.
 */
function fakeOnDeviceModel(availability: string, answer = validMilkSource) {
  const calls = {
    availability: [] as unknown[],
    create: [] as Array<Record<string, unknown>>,
    prompts: [] as string[],
    destroyed: 0,
  };
  (globalThis as { LanguageModel?: unknown }).LanguageModel = {
    availability: async (options: unknown) => {
      calls.availability.push(options);
      return availability;
    },
    create: async (options: { monitor?: (target: EventTarget) => void }) => {
      calls.create.push(options as Record<string, unknown>);
      // A bare listener registry: the test DOM's Event and EventTarget come
      // from different implementations and refuse each other.
      const listeners: Array<(event: { loaded: number }) => void> = [];
      options.monitor?.({
        addEventListener: (_type: string, listener: never) => {
          listeners.push(listener);
        },
      } as unknown as EventTarget);
      for (const listener of listeners) listener({ loaded: 0.5 });
      return {
        prompt: async (input: string) => {
          calls.prompts.push(input);
          return answer;
        },
        destroy: () => {
          calls.destroyed += 1;
        },
      };
    },
  };
  return calls;
}

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

  test('rejects the generic kind pointed at OpenRouter itself — only the named kind is allowed', async () => {
    // The allowlist is by provider kind, not by host: a user (or a bug)
    // routing the generic openai-compatible kind at openrouter.ai must
    // still hit the loopback rule.
    const fetchMock = mock();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generatePreset('private prompt', {
        provider: {
          kind: 'openai-compatible',
          endpoint: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4o-mini',
        },
      } as never),
    ).rejects.toThrow('loopback');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sends the OpenRouter key straight to openrouter.ai with the model', async () => {
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
          kind: 'openrouter',
          apiKey: 'sk-or-test',
          model: 'openai/gpt-4o-mini',
        },
      },
    );

    expect(compiled.source.raw).toBe(validMilkSource.trim());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-or-test',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'openai/gpt-4o-mini',
      stream: false,
    });
  });

  test('surfaces OpenRouter auth failures with a key hint', async () => {
    const fetchMock = mock(
      async () =>
        new Response(JSON.stringify({ error: 'Invalid API key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generatePreset('private prompt', {
        provider: {
          kind: 'openrouter',
          apiKey: 'sk-or-wrong',
          model: 'openai/gpt-4o-mini',
        },
      }),
    ).rejects.toThrow(/401.*OpenRouter API key/u);
  });

  test('generates on the device with the system prompt and never fetches', async () => {
    const fetchMock = mock();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const calls = fakeOnDeviceModel('downloadable');
    const progress: number[] = [];

    const compiled = await generatePreset('slow violet rings', {
      provider: {
        kind: 'on-device',
        onDownloadProgress: (fraction) => progress.push(fraction),
      },
    });

    expect(compiled.source.raw).toBe(validMilkSource.trim());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.create).toHaveLength(1);
    const created = calls.create[0] as {
      initialPrompts: Array<{ role: string; content: string }>;
      expectedInputs: unknown;
    };
    expect(created.initialPrompts).toHaveLength(1);
    expect(created.initialPrompts[0]?.role).toBe('system');
    expect(created.initialPrompts[0]?.content).toContain('[preset00]');
    expect(created.expectedInputs).toEqual([
      { type: 'text', languages: ['en'] },
    ]);
    expect(calls.prompts).toEqual([
      'Generate a MilkDrop preset that: slow violet rings',
    ]);
    expect(progress).toEqual([0.5]);
    expect(calls.destroyed).toBe(1);
  });

  test('releases the on-device session when the answer is not a preset', async () => {
    const calls = fakeOnDeviceModel('available', 'I cannot help with that.');
    await expect(
      generatePreset('anything', { provider: { kind: 'on-device' } }),
    ).rejects.toThrow('[preset00]');
    expect(calls.destroyed).toBe(1);
  });

  test('says why before trying when the device cannot run the model', async () => {
    const calls = fakeOnDeviceModel('unavailable');
    await expect(
      generatePreset('anything', { provider: { kind: 'on-device' } }),
    ).rejects.toThrow('16 GB of RAM');
    expect(calls.create).toHaveLength(0);
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    await expect(onDeviceModelAvailability()).resolves.toBe('unavailable');
  });

  test('offers on-device generation only where Chrome can run it', async () => {
    const withoutApi = renderWorkspace(createElement(SynthesizePanel));
    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(withoutApi.text()).not.toContain('On this device');
    } finally {
      withoutApi.dispose();
    }

    fakeOnDeviceModel('downloadable');
    const withApi = renderWorkspace(createElement(SynthesizePanel));
    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(withApi.text()).toContain('On this device');
    } finally {
      withApi.dispose();
    }
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
      expect(rendered.text()).toContain('OpenRouter');
    } finally {
      rendered.dispose();
    }
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

  test('shows OpenRouter key and consent copy when the stored provider is openrouter', () => {
    localStorage.setItem(
      'stims:synthesize-settings',
      JSON.stringify({
        provider: 'openrouter',
        openrouterApiKey: 'sk-or-stored',
        openrouterModel: 'openai/gpt-4o-mini',
      }),
    );
    const rendered = renderWorkspace(createElement(SynthesizePanel));
    try {
      const text = rendered.text();
      expect(text).toContain('OpenRouter API key');
      expect(text).toContain('Prompts and your key go to OpenRouter');
      const keyInput = rendered.container.querySelector(
        'input[type="password"]',
      ) as HTMLInputElement | null;
      expect(keyInput).not.toBeNull();
      expect(keyInput?.value).toBe('sk-or-stored');
    } finally {
      localStorage.removeItem('stims:synthesize-settings');
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
