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

export function buildPresetOgSvg({
  title,
  author,
  tags = [],
}: OgPresetOptions): string {
  const safeTitle = escapeXml(
    title.length > 55 ? `${title.slice(0, 52)}...` : title,
  );
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
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#050b14"/>
      <stop offset="45%" stop-color="#0a192f"/>
      <stop offset="85%" stop-color="#0d2b45"/>
      <stop offset="100%" stop-color="#093845"/>
    </linearGradient>
    <radialGradient id="glow-1" cx="80%" cy="20%" r="60%">
      <stop offset="0%" stop-color="rgba(123, 231, 255, 0.35)"/>
      <stop offset="100%" stop-color="rgba(123, 231, 255, 0)"/>
    </radialGradient>
    <radialGradient id="glow-2" cx="20%" cy="80%" r="60%">
      <stop offset="0%" stop-color="rgba(168, 85, 247, 0.30)"/>
      <stop offset="100%" stop-color="rgba(168, 85, 247, 0)"/>
    </radialGradient>
    <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0.1)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.65)"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow-1)"/>
  <rect width="1200" height="630" fill="url(#glow-2)"/>

  <!-- Visualizer Wave Accents -->
  <path d="M 60 480 Q 200 320, 360 440 T 660 380 T 960 480 T 1140 420" fill="none" stroke="rgba(123, 231, 255, 0.4)" stroke-width="4"/>
  <path d="M 60 500 Q 240 380, 420 490 T 780 430 T 1140 510" fill="none" stroke="rgba(168, 85, 247, 0.35)" stroke-width="6"/>
  <path d="M 60 530 Q 300 460, 540 540 T 900 480 T 1140 530" fill="none" stroke="rgba(56, 189, 248, 0.25)" stroke-width="3"/>

  <!-- Dark Glass Overlay -->
  <rect width="1200" height="630" fill="url(#overlay)"/>

  <!-- Card Border / Container -->
  <rect x="48" y="48" width="1104" height="534" rx="24" fill="rgba(10, 25, 47, 0.45)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="2"/>

  <!-- Header Badge -->
  <rect x="88" y="88" width="310" height="44" rx="22" fill="rgba(123, 231, 255, 0.15)" stroke="rgba(123, 231, 255, 0.3)" stroke-width="1"/>
  <text x="112" y="116" font-size="16" font-weight="700" fill="#7be7ff" font-family="Space Grotesk, system-ui, sans-serif" letter-spacing="1.5">STIMS • AUDIO VISUALIZER</text>

  <!-- Preset Title -->
  <text x="88" y="240" font-size="54" font-weight="800" fill="#ffffff" font-family="Space Grotesk, system-ui, sans-serif" letter-spacing="-0.5">${safeTitle}</text>

  <!-- Author Byline -->
  ${safeAuthor ? `<text x="88" y="300" font-size="28" font-weight="500" fill="#94a3b8" font-family="Space Grotesk, system-ui, sans-serif">by <tspan fill="#e2e8f0" font-weight="700">${safeAuthor}</tspan></text>` : ''}

  <!-- Badges -->
  <g transform="translate(88, ${safeAuthor ? 360 : 310})">
    <rect x="0" y="0" width="180" height="38" rx="19" fill="rgba(255, 255, 255, 0.1)"/>
    <text x="18" y="25" font-size="15" font-weight="600" fill="#e2e8f0" font-family="Space Grotesk, system-ui, sans-serif">${escapeXml(badgeLabel)}</text>

    <rect x="196" y="0" width="180" height="38" rx="19" fill="rgba(168, 85, 247, 0.2)" stroke="rgba(168, 85, 247, 0.4)"/>
    <text x="214" y="25" font-size="15" font-weight="600" fill="#e9d5ff" font-family="Space Grotesk, system-ui, sans-serif">WebGPU • 60 FPS</text>
  </g>

  <!-- Footer Branding -->
  <text x="88" y="525" font-size="22" font-weight="700" fill="#7be7ff" font-family="Space Grotesk, system-ui, sans-serif">toil.fyi</text>
  <text x="175" y="525" font-size="20" font-weight="400" fill="#64748b" font-family="Space Grotesk, system-ui, sans-serif">• Instant Sound-Reactive Visuals in Browser</text>
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
