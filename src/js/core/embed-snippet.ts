/**
 * The `<iframe>` that embeds one preset on another page. Two producers hand it
 * out: the oEmbed provider (`functions/api/oembed.ts`), which Notion, Discord
 * and Ghost ask for, and the workspace's "Copy embed code", which a visitor
 * pastes by hand. Built in one place so the two cannot drift on what the
 * frame is allowed to do.
 *
 * Only `?embed=true` (and its aliases) is framable in production: the
 * middleware drops `frame-ancestors` for those requests and nothing else.
 */

/** 16:9, the stage's shape on a desktop. */
export const EMBED_WIDTH = 800;
export const EMBED_HEIGHT = 450;

/**
 * What the embedded app asks the browser for. `autoplay` lets the demo track
 * start from the visitor's tap on the frame, `microphone` and
 * `display-capture` back the Mic and Tab audio sources, and `fullscreen`
 * backs the dock's full-screen button. Anything left out fails inside the
 * frame without a prompt.
 */
export const EMBED_ALLOW = 'autoplay; microphone; display-capture; fullscreen';

// Preset titles come from the MilkDrop corpus and carry raw quotes and angle
// brackets ('martin - "wtf" track'); unescaped, one ends the attribute early
// and a hostile title becomes markup in every embedding page.
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The framable address of one preset, or of the default stage. */
export function buildEmbedUrl(origin: string, presetId?: string | null) {
  const url = new URL('/', origin);
  url.searchParams.set('embed', 'true');
  if (presetId) url.searchParams.set('preset', presetId);
  return url.toString();
}

/**
 * The snippet itself. The width and height attributes are the size a page
 * gets with no CSS of its own; the inline style lets it shrink with a narrow
 * column and keep its shape, instead of overflowing a phone.
 */
export function buildEmbedIframe({
  origin,
  presetId,
  title,
  width = EMBED_WIDTH,
  height = EMBED_HEIGHT,
}: {
  origin: string;
  presetId?: string | null;
  /** The frame's accessible name; screen readers announce it on entry. */
  title: string;
  width?: number;
  height?: number;
}): string {
  const src = buildEmbedUrl(origin, presetId);
  const style = `border:0;border-radius:12px;max-width:100%;height:auto;aspect-ratio:${width}/${height}`;
  return `<iframe src="${escapeHtmlAttribute(src)}" title="${escapeHtmlAttribute(title)}" width="${width}" height="${height}" style="${style}" allow="${EMBED_ALLOW}" allowfullscreen loading="lazy"></iframe>`;
}
