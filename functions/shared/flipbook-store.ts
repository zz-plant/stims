/** Storage contract for immutable GIF previews and their public share pages. */
import type { PreviewFlipbook } from '../../src/js/utils/media/preview-flipbook.ts';
import type { RateLimiter } from '../api/_ai-guard.ts';
import type { PreviewMedia } from './flipbook-video.ts';

export interface FlipbookBucket {
  get(key: string): Promise<{
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<unknown>;
  } | null>;
  put(
    key: string,
    value: string | Uint8Array,
    options?: { httpMetadata?: Record<string, string> },
  ): Promise<unknown>;
  delete?(keys: string[]): Promise<unknown>;
}
export type FlipbookEnv = {
  STATIC_R2?: FlipbookBucket;
  VIDEO_PREVIEWS_ENABLED?: string;
  VIDEO_UPLOAD_LIMITER?: RateLimiter;
  HOMEPAGE_VIDEO_PRESET?: string;
  MEDIA?: PreviewMedia;
};
export type PublishedFlipbook = {
  version: 1;
  id: string;
  title: string;
  presetId: string;
  source: string;
  width: number;
  height: number;
  delayMs: number;
  frameCount: number;
  deleteHash?: string;
  videoReady?: boolean;
};
export const isFlipbookId = (id: string) => /^[a-f0-9]{64}$/.test(id);
export const gifKey = (id: string) => `flipbooks/${id}.gif`;
export const videoKey = (id: string) => `flipbooks/${id}.mp4`;
export const recordKey = (id: string) => `flipbooks/${id}.json`;
export const presetFlipbookKey = (id: string) => `flipbooks/presets/${id}.json`;

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}

export function publishedFlipbook(
  id: string,
  title: string,
  presetId: string,
  source: string,
  clip: PreviewFlipbook,
): PublishedFlipbook {
  return {
    version: 1,
    id,
    title,
    presetId,
    source,
    width: clip.width,
    height: clip.height,
    delayMs: clip.delayMs,
    frameCount: clip.frames.length,
  };
}

export async function loadFlipbook(
  env: FlipbookEnv,
  id: string,
): Promise<PublishedFlipbook | null> {
  if (!env.STATIC_R2 || !isFlipbookId(id)) return null;
  try {
    const object = await env.STATIC_R2.get(recordKey(id));
    if (!object || object.size > 150_000) return null;
    const value = (await object.json()) as PublishedFlipbook;
    if (
      value.version !== 1 ||
      value.id !== id ||
      typeof value.title !== 'string' ||
      value.title.length > 160 ||
      typeof value.source !== 'string' ||
      value.source.length > 128_000 ||
      typeof value.presetId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(value.presetId) ||
      !Number.isInteger(value.width) ||
      value.width < 2 ||
      value.width > 320 ||
      !Number.isInteger(value.height) ||
      value.height < 2 ||
      value.height > 180 ||
      !Number.isInteger(value.delayMs) ||
      value.delayMs < 100 ||
      value.delayMs > 500 ||
      !Number.isInteger(value.frameCount) ||
      value.frameCount < 2 ||
      value.frameCount > 24
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export async function loadPresetFlipbook(
  env: FlipbookEnv,
  presetId: string,
): Promise<PublishedFlipbook | null> {
  if (
    env.VIDEO_PREVIEWS_ENABLED !== 'true' ||
    !env.STATIC_R2 ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(presetId)
  )
    return null;
  try {
    const pointer = await env.STATIC_R2.get(presetFlipbookKey(presetId));
    if (!pointer || pointer.size > 1000) return null;
    const { id } = (await pointer.json()) as { id?: unknown };
    if (typeof id !== 'string') return null;
    const record = await loadFlipbook(env, id);
    return record?.presetId === presetId ? record : null;
  } catch {
    return null;
  }
}
