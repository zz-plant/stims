import { execFile } from 'node:child_process';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

export const DEFAULT_BASE_URL = 'https://toil.fyi';
export const GENERATED_SITEMAP_CHUNK_PATH = 'public/sitemap-1.xml';
export const GENERATED_SITEMAP_INDEX_PATH = 'public/sitemap.xml';
export const PRESET_CATALOG_PATH = 'public/milkdrop-presets/catalog.json';
// A 177KB id -> [title, author] map carved out of the 1.6MB catalog so the
// edge middleware can put real preset titles in <title>/OG tags without
// parsing the full catalog on every cold isolate.
export const GENERATED_PRESET_META_PATH = 'public/preset-meta.json';
export const PRESET_PREVIEW_DIR = 'public/milkdrop-presets/previews';
// Presets start at chunk 2; chunk 1 stays reserved for the hand-written app
// routes so their priorities and lastmods are not buried under 1,791 entries.
export const PRESET_SITEMAP_FIRST_CHUNK = 2;
// Well under the 50,000-URL / 50MB per-file sitemap limit, and small enough
// that a single preset regeneration does not rewrite one enormous file.
export const PRESET_SITEMAP_CHUNK_SIZE = 1000;
export const GENERATED_ROBOTS_PATH = 'public/robots.txt';
export const GENERATED_OG_DEFAULT_PATH = 'public/og/default.svg';
export const GENERATED_OG_MILKDROP_PATH = 'public/og/milkdrop.svg';
export const GENERATED_OG_PERFORMANCE_PATH = 'public/og/performance.svg';
export const GENERATED_OG_DEFAULT_PNG_PATH = 'public/og/default.png';
export const GENERATED_OG_MILKDROP_PNG_PATH = 'public/og/milkdrop.png';
export const GENERATED_OG_PERFORMANCE_PNG_PATH = 'public/og/performance.png';
export const GENERATED_ICON_FAVICON_SVG_PATH = 'public/icons/favicon.svg';
export const GENERATED_ICON_FAVICON_32_PATH = 'public/icons/favicon-32.png';
export const GENERATED_ICON_192_PATH = 'public/icons/icon-192.png';
export const GENERATED_ICON_512_PATH = 'public/icons/icon-512.png';
export const GENERATED_SCREENSHOT_HERO_WIDE_PATH =
  'public/screenshots/hero-wide.png';
export const GENERATED_SCREENSHOT_HERO_NARROW_PATH =
  'public/screenshots/hero-narrow.png';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const generatedDirs = ['toys', 'tags', 'moods', 'capabilities', 'discover'];
const ogWidth = 1200;
const ogHeight = 630;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ToyEntry = {
  slug: string;
  title: string;
  description: string;
};

type SitemapRouteSpec = {
  path: string;
  imagePath: string;
  imageTitle: string;
  imageCaption: string;
  changefreq: 'weekly' | 'monthly';
  priority: string;
  sourcePaths: string[];
  includeInSitemap: boolean;
};

export type SitemapEntry = {
  loc: string;
  lastmod: string;
  changefreq: SitemapRouteSpec['changefreq'];
  priority: string;
  imageLoc: string;
  imageTitle: string;
  imageCaption: string;
};

type GeneratedFile = {
  relativePath: string;
  contents: string | Uint8Array;
};

type SeoArtifacts = {
  files: GeneratedFile[];
  sitemapEntries: SitemapEntry[];
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// A row of VU-meter bars, echoing the app's own level meter — a real
// instrument reading, not a decorative logo mark. Heights are fixed (not
// randomized) so output is reproducible.
const VU_BAR_HEIGHTS = [26, 46, 78, 54, 88, 38, 64, 44];
const buildVuMeter = (x: number, y: number) => {
  const barWidth = 11;
  const gap = 7;
  const peakIndex = VU_BAR_HEIGHTS.indexOf(Math.max(...VU_BAR_HEIGHTS));
  const bars = VU_BAR_HEIGHTS.map((h, i) => {
    const bx = i * (barWidth + gap);
    const fill = i === peakIndex ? '#f47a54' : 'rgba(119,201,255,0.55)';
    return `<rect x="${bx}" y="${-h}" width="${barWidth}" height="${h}" fill="${fill}" />`;
  }).join('');
  return `<g transform="translate(${x},${y})">${bars}</g>`;
};

// A scope trace spanning the full canvas width, kept within a fixed vertical
// band so it never runs into the footer or corner meter.
const SCOPE_TRACE_PATH =
  'M0,500 Q60,438 120,500 T240,502 T360,462 T480,522 T600,480 T720,538 T840,470 T960,512 T1080,458 T1200,500';

export const buildOgSvg = ({
  title,
  subtitle,
  eyebrow,
  chip,
}: {
  title: string;
  subtitle: string;
  eyebrow: string;
  chip?: string;
}) => {
  const labelY = chip ? 96 : 60;
  const eyebrowY = chip ? 176 : 140;
  const titleY = chip ? 258 : 222;
  const subtitleY = chip ? 314 : 278;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ogWidth}" height="${ogHeight}" viewBox="0 0 ${ogWidth} ${ogHeight}" role="img" aria-label="${escapeHtml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#12191f" />
      <stop offset="100%" stop-color="#0b1014" />
    </linearGradient>
    <radialGradient id="glow" cx="82%" cy="16%" r="55%">
      <stop offset="0%" stop-color="rgba(119, 201, 255, 0.18)" />
      <stop offset="100%" stop-color="rgba(119, 201, 255, 0)" />
    </radialGradient>
  </defs>
  <rect width="${ogWidth}" height="${ogHeight}" fill="url(#bg)" />
  <rect width="${ogWidth}" height="${ogHeight}" fill="url(#glow)" />

  <!-- Scope graticule + trace, full-bleed — reads as a live signal, not decoration -->
  <g stroke="rgba(119,201,255,0.14)" stroke-width="1">
    ${Array.from({ length: 11 }, (_, i) => `<line x1="${i * 120}" y1="560" x2="${i * 120}" y2="570" />`).join('')}
  </g>
  <path d="${SCOPE_TRACE_PATH}" fill="none" stroke="rgba(244,122,84,0.16)" stroke-width="2" transform="translate(0,12)" />
  <path d="${SCOPE_TRACE_PATH}" fill="none" stroke="rgba(119,201,255,0.4)" stroke-width="3" />

  ${
    chip
      ? `<circle cx="92" cy="${labelY - 5}" r="4" fill="#f47a54" />
  <text x="108" y="${labelY}" font-size="15" font-weight="700" fill="#77c9ff" font-family="Space Mono, monospace" letter-spacing="2">${escapeHtml(chip.toUpperCase())}</text>`
      : ''
  }
  <text x="88" y="${eyebrowY}" font-size="28" font-weight="600" fill="#77c9ff" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(eyebrow)}</text>
  <text x="88" y="${titleY}" font-size="62" font-weight="700" fill="#f7f4eb" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(title)}</text>
  <text x="88" y="${subtitleY}" font-size="26" fill="rgba(247,244,235,0.76)" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(subtitle)}</text>

  ${buildVuMeter(996, 560)}
  <text x="88" y="602" font-size="20" font-weight="700" fill="#f47a54" font-family="Space Mono, monospace">toil.fyi</text>
</svg>`;
};

export const buildAppIconSvg =
  () => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Stims app icon">
  <defs>
    <linearGradient id="icon-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07111d" />
      <stop offset="100%" stop-color="#0f7c86" />
    </linearGradient>
    <radialGradient id="icon-glow" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="rgba(123, 231, 255, 0.95)" />
      <stop offset="100%" stop-color="rgba(123, 231, 255, 0)" />
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#icon-bg)" />
  <circle cx="256" cy="220" r="132" fill="url(#icon-glow)" opacity="0.72" />
  <circle cx="256" cy="256" r="126" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="18" />
  <circle cx="256" cy="256" r="88" fill="none" stroke="#f5fbff" stroke-width="18" stroke-dasharray="172 62" stroke-linecap="round" />
  <circle cx="256" cy="256" r="36" fill="#f5fbff" opacity="0.96" />
  <path d="M112 360c38-29 74-44 108-44 42 0 70 20 98 20 23 0 51-12 83-37" fill="none" stroke="rgba(244,247,255,0.84)" stroke-width="16" stroke-linecap="round" />
</svg>`;

export const buildManifestScreenshotSvg = ({
  width,
  height,
  title,
  subtitle,
  mode,
}: {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  mode: 'wide' | 'narrow';
}) => {
  const isWide = mode === 'wide';
  const screenX = isWide ? 700 : 88;
  const screenY = isWide ? 88 : 540;
  const screenWidth = isWide ? 492 : 544;
  const screenHeight = isWide ? 512 : 652;
  const copyX = 88;
  const copyTitleY = isWide ? 222 : 210;
  const copySubtitleY = isWide ? 336 : 326;
  const copyBodyY = isWide ? 408 : 404;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
  <defs>
    <linearGradient id="hero-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07111d" />
      <stop offset="52%" stop-color="#102143" />
      <stop offset="100%" stop-color="#0d7f84" />
    </linearGradient>
    <radialGradient id="hero-glow" cx="22%" cy="18%" r="58%">
      <stop offset="0%" stop-color="rgba(129, 249, 255, 0.42)" />
      <stop offset="100%" stop-color="rgba(129, 249, 255, 0)" />
    </radialGradient>
    <linearGradient id="panel-shine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.22)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0)" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="36" fill="url(#hero-bg)" />
  <rect width="${width}" height="${height}" rx="36" fill="url(#hero-glow)" />
  <circle cx="${isWide ? 1080 : 520}" cy="${isWide ? 140 : 180}" r="${isWide ? 120 : 100}" fill="rgba(255,255,255,0.08)" />
  <rect x="88" y="88" width="${isWide ? 220 : 204}" height="52" rx="26" fill="rgba(255,255,255,0.12)" />
  <text x="116" y="122" font-size="28" fill="#f4f7ff" font-family="Space Grotesk, Arial, sans-serif">Instant visuals</text>
  <text x="${copyX}" y="${copyTitleY}" font-size="${isWide ? 68 : 60}" font-weight="700" fill="#ffffff" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(title)}</text>
  <text x="${copyX}" y="${copySubtitleY}" font-size="${isWide ? 34 : 32}" fill="#d7e6ff" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(subtitle)}</text>
  <text x="${copyX}" y="${copyBodyY}" font-size="${isWide ? 24 : 22}" fill="#dbe4ff" font-family="Space Grotesk, Arial, sans-serif">Demo audio first, presets ready, and your own music when you want it.</text>
  <rect x="${screenX}" y="${screenY}" width="${screenWidth}" height="${screenHeight}" rx="32" fill="rgba(7,17,29,0.68)" stroke="rgba(255,255,255,0.18)" />
  <rect x="${screenX}" y="${screenY}" width="${screenWidth}" height="${screenHeight}" rx="32" fill="url(#panel-shine)" opacity="0.48" />
  <rect x="${screenX + 28}" y="${screenY + 28}" width="${screenWidth - 56}" height="44" rx="22" fill="rgba(255,255,255,0.08)" />
  <circle cx="${screenX + 54}" cy="${screenY + 50}" r="8" fill="#7be7ff" />
  <text x="${screenX + 78}" y="${screenY + 57}" font-size="22" fill="#f5fbff" font-family="Space Mono, monospace">Live stage</text>
  <circle cx="${screenX + screenWidth / 2}" cy="${screenY + 250}" r="${isWide ? 118 : 124}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="18" />
  <circle cx="${screenX + screenWidth / 2}" cy="${screenY + 250}" r="${isWide ? 78 : 84}" fill="none" stroke="#f5fbff" stroke-width="16" stroke-dasharray="164 58" stroke-linecap="round" />
  <circle cx="${screenX + screenWidth / 2}" cy="${screenY + 250}" r="32" fill="#f5fbff" />
  <path d="M${screenX + 44} ${screenY + screenHeight - 118} C ${screenX + 112} ${screenY + screenHeight - 186}, ${screenX + 186} ${screenY + screenHeight - 72}, ${screenX + 256} ${screenY + screenHeight - 136} S ${screenX + 382} ${screenY + screenHeight - 118}, ${screenX + screenWidth - 44} ${screenY + screenHeight - 172}" fill="none" stroke="#7be7ff" stroke-width="16" stroke-linecap="round" />
  <rect x="${screenX + 44}" y="${screenY + screenHeight - 86}" width="${screenWidth - 88}" height="22" rx="11" fill="rgba(255,255,255,0.1)" />
  <rect x="${screenX + 44}" y="${screenY + screenHeight - 86}" width="${isWide ? 272 : 296}" height="22" rx="11" fill="#7be7ff" />
</svg>`;
};

async function renderSvgPng(
  svg: string,
  { width, height }: { width: number; height: number },
) {
  return sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
}

const formatDate = (value: number | Date) =>
  new Date(value).toISOString().slice(0, 10);

async function loadToys(rootDir = repoRoot) {
  const toysRaw = await readFile(
    path.join(rootDir, 'src/data/toys.json'),
    'utf8',
  );
  return JSON.parse(toysRaw) as ToyEntry[];
}

function getMilkdropEntry(toys: ToyEntry[]) {
  return (
    toys.find((entry) => entry.slug === 'milkdrop') ??
    ({
      slug: 'milkdrop',
      title: 'MilkDrop Visualizer',
      description:
        'Dedicated Stims launch route for compatibility checks, audio setup, quality tuning, preset browsing, and live editing.',
    } satisfies ToyEntry)
  );
}

async function gitCommandSucceeded(
  rootDir: string,
  args: string[],
): Promise<boolean> {
  try {
    await execFileAsync('git', args, { cwd: rootDir });
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return error.code !== 1;
    }
    return false;
  }
}

async function hasUncommittedChanges(rootDir: string, sourcePaths: string[]) {
  const diffArgs = ['diff', '--quiet', '--', ...sourcePaths];
  const cachedDiffArgs = ['diff', '--cached', '--quiet', '--', ...sourcePaths];
  const worktreeClean = await gitCommandSucceeded(rootDir, diffArgs);
  const stagedClean = await gitCommandSucceeded(rootDir, cachedDiffArgs);
  return !worktreeClean || !stagedClean;
}

async function getGitLastmod(rootDir: string, sourcePaths: string[]) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--format=%cs', '--', ...sourcePaths],
      { cwd: rootDir },
    );
    const value = stdout.trim();
    return ISO_DATE_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function getFilesystemLastmod(rootDir: string, sourcePaths: string[]) {
  const timestamps = await Promise.all(
    sourcePaths.map(async (relativePath) => {
      const target = path.join(rootDir, relativePath);
      return (await stat(target)).mtimeMs;
    }),
  );

  return formatDate(Math.max(...timestamps));
}

export async function resolveLastmodDate(
  rootDir: string,
  sourcePaths: string[],
) {
  if (!(await hasUncommittedChanges(rootDir, sourcePaths))) {
    const gitLastmod = await getGitLastmod(rootDir, sourcePaths);
    if (gitLastmod) {
      return gitLastmod;
    }
  }

  return getFilesystemLastmod(rootDir, sourcePaths);
}

export function getSitemapRouteSpecs(milkdrop: ToyEntry): SitemapRouteSpec[] {
  return [
    {
      path: '/',
      imagePath: '/og/milkdrop.png',
      imageTitle: `${milkdrop.title} | Stims`,
      imageCaption:
        'MilkDrop-inspired browser music visualizer with demo audio, hand-picked presets, and ways to react to your own music.',
      changefreq: 'weekly',
      priority: '1.0',
      sourcePaths: [
        'index.html',
        'src/data/toys.json',
        'src/js/toys/milkdrop-toy.ts',
      ],
      includeInSitemap: true,
    },
    {
      path: '/performance/',
      imagePath: '/og/performance.png',
      imageTitle: 'Compatibility and Performance | Stims',
      imageCaption:
        'Guide to browser support, lighter visual modes, and what to expect on older devices.',
      changefreq: 'monthly',
      priority: '0.7',
      sourcePaths: ['performance/index.html', 'src/css/performance.css'],
      includeInSitemap: true,
    },
    {
      path: '/milkdrop/',
      imagePath: '/og/milkdrop.svg',
      imageTitle: `${milkdrop.title} | Stims`,
      imageCaption:
        'Compatibility alias that immediately redirects to the canonical Stims route.',
      changefreq: 'monthly',
      priority: '0.1',
      sourcePaths: ['milkdrop/index.html'],
      includeInSitemap: false,
    },
  ];
}

export async function buildSitemapEntries(
  rootDir = repoRoot,
  {
    baseUrl = DEFAULT_BASE_URL,
    milkdrop,
    resolveLastmod = (sourcePaths: string[]) =>
      resolveLastmodDate(rootDir, sourcePaths),
  }: {
    baseUrl?: string;
    milkdrop?: ToyEntry;
    resolveLastmod?: (sourcePaths: string[]) => Promise<string>;
  } = {},
): Promise<SitemapEntry[]> {
  const toys = milkdrop ? [] : await loadToys(rootDir);
  const milkdropEntry = milkdrop ?? getMilkdropEntry(toys);
  const specs = getSitemapRouteSpecs(milkdropEntry).filter(
    (route) => route.includeInSitemap,
  );

  return Promise.all(
    specs.map(async (route) => ({
      loc: new URL(route.path, `${baseUrl}/`).toString(),
      lastmod: await resolveLastmod(route.sourcePaths),
      changefreq: route.changefreq,
      priority: route.priority,
      imageLoc: new URL(route.imagePath, `${baseUrl}/`).toString(),
      imageTitle: route.imageTitle,
      imageCaption: route.imageCaption,
    })),
  );
}

export function buildSitemapChunk(entries: SitemapEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
    <image:image>
      <image:loc>${escapeXml(entry.imageLoc)}</image:loc>
      <image:title>${escapeXml(entry.imageTitle)}</image:title>
      <image:caption>${escapeXml(entry.imageCaption)}</image:caption>
    </image:image>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
}

const latestLastmod = (entries: SitemapEntry[]) =>
  entries.reduce(
    (latest, entry) => (entry.lastmod > latest ? entry.lastmod : latest),
    entries[0]?.lastmod ?? formatDate(new Date()),
  ) ?? formatDate(new Date());

export function buildSitemapIndex(
  entries: SitemapEntry[],
  baseUrl = DEFAULT_BASE_URL,
  presetChunks: SitemapEntry[][] = [],
) {
  const chunks = [
    { name: 'sitemap-1.xml', lastmod: latestLastmod(entries) },
    ...presetChunks.map((chunk, index) => ({
      name: `sitemap-${PRESET_SITEMAP_FIRST_CHUNK + index}.xml`,
      lastmod: latestLastmod(chunk),
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${chunks
  .map(
    (chunk) => `  <sitemap>
    <loc>${baseUrl}/${chunk.name}</loc>
    <lastmod>${chunk.lastmod}</lastmod>
  </sitemap>`,
  )
  .join('\n')}
</sitemapindex>
`;
}

type PresetCatalogEntry = {
  id: string;
  title: string;
  author?: string;
};

// 121 catalog entries carry the literal author "Unknown". Crediting a preset
// "by Unknown" reads worse than not crediting it at all.
const isNamedAuthor = (author?: string) =>
  Boolean(author) && author !== 'Unknown';

/**
 * One sitemap entry per catalog preset.
 *
 * These pages already exist and already serve per-preset titles, descriptions,
 * and OG cards — they were simply never advertised to a crawler, so a
 * 1,791-preset catalog was represented in search by two URLs. The `?preset=`
 * query form is used rather than a `/preset/<id>` path because the query form
 * is what the app actually serves; the path form is a redirect.
 */
export async function buildPresetSitemapEntries(
  rootDir = repoRoot,
  {
    baseUrl = DEFAULT_BASE_URL,
    lastmod,
  }: { baseUrl?: string; lastmod?: string } = {},
): Promise<SitemapEntry[]> {
  const catalogRaw = await readFile(
    path.join(rootDir, PRESET_CATALOG_PATH),
    'utf8',
  );
  const catalog = JSON.parse(catalogRaw) as {
    generatedAt?: string;
    presets?: PresetCatalogEntry[];
  };

  const generatedAt =
    lastmod ??
    (catalog.generatedAt && ISO_DATE_PATTERN.test(catalog.generatedAt)
      ? catalog.generatedAt
      : await resolveLastmodDate(rootDir, [PRESET_CATALOG_PATH]));

  // Only advertise an image when the preview actually shipped; a sitemap that
  // points at missing images is worse than one with no image block at all.
  const previews = new Set(
    await readdir(path.join(rootDir, PRESET_PREVIEW_DIR)).catch(() => []),
  );

  // The catalog currently ships 15 ids twice. Emitting each twice would put
  // duplicate <loc> entries in the sitemap, so collapse on id here.
  const seen = new Set<string>();
  const uniquePresets = (catalog.presets ?? []).filter((preset) => {
    if (seen.has(preset.id)) {
      return false;
    }
    seen.add(preset.id);
    return true;
  });

  return uniquePresets.map((preset) => {
    const credit = isNamedAuthor(preset.author) ? ` by ${preset.author}` : '';
    return {
      loc: `${baseUrl}/?preset=${encodeURIComponent(preset.id)}`,
      lastmod: generatedAt,
      changefreq: 'monthly' as const,
      priority: '0.6',
      imageLoc: previews.has(`${preset.id}.png`)
        ? `${baseUrl}/milkdrop-presets/previews/${preset.id}.png`
        : `${baseUrl}/api/og-preset?id=${encodeURIComponent(preset.id)}`,
      imageTitle: `${preset.title} | Stims`,
      imageCaption: `${preset.title}${credit}, a MilkDrop preset running live in the browser on Stims.`,
    };
  });
}

export async function buildPresetMetaMap(rootDir = repoRoot) {
  const catalogRaw = await readFile(
    path.join(rootDir, PRESET_CATALOG_PATH),
    'utf8',
  );
  const catalog = JSON.parse(catalogRaw) as { presets?: PresetCatalogEntry[] };

  return Object.fromEntries(
    (catalog.presets ?? []).map((preset) => [
      preset.id,
      [preset.title, isNamedAuthor(preset.author) ? preset.author : ''],
    ]),
  );
}

export const chunkSitemapEntries = (
  entries: SitemapEntry[],
  size = PRESET_SITEMAP_CHUNK_SIZE,
) =>
  Array.from({ length: Math.ceil(entries.length / size) }, (_, index) =>
    entries.slice(index * size, (index + 1) * size),
  );

export function buildRobotsTxt(baseUrl = DEFAULT_BASE_URL) {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export async function buildSeoArtifacts(
  rootDir = repoRoot,
  { baseUrl = DEFAULT_BASE_URL }: { baseUrl?: string } = {},
): Promise<SeoArtifacts> {
  const toys = await loadToys(rootDir);
  const milkdrop = getMilkdropEntry(toys);
  const sitemapEntries = await buildSitemapEntries(rootDir, {
    baseUrl,
    milkdrop,
  });
  const presetChunks = chunkSitemapEntries(
    await buildPresetSitemapEntries(rootDir, { baseUrl }),
  );
  const defaultOgSvg = buildOgSvg({
    title: 'Stims',
    subtitle: 'MilkDrop-inspired visuals for your music',
    eyebrow: 'Music-reactive in the browser',
    chip: 'Instant visuals',
  });
  const milkdropOgSvg = buildOgSvg({
    title: milkdrop.title,
    subtitle: 'Demo audio, presets, and your own music',
    eyebrow: 'Browser music visualizer',
    chip: 'Start fast',
  });
  const performanceOgSvg = buildOgSvg({
    title: 'Compatibility and Performance',
    subtitle: 'Browser support, lighter modes, and first-run guidance',
    eyebrow: 'What to expect before you start',
    chip: 'Performance guide',
  });
  const iconSvg = buildAppIconSvg();
  const heroWideSvg = buildManifestScreenshotSvg({
    width: 1280,
    height: 720,
    title: 'MilkDrop Visualizer',
    subtitle: 'Browser-native audio-reactive play',
    mode: 'wide',
  });
  const heroNarrowSvg = buildManifestScreenshotSvg({
    width: 720,
    height: 1280,
    title: 'Stims',
    subtitle: 'Music-reactive visuals on the go',
    mode: 'narrow',
  });

  return {
    sitemapEntries,
    files: [
      {
        relativePath: GENERATED_OG_DEFAULT_PATH,
        contents: defaultOgSvg,
      },
      {
        relativePath: GENERATED_OG_DEFAULT_PNG_PATH,
        contents: await renderSvgPng(defaultOgSvg, {
          width: ogWidth,
          height: ogHeight,
        }),
      },
      {
        relativePath: GENERATED_OG_MILKDROP_PATH,
        contents: milkdropOgSvg,
      },
      {
        relativePath: GENERATED_OG_MILKDROP_PNG_PATH,
        contents: await renderSvgPng(milkdropOgSvg, {
          width: ogWidth,
          height: ogHeight,
        }),
      },
      {
        relativePath: GENERATED_OG_PERFORMANCE_PATH,
        contents: performanceOgSvg,
      },
      {
        relativePath: GENERATED_OG_PERFORMANCE_PNG_PATH,
        contents: await renderSvgPng(performanceOgSvg, {
          width: ogWidth,
          height: ogHeight,
        }),
      },
      {
        relativePath: GENERATED_ICON_FAVICON_SVG_PATH,
        contents: iconSvg,
      },
      {
        relativePath: GENERATED_ICON_FAVICON_32_PATH,
        contents: await renderSvgPng(iconSvg, { width: 32, height: 32 }),
      },
      {
        relativePath: GENERATED_ICON_192_PATH,
        contents: await renderSvgPng(iconSvg, { width: 192, height: 192 }),
      },
      {
        relativePath: GENERATED_ICON_512_PATH,
        contents: await renderSvgPng(iconSvg, { width: 512, height: 512 }),
      },
      {
        relativePath: GENERATED_SCREENSHOT_HERO_WIDE_PATH,
        contents: await renderSvgPng(heroWideSvg, {
          width: 1280,
          height: 720,
        }),
      },
      {
        relativePath: GENERATED_SCREENSHOT_HERO_NARROW_PATH,
        contents: await renderSvgPng(heroNarrowSvg, {
          width: 720,
          height: 1280,
        }),
      },
      {
        relativePath: GENERATED_SITEMAP_CHUNK_PATH,
        contents: buildSitemapChunk(sitemapEntries),
      },
      ...presetChunks.map((chunk, index) => ({
        relativePath: `public/sitemap-${PRESET_SITEMAP_FIRST_CHUNK + index}.xml`,
        contents: buildSitemapChunk(chunk),
      })),
      {
        relativePath: GENERATED_SITEMAP_INDEX_PATH,
        contents: buildSitemapIndex(sitemapEntries, baseUrl, presetChunks),
      },
      {
        relativePath: GENERATED_PRESET_META_PATH,
        contents: JSON.stringify(await buildPresetMetaMap(rootDir)),
      },
      {
        relativePath: GENERATED_ROBOTS_PATH,
        contents: buildRobotsTxt(baseUrl),
      },
    ],
  };
}

export async function generateSeo(
  rootDir = repoRoot,
  { baseUrl = DEFAULT_BASE_URL }: { baseUrl?: string } = {},
) {
  const publicDir = path.join(rootDir, 'public');

  for (const dir of generatedDirs) {
    await rm(path.join(publicDir, dir), { recursive: true, force: true });
  }

  // Drop stale preset chunks so a shrinking catalog cannot leave orphaned
  // sitemap files that the index no longer references but the host still serves.
  for (const name of await readdir(publicDir).catch(() => [])) {
    const chunkIndex = /^sitemap-(\d+)\.xml$/u.exec(name)?.[1];
    if (chunkIndex && Number(chunkIndex) >= PRESET_SITEMAP_FIRST_CHUNK) {
      await rm(path.join(publicDir, name), { force: true });
    }
  }

  const { files } = await buildSeoArtifacts(rootDir, { baseUrl });
  await Promise.all(
    Array.from(
      new Set(files.map(({ relativePath }) => path.dirname(relativePath))),
    ).map((relativeDir) =>
      mkdir(path.join(rootDir, relativeDir), { recursive: true }),
    ),
  );
  await Promise.all(
    files.map(({ relativePath, contents }) =>
      writeFile(path.join(rootDir, relativePath), contents),
    ),
  );
}

async function main() {
  await generateSeo();
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  await main();
}
