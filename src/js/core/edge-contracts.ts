/**
 * Runtime-validated contracts for the Cloudflare edge API (`functions/api/*`).
 *
 * Two directions, two different tools — deliberately:
 *
 * - **Responses we receive** are untrusted input (a stale deployment, a proxy
 *   that rewrote the body, an error page served as JSON). Those get a runtime
 *   `parse`/`safeParse` at the boundary, replacing the `as` casts that used to
 *   assert a shape nobody checked.
 * - **Payloads we send**, and responses the worker itself builds, are our own
 *   data. Those get compile-time `satisfies` against the inferred type — the
 *   drift is caught by `bun run typecheck`, with no runtime cost on an edge
 *   hot path and no new way for a request to fail.
 *
 * Lives in `core/` rather than `frontend/` because the consumers do: the
 * visual-search and telemetry callers are `src/js/core/services/*`, and
 * `scripts/check-architecture.ts` forbids `core` importing from `frontend`.
 *
 * These used to be zod schemas. zod reached the client boot bundle through
 * sync-session (edge-contracts → SyncRoomCreateResponseSchema) and pulled
 * ~350 KB of minified code into `vendor-other` to validate five small shapes.
 * The validators below expose the same `parse`/`safeParse` surface and
 * inferred types as the schemas they replace, so the client and the edge keep
 * one source of truth with no runtime dependency.
 */

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error };

interface ContractSchema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown): ParseResult<T>;
}

function contractSchema<T>(
  validate: (input: unknown) => T | null,
): ContractSchema<T> {
  return {
    parse(input) {
      const value = validate(input);
      if (value === null) {
        throw new Error('Invalid contract payload');
      }
      return value;
    },
    safeParse(input) {
      try {
        return { success: true, data: this.parse(input) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

// --- POST /api/visual-search ---------------------------------------------

export type VisualSearchRequest = {
  description: string;
  /** Returns the raw query embedding instead of running the vector search. */
  embedOnly?: boolean;
};

export const VisualSearchRequestSchema = contractSchema<VisualSearchRequest>(
  (input) => {
    if (!isObject(input)) return null;
    if (!isString(input.description) || input.description.length < 3) {
      return null;
    }
    if (input.embedOnly !== undefined && !isBoolean(input.embedOnly)) {
      return null;
    }
    const result: VisualSearchRequest = { description: input.description };
    if (input.embedOnly !== undefined) {
      result.embedOnly = input.embedOnly;
    }
    return result;
  },
);

export type VisualSearchMatch = {
  presetId: string;
  score: number;
};

export const VisualSearchMatchSchema = contractSchema<VisualSearchMatch>(
  (input) => {
    if (!isObject(input)) return null;
    if (!isString(input.presetId) || !isNumber(input.score)) return null;
    return { presetId: input.presetId, score: input.score };
  },
);

export type VisualSearchResponse = {
  results: VisualSearchMatch[];
  /** Present only when Vectorize served the query; absent on the D1 fallback. */
  source?: 'vectorize';
};

export const VisualSearchResponseSchema = contractSchema<VisualSearchResponse>(
  (input) => {
    if (!isObject(input)) return null;
    if (!Array.isArray(input.results)) return null;
    const results: VisualSearchMatch[] = [];
    for (const item of input.results) {
      const match = VisualSearchMatchSchema.parse(item);
      results.push(match);
    }
    let source: 'vectorize' | undefined;
    if (input.source !== undefined) {
      if (input.source !== 'vectorize') return null;
      source = 'vectorize';
    }
    return source ? { results, source } : { results };
  },
);

export type VisualSearchEmbedResponse = {
  embedding: number[];
};

export const VisualSearchEmbedResponseSchema =
  contractSchema<VisualSearchEmbedResponse>((input) => {
    if (!isObject(input)) return null;
    if (!Array.isArray(input.embedding)) return null;
    const embedding = input.embedding.filter(isNumber);
    if (embedding.length !== input.embedding.length) return null;
    return { embedding };
  });

// --- POST /api/telemetry --------------------------------------------------

export type TelemetryEvent = {
  event: string;
  renderer?: 'webgpu' | 'webgl2' | 'webgl1' | 'canvas';
  fps?: number;
  audioLatencyMs?: number;
  presetId?: string;
  error?: string;
  userAgent?: string;
};

const RENDERER_VALUES = ['webgpu', 'webgl2', 'webgl1', 'canvas'] as const;

export const TelemetryEventSchema = contractSchema<TelemetryEvent>((input) => {
  if (!isObject(input)) return null;
  if (!isString(input.event) || input.event.length < 1) return null;
  const result: TelemetryEvent = { event: input.event };
  if (input.renderer !== undefined) {
    if (
      !RENDERER_VALUES.includes(
        input.renderer as (typeof RENDERER_VALUES)[number],
      )
    ) {
      return null;
    }
    result.renderer = input.renderer as TelemetryEvent['renderer'];
  }
  if (input.fps !== undefined) {
    if (!isNumber(input.fps)) return null;
    result.fps = input.fps;
  }
  if (input.audioLatencyMs !== undefined) {
    if (!isNumber(input.audioLatencyMs)) return null;
    result.audioLatencyMs = input.audioLatencyMs;
  }
  if (input.presetId !== undefined) {
    if (!isString(input.presetId)) return null;
    result.presetId = input.presetId;
  }
  if (input.error !== undefined) {
    if (!isString(input.error)) return null;
    result.error = input.error;
  }
  if (input.userAgent !== undefined) {
    if (!isString(input.userAgent)) return null;
    result.userAgent = input.userAgent;
  }
  return result;
});

// --- POST /api/rooms (sync-room worker) -----------------------------------

export type SyncRoomCreateResponse = {
  room: string;
  hostKey: string;
};

export const SyncRoomCreateResponseSchema =
  contractSchema<SyncRoomCreateResponse>((input) => {
    if (!isObject(input)) return null;
    if (!isString(input.room) || input.room.length < 1) return null;
    if (!isString(input.hostKey) || input.hostKey.length < 1) return null;
    return { room: input.room, hostKey: input.hostKey };
  });

// --- GET /api/oembed ------------------------------------------------------

/**
 * oEmbed 1.0 `rich` response. Consumed by Notion/Discord/Slack/Reddit rather
 * than by our own frontend, so the contract's job here is to stop the worker
 * from silently dropping a field an embed consumer requires — every optional
 * marking below matches what `functions/api/oembed.ts` may legitimately omit.
 */
export type OEmbedResponse = {
  type: 'rich';
  version: '1.0';
  title: string;
  author_name: string;
  author_url: string;
  provider_name: string;
  provider_url: string;
  cache_age: number;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
  html: string;
  width: number;
  height: number;
};

const OEMBED_STRING_KEYS = [
  'title',
  'author_name',
  'author_url',
  'provider_name',
  'provider_url',
  'thumbnail_url',
  'html',
] as const;
const OEMBED_NUMBER_KEYS = [
  'cache_age',
  'thumbnail_width',
  'thumbnail_height',
  'width',
  'height',
] as const;

export const OEmbedResponseSchema = contractSchema<OEmbedResponse>((input) => {
  if (!isObject(input)) return null;
  if (input.type !== 'rich' || input.version !== '1.0') return null;
  for (const key of OEMBED_STRING_KEYS) {
    if (!isString(input[key])) return null;
  }
  for (const key of OEMBED_NUMBER_KEYS) {
    if (!isNumber(input[key])) return null;
  }
  return {
    type: 'rich',
    version: '1.0',
    title: input.title as string,
    author_name: input.author_name as string,
    author_url: input.author_url as string,
    provider_name: input.provider_name as string,
    provider_url: input.provider_url as string,
    cache_age: input.cache_age as number,
    thumbnail_url: input.thumbnail_url as string,
    thumbnail_width: input.thumbnail_width as number,
    thumbnail_height: input.thumbnail_height as number,
    html: input.html as string,
    width: input.width as number,
    height: input.height as number,
  };
});
