/**
 * Loads Stims inside an iframe the way an embedding site does, and talks to
 * it over the `toil:*` postMessage protocol. Shared by `bun run ctl -- --embed`
 * and tests/e2e/embed-bridge.test.ts, so the hand tool and the protocol's
 * end-to-end check cannot drift apart.
 *
 * The parent page is route-fulfilled at a path on the app's own origin. The
 * obvious alternatives each fail for reasons that have nothing to do with
 * Stims: a `page.setContent` parent is an opaque origin, which denies the
 * frame its storage, and a parent on any other host (even a route-fulfilled
 * localhost one) is blocked from framing a loopback URL by Chromium's
 * local-network-access checks.
 */
import type { Frame, Page } from 'playwright';

export const EMBED_FRAME_ID = 'stims-embed';
const PARENT_PATH = '/__stims_embed_parent.html';

/** A demo track that starts without a click, as a headless harness needs. */
export const AUTOPLAY_ARG = '--autoplay-policy=no-user-gesture-required';

export type ToilReply = Record<string, unknown> & {
  type: string;
  success?: boolean;
  reason?: string;
};

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/** Opens `appUrl` in an iframe on a parent page and returns the app's frame. */
export async function openEmbedded(
  page: Page,
  appUrl: string,
  timeoutMs = 30000,
): Promise<Frame> {
  const parentUrl = `${new URL(appUrl).origin}${PARENT_PATH}`;
  await page.route(parentUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><title>Stims embed harness</title><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%;display:block}</style><iframe id="${EMBED_FRAME_ID}" allow="autoplay; microphone; fullscreen" src="${escapeAttribute(appUrl)}"></iframe>`,
    }),
  );
  await page.goto(parentUrl, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  const handle = await page.waitForSelector(`#${EMBED_FRAME_ID}`, {
    timeout: timeoutMs,
  });
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('The embed iframe has no content frame.');
  return frame;
}

let nextRequestId = 0;

/**
 * Posts one `toil:*` command and resolves with its reply, matched by
 * `requestId` (one is added when the message has none). `embedded` posts from
 * the parent page into the iframe; otherwise the page posts to itself, which
 * the bridge answers the same way. No reply resolves as a failure after
 * `timeoutMs` instead of throwing, so the caller can report it.
 */
export function sendToil(
  page: Page,
  message: Record<string, unknown>,
  { embedded, timeoutMs = 20000 }: { embedded: boolean; timeoutMs?: number },
): Promise<ToilReply> {
  nextRequestId += 1;
  const request = {
    ...message,
    requestId: message.requestId ?? `harness-${nextRequestId}`,
  };
  return page.evaluate(
    ({ request, embedded, frameId, timeoutMs }) =>
      new Promise<ToilReply>((resolve) => {
        const target = embedded
          ? (document.getElementById(frameId) as HTMLIFrameElement | null)
              ?.contentWindow
          : window;
        if (!target) {
          resolve({
            type: 'harness',
            success: false,
            reason: 'There is no embed iframe on the page.',
          });
          return;
        }
        const onMessage = (event: MessageEvent) => {
          const data = event.data as ToilReply | null;
          if (!data || data.requestId !== request.requestId) return;
          // The page posting to itself also hears its own command.
          if (data.type !== 'toil:status' && data.type !== 'toil:telemetry') {
            return;
          }
          window.clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve(data);
        };
        const timer = window.setTimeout(() => {
          window.removeEventListener('message', onMessage);
          resolve({
            type: 'harness',
            success: false,
            reason: `No reply within ${timeoutMs}ms.`,
          });
        }, timeoutMs);
        window.addEventListener('message', onMessage);
        target.postMessage(request, '*');
      }),
    { request, embedded, frameId: EMBED_FRAME_ID, timeoutMs },
  );
}
