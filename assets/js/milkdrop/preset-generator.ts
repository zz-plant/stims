import { compileMilkdropPresetSource } from './compiler.ts';
import { buildGeneratePrompt } from './preset-prompt.ts';
import type { MilkdropCompiledPreset } from './types.ts';

export type GenerateStatus =
  | { status: 'generating' }
  | { status: 'compiling' }
  | { status: 'ready'; preset: MilkdropCompiledPreset }
  | { status: 'error'; message: string };

export async function generatePreset(
  description: string,
  options: {
    complexity?: 'simple' | 'moderate' | 'complex';
    apiEndpoint?: string;
    model?: string;
  } = {},
): Promise<MilkdropCompiledPreset> {
  const endpoint = options.apiEndpoint || '/api/generate-preset';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description,
      complexity: options.complexity || 'moderate',
      model: options.model,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Generator API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    milkSource: string;
    cached?: boolean;
  };

  const compiled = compileMilkdropPresetSource(data.milkSource, {
    id: `ai-${Date.now()}`,
    title: `AI: ${description}`,
    origin: 'generated',
  });

  if (compiled.diagnostics.filter((d) => d.severity === 'error').length > 0) {
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
