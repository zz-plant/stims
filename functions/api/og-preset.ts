// Cloudflare Pages Function: Dynamic 1200x630 Social Card Generator for Presets
// Serves GET /api/og-preset?id=<preset-id> or GET /og/preset.svg?id=<preset-id>

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export type OgPresetOptions = {
  id: string;
  title: string;
  author?: string;
  tags?: string[];
  fidelity?: string;
};

// A row of VU-meter bars, echoing the app's own level meter — a real
// instrument reading, not a decorative logo mark. Heights are fixed (not
// randomized) so output is reproducible.
const VU_BAR_HEIGHTS = [26, 46, 78, 54, 88, 38, 64, 44];
function buildVuMeter(x: number, y: number): string {
  const barWidth = 11;
  const gap = 7;
  const peakIndex = VU_BAR_HEIGHTS.indexOf(Math.max(...VU_BAR_HEIGHTS));
  const bars = VU_BAR_HEIGHTS.map((h, i) => {
    const bx = i * (barWidth + gap);
    const fill = i === peakIndex ? '#f47a54' : 'rgba(119,201,255,0.55)';
    return `<rect x="${bx}" y="${-h}" width="${barWidth}" height="${h}" fill="${fill}"/>`;
  }).join('');
  return `<g transform="translate(${x},${y})">${bars}</g>`;
}

// A scope trace spanning the full canvas width, kept within a fixed vertical
// band so it never runs into the footer or corner meter.
const SCOPE_TRACE_PATH =
  'M0,500 Q60,438 120,500 T240,502 T360,462 T480,522 T600,480 T720,538 T840,470 T960,512 T1080,458 T1200,500';

export function buildPresetOgSvg({
  title,
  author,
  tags = [],
}: OgPresetOptions): string {
  const truncatedTitle = title.length > 60 ? `${title.slice(0, 57)}...` : title;
  const safeTitle = escapeXml(truncatedTitle);
  // Fixed 54px comfortably fits titles up to ~34 chars at canvas width 1200;
  // scale down for longer titles instead of letting them run off the edge.
  const titleFontSize =
    truncatedTitle.length > 34
      ? Math.max(32, Math.round(54 * (34 / truncatedTitle.length)))
      : 54;
  const safeAuthor = author ? escapeXml(author.trim()) : null;

  const collectionTag = tags
    .find((t) => t.startsWith('collection:'))
    ?.replace('collection:', '')
    .replace(/-/g, ' ');
  const badgeLabel = collectionTag
    ? collectionTag.toUpperCase()
    : 'BEAT REACTIVE';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#12191f"/>
      <stop offset="100%" stop-color="#0b1014"/>
    </linearGradient>
    <radialGradient id="glow" cx="82%" cy="16%" r="55%">
      <stop offset="0%" stop-color="rgba(119, 201, 255, 0.22)"/>
      <stop offset="100%" stop-color="rgba(119, 201, 255, 0)"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Scope graticule + trace, full-bleed — reads as a live signal, not decoration -->
  <g stroke="rgba(119,201,255,0.14)" stroke-width="1">
    ${Array.from({ length: 11 }, (_, i) => `<line x1="${i * 120}" y1="560" x2="${i * 120}" y2="570"/>`).join('')}
  </g>
  <path d="${SCOPE_TRACE_PATH}" fill="none" stroke="rgba(244,122,84,0.16)" stroke-width="2" transform="translate(0,12)"/>
  <path d="${SCOPE_TRACE_PATH}" fill="none" stroke="rgba(119,201,255,0.4)" stroke-width="3"/>

  <!-- Header label -->
  <circle cx="92" cy="91" r="4" fill="#f47a54"/>
  <text x="108" y="96" font-size="15" font-weight="700" fill="#77c9ff" font-family="Space Mono, monospace" letter-spacing="2">STIMS • AUDIO VISUALIZER</text>

  <!-- Preset Title -->
  <text x="88" y="${safeAuthor ? '230' : '250'}" font-size="${titleFontSize}" font-weight="800" fill="#f7f4eb" font-family="Space Grotesk, system-ui, sans-serif" letter-spacing="-0.5">${safeTitle}</text>

  <!-- Author Byline -->
  ${safeAuthor ? `<text x="88" y="286" font-size="26" font-weight="500" fill="rgba(247,244,235,0.76)" font-family="Space Grotesk, system-ui, sans-serif">by <tspan fill="#f7f4eb" font-weight="700">${safeAuthor}</tspan></text>` : ''}

  <!-- Badges -->
  <g transform="translate(88, ${safeAuthor ? 336 : 306})">
    <rect x="0" y="0" width="180" height="36" rx="4" fill="rgba(119, 201, 255, 0.12)" stroke="rgba(119, 201, 255, 0.35)"/>
    <text x="16" y="24" font-size="14" font-weight="600" fill="#f7f4eb" font-family="Space Grotesk, system-ui, sans-serif">${escapeXml(badgeLabel)}</text>

    <rect x="196" y="0" width="176" height="36" rx="4" fill="rgba(244, 122, 84, 0.16)" stroke="rgba(244, 122, 84, 0.4)"/>
    <text x="212" y="24" font-size="14" font-weight="600" fill="#f7f4eb" font-family="Space Grotesk, system-ui, sans-serif">WebGPU • 60 FPS</text>
  </g>

  ${buildVuMeter(996, 560)}

  <!-- Footer Branding -->
  <text x="88" y="602" font-size="20" font-weight="700" fill="#f47a54" font-family="Space Mono, monospace">toil.fyi</text>
  <text x="215" y="602" font-size="18" font-weight="400" fill="rgba(247,244,235,0.55)" font-family="Space Grotesk, system-ui, sans-serif">Instant sound-reactive visuals in the browser</text>
</svg>`;
}

export async function onRequest(context: {
  request: Request;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const presetId =
    url.searchParams.get('id') ||
    url.searchParams.get('preset') ||
    'rovastar-parallel-universe';

  const title = presetId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  let author: string | undefined;

  // Split author if title has format Author - Title
  if (title.includes(' ')) {
    const parts = title.split(' ');
    if (parts.length > 2) {
      author = parts[0];
    }
  }

  const svg = buildPresetOgSvg({
    id: presetId,
    title,
    author,
  });

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}
