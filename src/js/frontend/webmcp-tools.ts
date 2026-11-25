/**
 * WebMCP: the page's own tools, offered to an AI agent running in the
 * visitor's browser (https://webmachinelearning.github.io/webmcp/).
 *
 * Four tools: search the catalog, play a preset, skip to another, and say
 * what is on stage. Each one is a thin wrapper over `window.__stims_agent`
 * (looked up when the tool runs, so it survives the global being reinstalled)
 * plus the catalog the browse panel searches. The validation, did-you-mean
 * suggestions and settle wait therefore stay in agent-state.ts, and the tools
 * cannot drift from what `bun run ctl` and the MCP server see.
 *
 * The API ships behind Chrome's early preview. Chrome's preview put it on
 * `navigator.modelContext`, the spec puts it on `document.modelContext`, and
 * this reads either. A browser with neither gets nothing registered.
 */
import type { AgentGlobal } from './agent-state.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { createFieldMatcher } from './preset-matching.ts';
import { scorePresetEntry } from './workspace-helpers.ts';

/** The tool shape both the spec and Chrome's preview accept. */
export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface WebMcpModelContext {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => unknown;
  /** Chrome's preview only; the spec unregisters through the signal. */
  unregisterTool?: (name: string) => void;
}

export interface WebMcpProviders {
  getAgent: () => AgentGlobal | undefined;
  getCatalog: () => readonly PresetCatalogEntry[];
  /** Absolute URL that opens a preset, for search results. */
  presetUrl: (presetId: string) => string;
}

const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 25;

export function findModelContext(): WebMcpModelContext | null {
  const candidates: unknown[] = [
    (navigator as { modelContext?: unknown }).modelContext,
    (document as { modelContext?: unknown }).modelContext,
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof (candidate as WebMcpModelContext).registerTool === 'function'
    ) {
      return candidate as WebMcpModelContext;
    }
  }
  return null;
}

function notReady(): { ok: false; error: string } {
  return {
    ok: false,
    error: 'The visualizer is still starting. Try again in a moment.',
  };
}

function nowPlaying(agent: AgentGlobal) {
  const state = agent.getState();
  return {
    presetId: state.presetId,
    title: state.presetTitle,
    author: state.presetAuthor,
    // 'live' means the stage is rendering to audio; before that a selected
    // preset waits for the visitor to pick a sound source.
    stage: state.engineState,
    audioSource: state.audioSource,
    paused: state.playbackPaused,
    backend: state.backend,
    catalogSize: state.catalogSize,
  };
}

/** How long play/skip wait for the stage to show the new preset. */
const STAGE_CHANGE_TIMEOUT_MS = 8000;

/**
 * Run a preset-changing verb and report what the stage shows afterwards.
 *
 * `run()` settles on the shell's commit, about a second before the runtime
 * has the new preset on stage, so reading the stage straight away named the
 * old one. Before the stage is live there is nothing to wait for: the shell
 * queues the choice in the URL and plays it once the visitor starts audio.
 */
async function changePreset(
  agent: AgentGlobal,
  actionId: string,
  params?: Record<string, unknown>,
) {
  const before = agent.getState();
  const result = await agent.run(actionId, params);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      ...(result.suggestions ? { suggestions: result.suggestions } : {}),
    };
  }
  if (before.engineState !== 'live') {
    return {
      ok: true,
      queued: true,
      note: 'The stage is not live yet; the preset plays once the visitor starts an audio source.',
    };
  }
  const target = typeof params?.id === 'string' ? params.id : null;
  if (target !== before.presetId) {
    try {
      await agent.waitFor(
        (state) =>
          target
            ? state.presetId === target
            : state.presetId !== before.presetId,
        STAGE_CHANGE_TIMEOUT_MS,
      );
    } catch {
      return { ok: true, loading: true, nowPlaying: nowPlaying(agent) };
    }
  }
  return { ok: true, nowPlaying: nowPlaying(agent) };
}

export function searchCatalog(
  catalog: readonly PresetCatalogEntry[],
  query: string,
  limit: number,
): PresetCatalogEntry[] {
  const matcher = createFieldMatcher(query);
  const scored: Array<{ entry: PresetCatalogEntry; score: number }> = [];
  for (const entry of catalog) {
    const score = scorePresetEntry(entry, matcher);
    if (score !== null) scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.entry.curatedRank ?? Number.POSITIVE_INFINITY) -
        (b.entry.curatedRank ?? Number.POSITIVE_INFINITY),
  );
  return scored.slice(0, limit).map(({ entry }) => entry);
}

export function buildWebMcpTools(providers: WebMcpProviders): WebMcpTool[] {
  return [
    {
      name: 'search_presets',
      description:
        'Search the MilkDrop preset catalog by title, author, tag or mood words ("neon tunnel", "geiss"). Returns preset ids to pass to play_preset.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Words to match; every word must match something.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: SEARCH_MAX_LIMIT,
            description: `How many results to return (default ${SEARCH_DEFAULT_LIMIT}).`,
          },
        },
        required: ['query'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const query = typeof input.query === 'string' ? input.query : '';
        if (!query.trim()) {
          return { ok: false, error: 'query must be a non-empty string.' };
        }
        const catalog = providers.getCatalog();
        if (catalog.length === 0) return notReady();
        const requested = Number(input.limit);
        const limit = Number.isInteger(requested)
          ? Math.min(Math.max(requested, 1), SEARCH_MAX_LIMIT)
          : SEARCH_DEFAULT_LIMIT;
        const results = searchCatalog(catalog, query, limit);
        return {
          ok: true,
          total: results.length,
          results: results.map((entry) => ({
            id: entry.id,
            title: entry.title,
            author: entry.author ?? null,
            tags: entry.tags ?? [],
            url: providers.presetUrl(entry.id),
          })),
        };
      },
    },
    {
      name: 'play_preset',
      description:
        'Put a catalog preset on the stage by id (from search_presets). If no audio source is running yet, it plays once the visitor picks one.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A catalog preset id.' },
        },
        required: ['id'],
      },
      execute: async (input) => {
        const agent = providers.getAgent();
        if (!agent) return notReady();
        const id = typeof input.id === 'string' ? input.id : '';
        return changePreset(agent, 'select-preset', { id });
      },
    },
    {
      name: 'skip_preset',
      description:
        'Move off the current preset: "next" plays a random preset, "previous" goes back to the one before.',
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['next', 'previous'] },
        },
        required: ['direction'],
      },
      execute: async (input) => {
        const agent = providers.getAgent();
        if (!agent) return notReady();
        if (input.direction !== 'next' && input.direction !== 'previous') {
          return {
            ok: false,
            error: 'direction must be "next" or "previous".',
          };
        }
        return changePreset(agent, `${input.direction}-preset`);
      },
    },
    {
      name: 'get_now_playing',
      description:
        'Report the preset on stage (id, title, author), whether the stage is live, the audio source and the rendering backend.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const agent = providers.getAgent();
        if (!agent) return notReady();
        return { ok: true, ...nowPlaying(agent) };
      },
    },
  ];
}

/**
 * Register every tool on `modelContext` until `signal` aborts. Returns the
 * names registered; empty when the browser has no WebMCP.
 */
export function registerWebMcpTools(
  providers: WebMcpProviders,
  signal: AbortSignal,
  modelContext: WebMcpModelContext | null = findModelContext(),
): string[] {
  if (!modelContext || signal.aborted) return [];
  const registered: string[] = [];
  for (const tool of buildWebMcpTools(providers)) {
    try {
      // The spec returns a promise that rejects on a duplicate name; the
      // preview throws. Neither should take the page down.
      const pending = modelContext.registerTool(tool, { signal });
      if (pending instanceof Promise) pending.catch(() => {});
      registered.push(tool.name);
    } catch {
      // Left unregistered; the other tools still go up.
    }
  }
  // Chrome's preview ignores the signal and unregisters by name instead.
  if (modelContext.unregisterTool) {
    const unregister = modelContext.unregisterTool.bind(modelContext);
    signal.addEventListener(
      'abort',
      () => {
        for (const name of registered) {
          try {
            unregister(name);
          } catch {
            // Already gone through the signal.
          }
        }
      },
      { once: true },
    );
  }
  return registered;
}
