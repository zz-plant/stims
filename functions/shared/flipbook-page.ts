/** Raw HTML metadata and inert launch data for published video links. */
import { previewVideoUrl } from '../../src/js/utils/media/preview-flipbook.ts';
import {
  type FlipbookEnv,
  loadFlipbook,
  type PublishedFlipbook,
} from './flipbook-store.ts';

export function appendVideoMetadata(
  response: Response,
  clip: PublishedFlipbook,
  origin: string,
): Response {
  if (
    typeof HTMLRewriter === 'undefined' ||
    response.status !== 200 ||
    !response.headers.get('content-type')?.includes('text/html')
  )
    return response;
  const url = previewVideoUrl(origin, clip.id)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
  return new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(
          `<meta property="og:video" content="${url}"><meta property="og:video:secure_url" content="${url}"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="${clip.width}"><meta property="og:video:height" content="${clip.height}">`,
          { html: true },
        );
      },
    })
    .transform(response);
}

export async function renderVideoSharePage(
  context: {
    request: Request;
    next(): Promise<Response>;
    env?: FlipbookEnv & {
      ASSETS?: { fetch(request: Request): Promise<Response> };
    };
  },
  id: string,
): Promise<Response> {
  const record = await loadFlipbook(context.env ?? {}, id);
  if (!record)
    return new Response('This video link is unavailable.', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  const origin = new URL(context.request.url).origin;
  const response = context.env?.ASSETS
    ? await context.env.ASSETS.fetch(new Request(`${origin}/`))
    : await context.next();
  if (response.status !== 200 || typeof HTMLRewriter === 'undefined')
    return response;
  const title = `${record.title} — Stims`;
  const canonical = `${origin}/s/${id}`;
  const image = `${origin}/api/flipbooks/${id}.jpg`;
  const content = (value: string) => ({
    element(el: { setAttribute(name: string, value: string): void }) {
      el.setAttribute('content', value);
    },
  });
  const payload = JSON.stringify({
    presetId: record.presetId,
    source: record.source,
  }).replaceAll('<', '\\u003c');
  let result = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute('href', canonical);
      },
    })
    .on('meta[property="og:url"]', content(canonical))
    .on('meta[property="og:title"]', content(title))
    .on('meta[name="twitter:title"]', content(title))
    .on('meta[name="robots"]', content('noindex,follow'))
    .on(
      'meta[property="og:image"],meta[property="og:image:url"],meta[property="og:image:secure_url"],meta[name="twitter:image"]',
      content(image),
    )
    .on('meta[property="og:image:type"]', content('image/jpeg'))
    .on('meta[property="og:image:width"]', content(String(record.width)))
    .on('meta[property="og:image:height"]', content(String(record.height)))
    .on(
      'meta[property="og:image:alt"],meta[name="twitter:image:alt"]',
      content(`Captured preview of ${record.title}`),
    )
    .on('head', {
      element(el) {
        el.append(
          `<script type="application/json" id="stims-video-share">${payload}</script>`,
          { html: true },
        );
      },
    })
    .transform(response);
  if (context.env?.VIDEO_PREVIEWS_ENABLED === 'true')
    result = appendVideoMetadata(result, record, origin);
  const headers = new Headers(result.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(result.body, { status: result.status, headers });
}
