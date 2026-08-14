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
 */
import { z } from 'zod';

// --- POST /api/visual-search ---------------------------------------------

export const VisualSearchRequestSchema = z.object({
  description: z.string().min(3),
  /** Returns the raw query embedding instead of running the vector search. */
  embedOnly: z.boolean().optional(),
});
export type VisualSearchRequest = z.infer<typeof VisualSearchRequestSchema>;

export const VisualSearchMatchSchema = z.object({
  presetId: z.string(),
  score: z.number(),
});
export type VisualSearchMatch = z.infer<typeof VisualSearchMatchSchema>;

export const VisualSearchResponseSchema = z.object({
  results: z.array(VisualSearchMatchSchema),
  /** Present only when Vectorize served the query; absent on the D1 fallback. */
  source: z.literal('vectorize').optional(),
});
export type VisualSearchResponse = z.infer<typeof VisualSearchResponseSchema>;

export const VisualSearchEmbedResponseSchema = z.object({
  embedding: z.array(z.number()),
});
export type VisualSearchEmbedResponse = z.infer<
  typeof VisualSearchEmbedResponseSchema
>;

// --- POST /api/telemetry --------------------------------------------------

export const TelemetryEventSchema = z.object({
  event: z.string().min(1),
  renderer: z.enum(['webgpu', 'webgl2', 'webgl1', 'canvas']).optional(),
  fps: z.number().optional(),
  audioLatencyMs: z.number().optional(),
  presetId: z.string().optional(),
  error: z.string().optional(),
  userAgent: z.string().optional(),
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// --- POST /api/rooms (sync-room worker) -----------------------------------

export const SyncRoomCreateResponseSchema = z.object({
  room: z.string().min(1),
  hostKey: z.string().min(1),
});
export type SyncRoomCreateResponse = z.infer<
  typeof SyncRoomCreateResponseSchema
>;

// --- GET /api/oembed ------------------------------------------------------

/**
 * oEmbed 1.0 `rich` response. Consumed by Notion/Discord/Slack/Reddit rather
 * than by our own frontend, so the contract's job here is to stop the worker
 * from silently dropping a field an embed consumer requires — every optional
 * marking below matches what `functions/api/oembed.ts` may legitimately omit.
 */
export const OEmbedResponseSchema = z.object({
  type: z.literal('rich'),
  version: z.literal('1.0'),
  title: z.string(),
  author_name: z.string(),
  author_url: z.string(),
  provider_name: z.string(),
  provider_url: z.string(),
  cache_age: z.number(),
  thumbnail_url: z.string(),
  thumbnail_width: z.number(),
  thumbnail_height: z.number(),
  html: z.string(),
  width: z.number(),
  height: z.number(),
});
export type OEmbedResponse = z.infer<typeof OEmbedResponseSchema>;
