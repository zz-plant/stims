/**
 * Preset Generator Service — orchestrates text-prompt-to-preset compilation, image-guided synthesis,
 * tournament candidate evaluation, and offline algorithmic template generation.
 */

import { compileMilkdropPresetSource } from './compiler.ts';
import { buildGeneratePrompt } from './preset-prompt.ts';
import {
  probePresetReactivity,
  type ReactivityProbeResult,
} from './reactivity-probe.ts';
import {
  countEquationLines,
  type SalvagedLine,
  salvageCompileMilkdropPreset,
} from './salvage-compile.ts';
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
    // 404/501/503 usually mean this deployment's preset-generation endpoint
    // or AI binding was never set up, not that the model is temporarily
    // down — self-hosters get a generic "unavailable" otherwise and have no
    // way to tell a deploy-time config gap from a real outage.
    const configHint =
      response.status === 404
        ? ' This deployment may not have the preset-generation endpoint configured.'
        : response.status === 501 || response.status === 503
          ? ' This deployment may be missing its AI model configuration.'
          : '';
    throw new Error(
      `Hosted model unavailable (${response.status})${detail ? `: ${detail}` : '.'}${configHint}`,
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
  let usedFallback = false;
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
      usedFallback = true;
    } else {
      throw error;
    }
  }

  const salvaged = salvageCompileMilkdropPreset(milkSource, {
    id: usedFallback ? `ai-fallback-${Date.now()}` : `ai-${Date.now()}`,
    title: usedFallback
      ? `AI (fallback): ${description}`
      : `AI: ${description}`,
    origin: 'generated',
  });

  if (!salvaged) {
    if (options.fallbackToTemplate) {
      const { synthesizeEELPreset, synthesizedPresetToMilkSource } =
        await import('./ai-preset-synthesizer.ts');
      const synthesized = synthesizeEELPreset({ prompt: description });
      const fallbackSource = synthesizedPresetToMilkSource(synthesized);
      return compileMilkdropPresetSource(fallbackSource, {
        id: `ai-fallback-${Date.now()}`,
        title: `AI (fallback): ${description}`,
        origin: 'generated',
      });
    }
    throw new Error(
      `Generated preset has compilation errors: ${describeCompileFailure(milkSource)}`,
    );
  }

  logSalvage(salvaged.dropped);
  return salvaged.compiled;
}

/** Re-compile just to render an error message; only called when salvage has
 * already given up, so the diagnostics are known to be non-empty. */
function describeCompileFailure(milkSource: string): string {
  const compiled = compileMilkdropPresetSource(milkSource, {
    id: 'ai-rejected',
    title: 'rejected generation',
    origin: 'generated',
  });
  return compiled.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => d.message)
    .join('; ');
}

function logSalvage(dropped: SalvagedLine[]): void {
  if (dropped.length === 0) return;
  console.debug(
    `[stims] generated preset salvaged: dropped ${dropped.length} equation line(s)`,
    dropped,
  );
}

type ImageGenerationResponse = {
  description?: string;
  milkSource?: string;
  cached?: boolean;
  cachedPresetId?: string;
};

export async function generatePresetFromImage(
  imageBase64: string,
  options: { apiEndpoint?: string; guidance?: string } = {},
): Promise<MilkdropCompiledPreset> {
  const endpoint = options.apiEndpoint || '/api/image-to-preset';
  const guidance = options.guidance?.trim();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        guidance ? { image: imageBase64, guidance } : { image: imageBase64 },
      ),
    });
  } catch {
    throw new Error(
      'The hosted model could not be reached. Try again later or generate from a text description.',
    );
  }

  if (!response.ok) {
    const detail = await responseError(response);
    const configHint =
      response.status === 404
        ? ' This deployment may not have the image-to-preset endpoint configured.'
        : response.status === 501 || response.status === 503
          ? ' This deployment may be missing its AI model configuration.'
          : '';
    throw new Error(
      `Hosted model unavailable (${response.status})${detail ? `: ${detail}` : '.'}${configHint}`,
    );
  }

  const data = (await response.json()) as ImageGenerationResponse;
  if (!data.milkSource) {
    throw new Error('The hosted model returned no preset source.');
  }
  const milkSource = extractMilkSource(data.milkSource);
  const summary = data.description?.trim().slice(0, 80);

  const salvaged = salvageCompileMilkdropPreset(milkSource, {
    id: `ai-image-${Date.now()}`,
    title: summary ? `AI (image): ${summary}` : 'AI (image)',
    origin: 'generated',
  });
  if (!salvaged) {
    throw new Error(
      `Generated preset has compilation errors: ${describeCompileFailure(milkSource)}`,
    );
  }

  logSalvage(salvaged.dropped);
  return salvaged.compiled;
}

export async function generatePresetQuick(
  description: string,
): Promise<MilkdropCompiledPreset> {
  return generatePreset(description, {
    model: '@cf/qwen/qwen3-30b-a3b-fp8',
    complexity: 'simple',
  });
}

export type TournamentCandidate = {
  compiled: MilkdropCompiledPreset;
  probe: ReactivityProbeResult;
  dropped: SalvagedLine[];
  score: number;
};

export type TournamentOutcome = {
  winner: MilkdropCompiledPreset;
  probe: ReactivityProbeResult;
  /** Candidates requested from the model. */
  attempted: number;
  /** Candidates that survived salvage compilation. */
  survivors: number;
  usedFallback: boolean;
};

const VERDICT_WEIGHT: Record<ReactivityProbeResult['verdict'], number> = {
  reactive: 200,
  // A probe that couldn't verify either way (e.g. VM step failed) is scored
  // above a confirmed static preset but below a confirmed reactive one —
  // "unproven" should not outrank "disproven audio response".
  unknown: 80,
  static: 0,
};

/**
 * Rank a generation candidate. Audio reactivity dominates (a static preset
 * never beats a reactive one on richness), probe strength and equation
 * count refine within a verdict tier, and every salvaged line costs a
 * little — a candidate that needed heavy repair should lose ties to one
 * that compiled clean.
 */
export function scoreGenerationCandidate(
  compiled: MilkdropCompiledPreset,
  probe: ReactivityProbeResult,
  droppedCount: number,
): number {
  return (
    VERDICT_WEIGHT[probe.verdict] +
    Math.min(Math.max(probe.score, 0), 1) * 50 +
    Math.min(countEquationLines(compiled.source.raw), 40) -
    droppedCount * 5
  );
}

function stashTournament(entries: Array<Record<string, unknown>>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      'stims:generation-tournament',
      JSON.stringify(entries),
    );
  } catch {
    // Stash is diagnostics-only; storage being full or denied is fine.
  }
}

/**
 * Generation as selection instead of a single graded attempt: request
 * several candidates concurrently, salvage-compile each, score the
 * survivors on audio reactivity and richness, and load the winner. Broken
 * or static candidates lose the tournament instead of surfacing errors.
 * Every candidate (including losers and rejects) is stashed in
 * sessionStorage under `stims:generation-tournament` for diagnosis.
 */
export async function generatePresetTournament(
  description: string,
  options: GeneratePresetOptions & { candidateCount?: number } = {},
): Promise<TournamentOutcome> {
  const provider = options.provider ?? {
    kind: 'hosted' as const,
    endpoint: options.apiEndpoint,
    model: options.model,
  };
  // Local models process requests serially, so extra candidates cost the
  // user linear wall-clock time; the hosted endpoint fans out.
  const attempted =
    options.candidateCount ?? (provider.kind === 'openai-compatible' ? 2 : 3);

  const requests = Array.from({ length: attempted }, () =>
    provider.kind === 'openai-compatible'
      ? requestOpenAiCompatiblePreset(description, options, provider)
      : requestHostedPreset(description, options, provider),
  );
  const settled = await Promise.allSettled(requests);

  const stash: Array<Record<string, unknown>> = [];
  const candidates: TournamentCandidate[] = [];
  const failures: string[] = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === 'rejected') {
      const message = String(
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
      failures.push(message);
      stash.push({ index, status: 'request-failed', error: message });
      continue;
    }
    const milkSource = result.value;
    const salvaged = salvageCompileMilkdropPreset(milkSource, {
      id: `ai-${Date.now()}-${index}`,
      title: `AI: ${description}`,
      origin: 'generated',
    });
    if (!salvaged) {
      const error = describeCompileFailure(milkSource);
      failures.push(error);
      stash.push({ index, status: 'unsalvageable', error, source: milkSource });
      continue;
    }
    const probe = probePresetReactivity(salvaged.compiled, { verify: true });
    const score = scoreGenerationCandidate(
      salvaged.compiled,
      probe,
      salvaged.dropped.length,
    );
    candidates.push({
      compiled: salvaged.compiled,
      probe,
      score,
      dropped: salvaged.dropped,
    });
    stash.push({
      index,
      status: 'candidate',
      score,
      verdict: probe.verdict,
      droppedLines: salvaged.dropped.length,
      source: salvaged.compiled.source.raw,
    });
  }
  stashTournament(stash);

  if (candidates.length === 0) {
    if (options.fallbackToTemplate) {
      const { synthesizeEELPreset, synthesizedPresetToMilkSource } =
        await import('./ai-preset-synthesizer.ts');
      const synthesized = synthesizeEELPreset({ prompt: description });
      const winner = compileMilkdropPresetSource(
        synthesizedPresetToMilkSource(synthesized),
        {
          id: `ai-fallback-${Date.now()}`,
          title: `AI (fallback): ${description}`,
          origin: 'generated',
        },
      );
      return {
        winner,
        probe: probePresetReactivity(winner, { verify: true }),
        attempted,
        survivors: 0,
        usedFallback: true,
      };
    }
    throw new Error(
      `All ${attempted} generation attempts failed: ${failures.join(' | ')}`,
    );
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] as TournamentCandidate;
  logSalvage(best.dropped);
  console.debug(
    `[stims] generation tournament: ${candidates.length}/${attempted} candidates survived, ` +
      `winner ${best.probe.verdict} (score ${best.score.toFixed(1)})`,
  );
  return {
    winner: best.compiled,
    probe: best.probe,
    attempted,
    survivors: candidates.length,
    usedFallback: false,
  };
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
