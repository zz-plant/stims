import { compileMilkdropPresetSource } from './compiler.ts';
import { buildGeneratePrompt } from './preset-prompt.ts';
import type { MilkdropCompiledPreset } from './types.ts';

export type GenerateStatus =
  | { status: 'generating' }
  | { status: 'compiling' }
  | { status: 'ready'; preset: MilkdropCompiledPreset }
  | { status: 'error'; message: string };

export type PresetGenerationProvider =
  | {
      kind: 'hosted';
      endpoint?: string;
      model?: string;
    }
  | {
      kind: 'openai-compatible';
      endpoint: string;
      model: string;
    };

export type GeneratePresetOptions = {
  complexity?: 'simple' | 'moderate' | 'complex';
  apiEndpoint?: string;
  model?: string;
  provider?: PresetGenerationProvider;
  fallbackToTemplate?: boolean;
};

type HostedGenerationResponse = {
  milkSource?: string;
  title?: string;
};

type OpenAiGenerationResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function extractMilkSource(content: string) {
  const cleaned = content.replace(/```(?:milkdrop|ini|text)?\s*/giu, '').trim();
  const presetStart = cleaned.indexOf('[preset00]');
  if (presetStart < 0) {
    throw new Error('The model response did not contain a [preset00] section.');
  }
  return cleaned.slice(presetStart).trim();
}

function getLoopbackChatEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('The local model endpoint must be a valid URL.');
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error(
      'Direct model requests are restricted to a loopback endpoint so prompts and credentials cannot be sent to an arbitrary host.',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The local model endpoint must use HTTP or HTTPS.');
  }

  url.pathname = `${url.pathname.replace(/\/$/u, '')}/chat/completions`;
  return url.href;
}

async function responseError(response: Response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error || body;
  } catch {
    return body;
  }
}

async function requestHostedPreset(
  description: string,
  options: GeneratePresetOptions,
  provider: Extract<PresetGenerationProvider, { kind: 'hosted' }>,
) {
  const endpoint =
    provider.endpoint || options.apiEndpoint || '/api/generate-preset';
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        complexity: options.complexity || 'moderate',
        model: provider.model || options.model,
      }),
    });
  } catch {
    throw new Error(
      'The hosted model could not be reached. Try again later or select Local Ollama.',
    );
  }

  if (!response.ok) {
    const detail = await responseError(response);
    throw new Error(
      `Hosted model unavailable (${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }

  const data = (await response.json()) as HostedGenerationResponse;
  if (!data.milkSource) {
    throw new Error('The hosted model returned no preset source.');
  }
  return extractMilkSource(data.milkSource);
}

async function requestOpenAiCompatiblePreset(
  description: string,
  options: GeneratePresetOptions,
  provider: Extract<PresetGenerationProvider, { kind: 'openai-compatible' }>,
) {
  const endpoint = getLoopbackChatEndpoint(provider.endpoint);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: 'system',
            content: buildGeneratePrompt(
              description,
              options.complexity || 'moderate',
            ),
          },
          {
            role: 'user',
            content: `Generate a MilkDrop preset that: ${description}`,
          },
        ],
        stream: false,
      }),
    });
  } catch {
    throw new Error(
      `Could not reach the local model at ${endpoint}. Start Ollama and allow this browser origin with OLLAMA_ORIGINS.`,
    );
  }

  if (!response.ok) {
    const detail = await responseError(response);
    throw new Error(
      `Local model unavailable (${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }

  const data = (await response.json()) as OpenAiGenerationResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('The local model returned no preset source.');
  }
  return extractMilkSource(content);
}

export async function generatePreset(
  description: string,
  options: GeneratePresetOptions = {},
): Promise<MilkdropCompiledPreset> {
  const provider = options.provider ?? {
    kind: 'hosted' as const,
    endpoint: options.apiEndpoint,
    model: options.model,
  };
  let milkSource: string;
  try {
    milkSource =
      provider.kind === 'openai-compatible'
        ? await requestOpenAiCompatiblePreset(description, options, provider)
        : await requestHostedPreset(description, options, provider);
  } catch (error) {
    if (options.fallbackToTemplate) {
      const { synthesizeEELPreset, synthesizedPresetToMilkSource } =
        await import('./ai-preset-synthesizer.ts');
      const synthesized = synthesizeEELPreset({ prompt: description });
      milkSource = synthesizedPresetToMilkSource(synthesized);
    } else {
      throw error;
    }
  }

  const compiled = compileMilkdropPresetSource(milkSource, {
    id: `ai-${Date.now()}`,
    title: `AI: ${description}`,
    origin: 'generated',
  });

  if (compiled.diagnostics.filter((d) => d.severity === 'error').length > 0) {
    if (options.fallbackToTemplate) {
      const { synthesizeEELPreset, synthesizedPresetToMilkSource } =
        await import('./ai-preset-synthesizer.ts');
      const synthesized = synthesizeEELPreset({ prompt: description });
      const fallbackSource = synthesizedPresetToMilkSource(synthesized);
      return compileMilkdropPresetSource(fallbackSource, {
        id: `ai-fallback-${Date.now()}`,
        title: `AI: ${description}`,
        origin: 'generated',
      });
    }
    throw new Error(
      `Generated preset has compilation errors: ${compiled.diagnostics.map((d) => d.message).join('; ')}`,
    );
  }

  return compiled;
}

export async function generatePresetQuick(
  description: string,
): Promise<MilkdropCompiledPreset> {
  return generatePreset(description, {
    model: '@cf/qwen/qwen3-30b-a3b-fp8',
    complexity: 'simple',
  });
}

export async function generatePresetQuality(
  description: string,
): Promise<MilkdropCompiledPreset> {
  return generatePreset(description, {
    model: '@cf/qwen/qwen2.5-coder-32b-instruct',
  });
}

export async function generatePresetCached(
  description: string,
): Promise<MilkdropCompiledPreset> {
  return generatePreset(description, {
    apiEndpoint: '/api/generate-preset',
  });
}

export async function generatePresetOnWorker(
  description: string,
  complexity: 'simple' | 'moderate' | 'complex' = 'moderate',
): Promise<MilkdropCompiledPreset> {
  buildGeneratePrompt(description, complexity);

  const response = await fetch('/api/generate-preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, complexity }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }

  const { milkSource } = (await response.json()) as { milkSource: string };

  const sourceMeta = {
    id: `ai-${Date.now()}`,
    title: `AI: ${description}`,
    origin: 'generated' as const,
  };
  const compiled = compileMilkdropPresetSource(milkSource, sourceMeta);

  return compiled;
}
