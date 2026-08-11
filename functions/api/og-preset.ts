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

// Font weights are limited to the static TTFs vendored in /og/fonts
// (Grotesk 400/500/700, Mono 400/700) so the rasterizer never substitutes.
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
  <text x="88" y="${safeAuthor ? '230' : '250'}" font-size="${titleFontSize}" font-weight="700" fill="#f7f4eb" font-family="Space Grotesk, system-ui, sans-serif" letter-spacing="-0.5">${safeTitle}</text>

  <!-- Author Byline -->
  ${safeAuthor ? `<text x="88" y="286" font-size="26" font-weight="500" fill="rgba(247,244,235,0.76)" font-family="Space Grotesk, system-ui, sans-serif">by <tspan fill="#f7f4eb" font-weight="700">${safeAuthor}</tspan></text>` : ''}

  <!-- Badges -->
  <g transform="translate(88, ${safeAuthor ? 336 : 306})">
    <rect x="0" y="0" width="180" height="36" rx="4" fill="rgba(119, 201, 255, 0.12)" stroke="rgba(119, 201, 255, 0.35)"/>
    <text x="16" y="24" font-size="14" font-weight="500" fill="#f7f4eb" font-family="Space Grotesk, system-ui, sans-serif">${escapeXml(badgeLabel)}</text>

    <rect x="196" y="0" width="176" height="36" rx="4" fill="rgba(244, 122, 84, 0.16)" stroke="rgba(244, 122, 84, 0.4)"/>
    <text x="212" y="24" font-size="14" font-weight="500" fill="#f7f4eb" font-family="Space Grotesk, system-ui, sans-serif">WebGPU • 60 FPS</text>
  </g>

  ${buildVuMeter(996, 560)}

  <!-- Footer Branding -->
  <text x="88" y="602" font-size="20" font-weight="700" fill="#f47a54" font-family="Space Mono, monospace">toil.fyi</text>
  <text x="215" y="602" font-size="18" font-weight="400" fill="rgba(247,244,235,0.55)" font-family="Space Grotesk, system-ui, sans-serif">Instant sound-reactive visuals in the browser</text>
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

export async function onRequest(context: OgPresetContext): Promise<Response> {
  const url = new URL(context.request.url);
  const presetId = normalizePresetId(
    url.searchParams.get('id') || url.searchParams.get('preset'),
  );
  const format = url.searchParams.get('format') === 'svg' ? 'svg' : 'png';

  const { title, author } = humanizePresetId(presetId);
  const svg = buildPresetOgSvg({ id: presetId, title, author });

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
