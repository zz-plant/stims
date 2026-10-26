/** Publish small, explicit browser captures; serve range-capable GIF origins. */
import {
  decodePreviewFrame,
  encodeFlipbookGif,
  MAX_FLIPBOOK_BYTES,
  validateFlipbook,
} from '../../../src/js/utils/media/preview-flipbook.ts';
import {
  type FlipbookEnv,
  gifKey,
  isFlipbookId,
  loadFlipbook,
  publishedFlipbook,
  recordKey,
  sha256,
  videoKey,
} from '../../shared/flipbook-store.ts';
import { encodeFlipbookVideo } from '../../shared/flipbook-video.ts';
import { encodeJpeg } from '../../shared/jpeg-encoder.ts';

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing capture.');
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FLIPBOOK_BYTES) throw new Error('Capture too large.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: FlipbookEnv;
}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice('/api/flipbooks/'.length);
  if (!path && ['GET', 'HEAD'].includes(request.method)) {
    return json({
      available:
        env.VIDEO_PREVIEWS_ENABLED === 'true' &&
        Boolean(env.STATIC_R2 && env.VIDEO_UPLOAD_LIMITER && env.MEDIA),
    });
  }
  if (request.method === 'POST' && !path) {
    if (
      env.VIDEO_PREVIEWS_ENABLED !== 'true' ||
      !env.STATIC_R2 ||
      !env.VIDEO_UPLOAD_LIMITER ||
      !env.MEDIA
    ) {
      return json({ error: 'Video link publishing is unavailable.' }, 503);
    }
    if (request.headers.get('origin') !== url.origin)
      return json({ error: 'Invalid origin.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return json({ error: 'Expected JSON.' }, 415);
    try {
      const limited = await env.VIDEO_UPLOAD_LIMITER.limit({
        key: request.headers.get('cf-connecting-ip') || 'unknown',
      });
      if (!limited.success)
        return json({ error: 'Try again in a minute.' }, 429);
    } catch {
      return json({ error: 'Publishing is temporarily unavailable.' }, 503);
    }
    try {
      const data = (await readBoundedJson(request)) as Record<string, unknown>;
      if (
        !data ||
        typeof data.title !== 'string' ||
        !data.title.trim() ||
        data.title.length > 160 ||
        typeof data.presetId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(data.presetId) ||
        typeof data.source !== 'string' ||
        !data.source ||
        new TextEncoder().encode(data.source).length > 128_000
      ) {
        return json(
          { error: 'Invalid preset title, source or identity.' },
          400,
        );
      }
      const clip = validateFlipbook(data.clip);
      const id = await sha256(
        JSON.stringify({
          title: data.title,
          presetId: data.presetId,
          source: data.source,
          clip,
        }),
      );
      const existing = await loadFlipbook(env, id);
      if (existing?.videoReady)
        return json({ url: `${url.origin}/s/${id}`, id, deleteToken: null });
      const gif = encodeFlipbookGif(clip);
      let video: Uint8Array;
      try {
        video = await encodeFlipbookVideo(env.MEDIA, gif, clip);
      } catch {
        return json(
          { error: 'Video conversion is temporarily unavailable. Try again.' },
          503,
        );
      }
      const token = crypto.randomUUID();
      const record = publishedFlipbook(
        id,
        data.title,
        data.presetId,
        data.source,
        clip,
      );
      record.deleteHash = existing?.deleteHash ?? (await sha256(token));
      record.videoReady = true;
      // Publish the record last: all media must already be ready to fetch.
      await env.STATIC_R2.put(videoKey(id), video, {
        httpMetadata: { contentType: 'video/mp4' },
      });
      await env.STATIC_R2.put(gifKey(id), gif, {
        httpMetadata: { contentType: 'image/gif' },
      });
      await env.STATIC_R2.put(
        `flipbooks/${id}.jpg`,
        encodeJpeg(
          decodePreviewFrame(clip.frames[0]),
          clip.width,
          clip.height,
          80,
        ),
        { httpMetadata: { contentType: 'image/jpeg' } },
      );
      await env.STATIC_R2.put(recordKey(id), JSON.stringify(record), {
        httpMetadata: { contentType: 'application/json' },
      });
      return json(
        {
          url: `${url.origin}/s/${id}`,
          id,
          deleteToken: existing?.deleteHash ? null : token,
        },
        201,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Publishing failed.';
      return json(
        { error: message },
        message === 'Capture too large.' ? 413 : 400,
      );
    }
  }
  const isGif = path.endsWith('.gif');
  const isJpeg = path.endsWith('.jpg');
  const isVideo = path.endsWith('.mp4');
  const isMedia = isGif || isJpeg || isVideo;
  const id = isMedia ? path.slice(0, -4) : path;
  if (!isFlipbookId(id)) return json({ error: 'Not found.' }, 404);
  const record = await loadFlipbook(env, id);
  if (!record || !env.STATIC_R2) return json({ error: 'Not found.' }, 404);
  if (request.method === 'DELETE' && !isMedia) {
    const token =
      request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (
      !record.deleteHash ||
      !token ||
      (await sha256(token)) !== record.deleteHash
    )
      return json({ error: 'Invalid deletion token.' }, 403);
    if (!env.STATIC_R2.delete)
      return json({ error: 'Deletion is unavailable.' }, 503);
    await env.STATIC_R2.delete([
      recordKey(id),
      gifKey(id),
      videoKey(id),
      `flipbooks/${id}.jpg`,
    ]);
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!['GET', 'HEAD'].includes(request.method))
    return json({ error: 'Method not allowed.' }, 405);
  if (!isMedia) return json({ ...record, deleteHash: undefined });
  if (isVideo && !record.videoReady) return json({ error: 'Not found.' }, 404);
  const object = await env.STATIC_R2.get(
    isVideo ? videoKey(id) : isGif ? gifKey(id) : `flipbooks/${id}.jpg`,
  );
  if (!object || object.size > MAX_FLIPBOOK_BYTES)
    return json({ error: 'Not found.' }, 404);
  const headers = new Headers({
    'Content-Type': isVideo ? 'video/mp4' : isGif ? 'image/gif' : 'image/jpeg',
    'Content-Length': String(object.size),
    'Accept-Ranges': 'bytes',
    ETag: `"${id}"`,
    'Cache-Control': 'public, max-age=300',
  });
  if (request.headers.get('if-none-match') === `"${id}"`)
    return new Response(null, { status: 304, headers });
  const range = request.headers.get('range');
  let start = 0;
  let end = object.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${object.size}` },
      });
    start = match[1]
      ? Number(match[1])
      : Math.max(0, object.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= object.size)
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${object.size}` },
      });
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
    headers.set('Content-Length', String(end - start + 1));
  }
  return new Response(
    request.method === 'HEAD'
      ? null
      : (await object.arrayBuffer()).slice(start, end + 1),
    { status: range ? 206 : 200, headers },
  );
}
