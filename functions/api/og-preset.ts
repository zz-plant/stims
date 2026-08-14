// Cloudflare Pages Function: Dynamic 1200x630 Social Card Generator for Presets
// Serves GET /api/og-preset?id=<preset-id>
//
// Default output is PNG rasterized with resvg-wasm — X, Facebook, Slack,
// Discord, and iMessage all refuse SVG in link previews. `?format=svg`
// returns the source SVG for debugging the template.
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from './resvg.wasm';

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
  tweak?: string;
  previewImageUri?: string;
};

// A row of VU-meter bars, echoing the app's own level meter — a real
// instrument reading, not a decorative logo mark. Heights are fixed (not
// randomized) so output is reproducible.
type OgPalette = {
  primary: string;
  secondary: string;
  glow: string;
  badgeBg: string;
};

function getPresetPalette(id: string): OgPalette {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % 5;
  const palettes: OgPalette[] = [
    {
      primary: '#77c9ff',
      secondary: '#f47a54',
      glow: 'rgba(119, 201, 255, 0.28)',
      badgeBg: 'rgba(119, 201, 255, 0.12)',
    },
    {
      primary: '#c084fc',
      secondary: '#f472b6',
      glow: 'rgba(192, 132, 252, 0.28)',
      badgeBg: 'rgba(192, 132, 252, 0.12)',
    },
    {
      primary: '#34d399',
      secondary: '#38bdf8',
      glow: 'rgba(52, 211, 153, 0.28)',
      badgeBg: 'rgba(52, 211, 153, 0.12)',
    },
    {
      primary: '#fbbf24',
      secondary: '#fb7185',
      glow: 'rgba(251, 191, 36, 0.28)',
      badgeBg: 'rgba(251, 191, 36, 0.12)',
    },
    {
      primary: '#60a5fa',
      secondary: '#e879f9',
      glow: 'rgba(96, 165, 250, 0.28)',
      badgeBg: 'rgba(96, 165, 250, 0.12)',
    },
  ];
  return palettes[index];
}

const SPECTRUM_HEIGHTS = [24, 48, 82, 56, 92, 70, 44, 88, 36, 64, 84, 50, 96, 54, 32];
function buildSpectrumAnalyzer(
  x: number,
  y: number,
  primaryColor: string,
  secondaryColor: string,
): string {
  const barWidth = 8;
  const gap = 5;
  const bars = SPECTRUM_HEIGHTS.map((h, i) => {
    const bx = i * (barWidth + gap);
    const color = i % 3 === 0 ? secondaryColor : primaryColor;
    return `<rect x="${bx}" y="${-h}" width="${barWidth}" height="${h}" rx="2" fill="${color}" opacity="${
      0.55 + (i % 4) * 0.12
    }" /><rect x="${bx}" y="${-h - 5}" width="${barWidth}" height="2" rx="1" fill="${secondaryColor}" opacity="0.95" />`;
  }).join('');
  return `<g transform="translate(${x},${y})">${bars}</g>`;
}

const WAVEFORM_TRACE_PATH =
  'M0,320 Q50,260 100,320 T200,322 T300,282 T400,342 T500,300 T600,358 T700,290 T800,332 T900,278 T1000,320 T1100,285 T1200,320';

export function buildPresetOgSvg({
  id = DEFAULT_PRESET_ID,
  title,
  author,
  tags = [],
  tweak,
  previewImageUri,
}: OgPresetOptions): string {
  const palette = getPresetPalette(id);
  const truncatedTitle = title.length > 55 ? `${title.slice(0, 52)}...` : title;
  const safeTitle = escapeXml(truncatedTitle);
  const titleFontSize =
    truncatedTitle.length > 28
      ? Math.max(34, Math.round(52 * (28 / truncatedTitle.length)))
      : 52;
  const safeAuthor = author ? escapeXml(author.trim()) : null;
  const safeTweak = tweak ? escapeXml(tweak.slice(0, 30)) : null;

  const collectionTag = tags
    .find((t) => t.startsWith('collection:'))
    ?.replace('collection:', '')
    .replace(/-/g, ' ');
  const badgeLabel = safeTweak
    ? `TWEAK: ${safeTweak.toUpperCase()}`
    : collectionTag
      ? collectionTag.toUpperCase()
      : 'BEAT REACTIVE';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0c1118"/>
      <stop offset="50%" stop-color="#111823"/>
      <stop offset="100%" stop-color="#070a0e"/>
    </linearGradient>
    <radialGradient id="glow-left" cx="20%" cy="25%" r="60%">
      <stop offset="0%" stop-color="${palette.glow}"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <radialGradient id="glow-right" cx="80%" cy="70%" r="55%">
      <stop offset="0%" stop-color="${safeTweak ? 'rgba(244, 122, 84, 0.35)' : 'rgba(244, 122, 84, 0.2)'}"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="card-border" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.primary}" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${palette.secondary}" stop-opacity="0.1"/>
    </linearGradient>
    <clipPath id="preview-clip">
      <rect x="0" y="0" width="506" height="430" rx="16"/>
    </clipPath>
    <style>
      @keyframes pulseDot {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      .live-pulse-dot {
        animation: pulseDot 1.4s ease-in-out infinite;
      }
      @keyframes waveFlow {
        0% { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: -120; }
      }
      .wave-trace {
        stroke-dasharray: 10, 5;
        animation: waveFlow 4s linear infinite;
      }
    </style>
  </defs>

  <!-- Background Layer -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow-left)"/>
  <rect width="1200" height="630" fill="url(#glow-right)"/>

  <!-- Subtle Audio Waveform Layer -->
  <path d="${WAVEFORM_TRACE_PATH}" fill="none" stroke="${palette.secondary}" stroke-opacity="0.18" stroke-width="2" transform="translate(0, -20)"/>
  <path d="${WAVEFORM_TRACE_PATH}" fill="none" stroke="${palette.primary}" stroke-opacity="0.3" stroke-width="3"/>

  <!-- Left Content Panel -->
  <g transform="translate(64, 60)">
    <!-- Header Badge -->
    <circle cx="10" cy="14" r="5" fill="${palette.secondary}"/>
    <text x="24" y="19" font-size="14" font-weight="700" fill="${palette.primary}" font-family="Space Mono, monospace" letter-spacing="2.5">STIMS • SOUND REACTIVE VISUALIZER</text>

    <!-- Title -->
    <text x="0" y="${safeAuthor ? '145' : '165'}" font-size="${titleFontSize}" font-weight="700" fill="#f7f4eb" font-family="Space Grotesk, system-ui, sans-serif" letter-spacing="-0.5">${safeTitle}</text>

    <!-- Author Byline -->
    ${safeAuthor ? `<text x="0" y="195" font-size="24" font-weight="500" fill="rgba(247,244,235,0.72)" font-family="Space Grotesk, system-ui, sans-serif">by <tspan fill="#f7f4eb" font-weight="700">${safeAuthor}</tspan></text>` : ''}

    <!-- Badges Row -->
    <g transform="translate(0, ${safeAuthor ? 235 : 215})">
      <rect x="0" y="0" width="${safeTweak ? 240 : 170}" height="36" rx="6" fill="${palette.badgeBg}" stroke="${palette.primary}" stroke-opacity="0.4"/>
      <text x="14" y="23" font-size="13" font-weight="700" fill="${palette.primary}" font-family="Space Mono, monospace">${escapeXml(badgeLabel)}</text>

      <rect x="${safeTweak ? 252 : 182}" y="0" width="150" height="36" rx="6" fill="rgba(244, 122, 84, 0.14)" stroke="rgba(244, 122, 84, 0.4)"/>
      <text x="${safeTweak ? 266 : 196}" y="23" font-size="13" font-weight="700" fill="#f47a54" font-family="Space Mono, monospace">WEBGPU • 60 FPS</text>
    </g>
  </g>

  <!-- Right Visualizer Preview HUD Canvas Card -->
  <g transform="translate(630, 65)">
    ${
      previewImageUri
        ? `<!-- Real Preset Preview Image Snapshot -->
    <image href="${previewImageUri}" x="0" y="0" width="506" height="430" preserveAspectRatio="xMidYMid slice" clip-path="url(#preview-clip)" opacity="0.92"/>
    <rect width="506" height="430" rx="16" fill="none" stroke="url(#card-border)" stroke-width="1.5"/>`
        : `<!-- Fallback HUD Frame -->
    <rect width="506" height="430" rx="16" fill="#0f1722" stroke="url(#card-border)" stroke-width="1.5"/>
    <circle cx="253" cy="215" r="130" fill="none" stroke="${palette.primary}" stroke-opacity="0.15" stroke-width="1" stroke-dasharray="6,6"/>
    <circle cx="253" cy="215" r="95" fill="none" stroke="${palette.secondary}" stroke-opacity="0.25" stroke-width="1.5"/>
    <circle cx="253" cy="215" r="60" fill="none" stroke="${palette.primary}" stroke-opacity="0.4" stroke-width="2"/>
    <circle cx="253" cy="215" r="25" fill="${palette.secondary}" fill-opacity="0.6"/>
    <line x1="123" y1="85" x2="228" y2="190" stroke="${palette.primary}" stroke-opacity="0.3" stroke-width="1.5"/>
    <line x1="383" y1="85" x2="278" y2="190" stroke="${palette.primary}" stroke-opacity="0.3" stroke-width="1.5"/>
    <line x1="123" y1="345" x2="228" y2="240" stroke="${palette.primary}" stroke-opacity="0.3" stroke-width="1.5"/>
    <line x1="383" y1="345" x2="278" y2="240" stroke="${palette.primary}" stroke-opacity="0.3" stroke-width="1.5"/>`
    }

    <!-- HUD Grid Ticks -->
    <line x1="20" y1="20" x2="40" y2="20" stroke="${palette.primary}" stroke-opacity="0.6" stroke-width="2"/>
    <line x1="20" y1="20" x2="20" y2="40" stroke="${palette.primary}" stroke-opacity="0.6" stroke-width="2"/>
    <line x1="486" y1="20" x2="466" y2="20" stroke="${palette.primary}" stroke-opacity="0.6" stroke-width="2"/>
    <line x1="486" y1="20" x2="486" y2="40" stroke="${palette.primary}" stroke-opacity="0.6" stroke-width="2"/>

    <!-- High-CTR Play CTA Overlay -->
    <g transform="translate(253, 200)">
      <circle r="42" fill="#0c1118" stroke="${palette.primary}" stroke-width="2.5"/>
      <polygon points="-11,-18 18,0 -11,18" fill="${palette.secondary}"/>
    </g>
    <g transform="translate(253, 275)">
      <rect x="-100" y="-16" width="200" height="32" rx="16" fill="${palette.secondary}"/>
      <text x="0" y="5" font-size="12" font-weight="700" fill="#0c1118" font-family="Space Mono, monospace" text-anchor="middle">LAUNCH VISUALIZER ▶</text>
    </g>

    <!-- Live Status Pill -->
    <rect x="366" y="24" width="116" height="28" rx="14" fill="rgba(16, 185, 129, 0.2)" stroke="rgba(16, 185, 129, 0.5)"/>
    <circle cx="382" cy="38" r="4" fill="#10b981" class="live-pulse-dot"/>
    <text x="394" y="43" font-size="12" font-weight="700" fill="#10b981" font-family="Space Mono, monospace">LIVE 60FPS</text>
  </g>

  <!-- Bottom Spectrum Analyzer & Branding Bar -->
  ${buildSpectrumAnalyzer(650, 565, palette.primary, palette.secondary)}

  <g transform="translate(64, 560)">
    <text x="0" y="20" font-size="22" font-weight="700" fill="#f47a54" font-family="Space Mono, monospace">toil.fyi</text>
    <text x="110" y="20" font-size="16" font-weight="500" fill="rgba(247,244,235,0.7)" font-family="Space Grotesk, system-ui, sans-serif">• Instant audio-reactive visualizer in your browser</text>
  </g>
</svg>`;
}

export const DEFAULT_PRESET_ID = 'rovastar-parallel-universe';

// Ids feed the SVG, cache keys, and font shaping — reject anything that is
// not a plain slug rather than trying to escape it everywhere downstream.
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/i;

export function normalizePresetId(raw: string | null): string {
  if (!raw) return DEFAULT_PRESET_ID;
  const candidate = raw.trim().toLowerCase();
  return PRESET_ID_PATTERN.test(candidate) ? candidate : DEFAULT_PRESET_ID;
}

// Mirrors the middleware's humanization: first slug segment reads as the
// author, the rest as the title (rovastar-parallel-universe -> Rovastar,
// "Parallel Universe").
export function humanizePresetId(presetId: string): {
  title: string;
  author?: string;
} {
  const parts = presetId.split('-').filter(Boolean);
  const titleCase = (word: string) =>
    word.charAt(0).toUpperCase() + word.slice(1);
  if (parts.length >= 2) {
    return {
      title: parts.slice(1).map(titleCase).join(' '),
      author: titleCase(parts[0]),
    };
  }
  return { title: parts.map(titleCase).join(' ') || presetId };
}

export type RenderAssets = {
  // wrangler resolves the .wasm import to a WebAssembly.Module; bun's asset
  // loader resolves it to a file-path string, which is unusable — tests
  // inject real bytes through this seam instead.
  wasm: WebAssembly.Module | BufferSource;
  fonts: Uint8Array[];
};

let wasmReady: Promise<void> | null = null;
async function ensureWasm(wasm: RenderAssets['wasm']): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(wasm).catch((error: unknown) => {
      wasmReady = null;
      throw error;
    });
  }
  return wasmReady;
}

export async function renderPresetOgPng(
  svg: string,
  assets: RenderAssets,
): Promise<Uint8Array> {
  await ensureWasm(assets.wasm);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    background: '#0b1014',
    font: {
      fontBuffers: assets.fonts,
      defaultFontFamily: 'Space Grotesk',
      sansSerifFamily: 'Space Grotesk',
      monospaceFamily: 'Space Mono',
    },
  });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}

const FONT_PATHS = [
  '/og/fonts/SpaceGrotesk-Regular.ttf',
  '/og/fonts/SpaceGrotesk-Medium.ttf',
  '/og/fonts/SpaceGrotesk-Bold.ttf',
  '/og/fonts/SpaceMono-Regular.ttf',
  '/og/fonts/SpaceMono-Bold.ttf',
];

type StaticAssetFetcher = {
  fetch: (input: Request | URL | string) => Promise<Response>;
};

type OgPresetContext = {
  request: Request;
  env?: { ASSETS?: StaticAssetFetcher };
  waitUntil?: (promise: Promise<unknown>) => void;
  // Test seam: bypasses the .wasm module import and ASSETS font loading.
  renderAssets?: RenderAssets;
};

let fontsReady: Promise<Uint8Array[]> | null = null;
function loadFonts(
  assetsBinding: StaticAssetFetcher,
  origin: string,
): Promise<Uint8Array[]> {
  if (!fontsReady) {
    fontsReady = Promise.all(
      FONT_PATHS.map(async (path) => {
        const response = await assetsBinding.fetch(new URL(path, origin));
        if (!response.ok) {
          throw new Error(`Font asset ${path} returned ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      }),
    ).catch((error: unknown) => {
      fontsReady = null;
      throw error;
    });
  }
  return fontsReady;
}

async function resolveRenderAssets(
  context: OgPresetContext,
  origin: string,
): Promise<RenderAssets> {
  if (context.renderAssets) return context.renderAssets;
  if (typeof resvgWasm === 'string') {
    throw new Error(
      'resvg.wasm resolved to a path string; PNG rendering requires the Workers runtime or injected renderAssets',
    );
  }
  const assetsBinding = context.env?.ASSETS;
  if (!assetsBinding) {
    throw new Error('ASSETS binding unavailable; cannot load font buffers');
  }
  return {
    wasm: resvgWasm,
    fonts: await loadFonts(assetsBinding, origin),
  };
}

const PNG_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';

function edgeCache(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } & CacheStorage })
    .caches;
  return store?.default ?? null;
}

// The generic static card ships in every deploy; serving it on render
// failure keeps unfurls working when rasterization breaks.
async function fallbackPngResponse(
  context: OgPresetContext,
  origin: string,
): Promise<Response> {
  const assetsBinding = context.env?.ASSETS;
  if (assetsBinding) {
    try {
      const fallback = await assetsBinding.fetch(
        new URL('/og/milkdrop.png', origin),
      );
      if (fallback.ok) {
        return new Response(fallback.body, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300',
          },
        });
      }
    } catch {
      // fall through to the redirect below
    }
  }
  return Response.redirect(new URL('/og/milkdrop.png', origin), 302);
}

async function loadPresetPreviewDataUri(
  assetsBinding: StaticAssetFetcher | undefined,
  origin: string,
  presetId: string,
): Promise<string | undefined> {
  if (!assetsBinding) return undefined;
  try {
    const previewUrl = new URL(
      `/milkdrop-presets/previews/${encodeURIComponent(presetId)}.png`,
      origin,
    );
    const response = await assetsBinding.fetch(previewUrl);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 =
        typeof btoa !== 'undefined'
          ? btoa(binary)
          : Buffer.from(bytes).toString('base64');
      return `data:image/png;base64,${b64}`;
    }
  } catch {
    // preview unavailable
  }
  return undefined;
}

export async function onRequest(context: OgPresetContext): Promise<Response> {
  const url = new URL(context.request.url);
  const presetId = normalizePresetId(
    url.searchParams.get('id') || url.searchParams.get('preset'),
  );
  const tweak = url.searchParams.get('tweak') || undefined;
  const format = url.searchParams.get('format') === 'svg' ? 'svg' : 'png';

  const { title, author } = humanizePresetId(presetId);
  const previewImageUri = await loadPresetPreviewDataUri(
    context.env?.ASSETS,
    url.origin,
    presetId,
  );
  const svg = buildPresetOgSvg({ id: presetId, title, author, tweak, previewImageUri });

  if (format === 'svg') {
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': PNG_CACHE_CONTROL,
      },
    });
  }

  const cache = edgeCache();
  const cacheKey = new Request(
    new URL(`/api/og-preset?id=${presetId}`, url.origin).toString(),
    { method: 'GET' },
  );
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    const assets = await resolveRenderAssets(context, url.origin);
    const png = await renderPresetOgPng(svg, assets);
    const response = new Response(new Uint8Array(png).buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': PNG_CACHE_CONTROL,
      },
    });
    if (cache) {
      const store = cache.put(cacheKey, response.clone());
      context.waitUntil?.(store);
    }
    return response;
  } catch {
    return fallbackPngResponse(context, url.origin);
  }
}
