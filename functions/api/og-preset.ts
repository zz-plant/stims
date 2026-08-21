// Cloudflare Pages Function: Dynamic 1200x630 Social Card Generator for Presets
// Serves GET /api/og-preset?id=<preset-id>
//
// Default output is PNG rasterized with resvg-wasm — X, Facebook, Slack,
// Discord, and iMessage all refuse SVG in link previews. `?format=svg`
// returns the source SVG for debugging the template.
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { presentTitle } from '../shared/preset-title.ts';
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

// The card is preview-forward: the preset's own rendered frame fills the
// canvas and everything else is a caption over it. Earlier revisions boxed a
// 506x430 thumbnail inside invented HUD chrome (play button, "LIVE 60FPS"
// pill, decorative waveform), which spent most of a 1200x630 unfurl on
// ornament and showed a hard-cropped sliver of the actual product.

// Preset previews are 16:9 (480x270); the card is 1.90:1, so a slice crop
// loses ~7% of the frame height and nothing horizontally.
const CARD_W = 1200;
const CARD_H = 630;
const MARGIN = 64;

const INK = '#f7f4eb';
const CORAL = '#f47a54';
const GROUND = '#070a0e';

// Space Grotesk Bold measures ~0.55em per character across mixed-case Latin.
// Good enough to pick a size and wrap point without shaping the text.
const TITLE_CHAR_RATIO = 0.55;
const TITLE_MAX_WIDTH = CARD_W - MARGIN * 2;

function wrapWords(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Long preset names get two lines before they get small — shrinking a 60-char
// title to fit one line makes it unreadable at feed thumbnail size.
export function fitTitle(title: string): { size: number; lines: string[] } {
  for (const size of [68, 60, 52, 46, 40]) {
    const maxChars = Math.floor(TITLE_MAX_WIDTH / (size * TITLE_CHAR_RATIO));
    const lines = wrapWords(title, maxChars);
    if (lines.length <= 2 && lines.every((l) => l.length <= maxChars)) {
      return { size, lines };
    }
  }
  const size = 40;
  const maxChars = Math.floor(TITLE_MAX_WIDTH / (size * TITLE_CHAR_RATIO));
  const lines = wrapWords(title, maxChars).slice(0, 2);
  if (lines.length === 2 && lines[1].length > maxChars - 1) {
    lines[1] = `${lines[1].slice(0, maxChars - 1)}…`;
  }
  return { size, lines };
}

function eyebrowLabel(tags: string[], tweak?: string): string {
  if (tweak) return `EDITED · ${tweak.slice(0, 24)}`;
  const collection = tags
    .find((t) => t.startsWith('collection:'))
    ?.replace('collection:', '')
    .replace(/-/g, ' ');
  return collection ? collection : 'MilkDrop preset';
}

export function buildPresetOgSvg({
  id = DEFAULT_PRESET_ID,
  title,
  author,
  tags = [],
  tweak,
  previewImageUri,
}: OgPresetOptions): string {
  void id;
  const display = presentTitle(title, author);
  const { size: titleSize, lines } = fitTitle(display);
  const safeLines = lines.map(escapeXml);
  const safeAuthor = author ? escapeXml(author.trim()) : null;
  const label = escapeXml(eyebrowLabel(tags, tweak).toUpperCase());

  // The caption block is bottom-anchored so a two-line title grows upward and
  // the byline stays on the same baseline for every preset.
  const authorBaseline = 552;
  const titleBaseline = safeAuthor ? 498 : 528;
  const lineHeight = Math.round(titleSize * 1.1);
  const firstBaseline = titleBaseline - (safeLines.length - 1) * lineHeight;
  const labelBaseline = firstBaseline - titleSize - 22;

  // Every MilkDrop frame is a different image — the corpus runs from
  // near-black to near-white. A flat overlay would grey out the bright ones,
  // so all chrome lives in one bottom caption band with its own scrim and the
  // top two-thirds of the frame is shown untouched.
  const backdrop = previewImageUri
    ? `<image href="${previewImageUri}" x="0" y="0" width="${CARD_W}" height="${CARD_H}" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="230" width="${CARD_W}" height="400" fill="url(#caption-scrim)"/>`
    : `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#empty-cool)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#empty-warm)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="${escapeXml(display)}${safeAuthor ? ` by ${safeAuthor}` : ''} — a MilkDrop preset running on Stims">
  <defs>
    <linearGradient id="caption-scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${GROUND}" stop-opacity="0"/>
      <stop offset="42%" stop-color="${GROUND}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${GROUND}" stop-opacity="0.97"/>
    </linearGradient>
    <radialGradient id="empty-cool" cx="18%" cy="12%" r="85%">
      <stop offset="0%" stop-color="#16202c"/>
      <stop offset="100%" stop-color="${GROUND}"/>
    </radialGradient>
    <radialGradient id="empty-warm" cx="88%" cy="96%" r="60%">
      <stop offset="0%" stop-color="${CORAL}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${CORAL}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  ${backdrop}

  <text x="${MARGIN}" y="${labelBaseline}" font-size="14" font-weight="700" fill="rgba(247,244,235,0.62)" font-family="Space Mono, monospace" letter-spacing="2.8">${label}</text>

  ${safeLines
    .map(
      (line, i) =>
        `<text x="${MARGIN}" y="${firstBaseline + i * lineHeight}" font-size="${titleSize}" font-weight="700" fill="${INK}" font-family="Space Grotesk, system-ui, sans-serif" letter-spacing="-1">${line}</text>`,
    )
    .join('\n  ')}

  ${safeAuthor ? `<text x="${MARGIN}" y="${authorBaseline}" font-size="25" font-weight="500" fill="rgba(247,244,235,0.74)" font-family="Space Grotesk, system-ui, sans-serif">by ${safeAuthor}</text>` : ''}

  <text x="${CARD_W - MARGIN}" y="${authorBaseline}" text-anchor="end" font-size="19" font-weight="700" font-family="Space Mono, monospace"><tspan fill="${CORAL}" letter-spacing="2">STIMS</tspan><tspan fill="rgba(247,244,235,0.45)"> · toil.fyi</tspan></text>
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

// Preview PNGs are 135MB across ~3,600 files and are excluded from the deploy
// bundle (see wrangler.site.jsonc); functions/milkdrop-presets/previews serves
// them out of the stims-static R2 bucket. Reading them back through ASSETS —
// as this function used to — never hits a preview in production: the binding
// answers unknown paths with the SPA shell, so every shared preset card
// rendered the "no preview" branch.
type PreviewBucket = {
  get: (
    key: string,
  ) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>;
};

type OgPresetContext = {
  request: Request;
  env?: { ASSETS?: StaticAssetFetcher; STATIC_R2?: PreviewBucket };
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

function toDataUri(buffer: ArrayBuffer): string {
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(buffer).toString('base64');
  } else {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    b64 = btoa(binary);
  }
  return `data:image/png;base64,${b64}`;
}

async function loadPresetPreviewDataUri(
  env: OgPresetContext['env'],
  origin: string,
  presetId: string,
): Promise<string | undefined> {
  const relative = `milkdrop-presets/previews/${presetId}.png`;

  if (env?.STATIC_R2) {
    try {
      const object = await env.STATIC_R2.get(relative);
      if (object) return toDataUri(await object.arrayBuffer());
    } catch {
      // fall through to the assets binding
    }
  }

  // Local dev and preview builds still keep previews under public/. The
  // content-type check matters: ASSETS answers a miss with the SPA HTML at
  // status 200, which would otherwise be embedded as a bogus PNG data URI.
  if (env?.ASSETS) {
    try {
      const response = await env.ASSETS.fetch(new URL(`/${relative}`, origin));
      if (
        response.ok &&
        response.headers.get('content-type')?.startsWith('image/')
      ) {
        return toDataUri(await response.arrayBuffer());
      }
    } catch {
      // preview unavailable
    }
  }
  return undefined;
}

// preset-meta.json is the same table the OG middleware reads for <title> and
// og:description, so the card and the unfurl text name the preset identically.
// Without it the card can only guess from the slug ("Eo.S. + Phat" becomes
// "Eos").
type PresetMetaTable = Record<string, [string, string]>;
let presetMetaPromise: Promise<PresetMetaTable | null> | null = null;

async function loadPresetMeta(
  env: OgPresetContext['env'],
  origin: string,
): Promise<PresetMetaTable | null> {
  const assets = env?.ASSETS;
  if (!assets) return null;
  presetMetaPromise ??= (async () => {
    try {
      const response = await assets.fetch(new URL('/preset-meta.json', origin));
      if (!response.ok) throw new Error(`status ${response.status}`);
      return (await response.json()) as PresetMetaTable;
    } catch {
      presetMetaPromise = null;
      return null;
    }
  })();
  return presetMetaPromise;
}

export async function onRequest(context: OgPresetContext): Promise<Response> {
  const url = new URL(context.request.url);
  const presetId = normalizePresetId(
    url.searchParams.get('id') ||
      url.searchParams.get('preset') ||
      url.searchParams.get('name'),
  );
  const tweak = url.searchParams.get('tweak') || undefined;
  const format = url.searchParams.get('format') === 'svg' ? 'svg' : 'png';

  const [meta, previewImageUri] = await Promise.all([
    loadPresetMeta(context.env, url.origin),
    loadPresetPreviewDataUri(context.env, url.origin, presetId),
  ]);
  const entry = meta?.[presetId];
  const { title, author } = entry
    ? { title: entry[0], author: entry[1] || undefined }
    : humanizePresetId(presetId);
  const svg = buildPresetOgSvg({
    id: presetId,
    title,
    author,
    tweak,
    previewImageUri,
  });

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
