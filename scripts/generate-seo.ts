import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

export const DEFAULT_BASE_URL = 'https://toil.fyi';
export const GENERATED_SITEMAP_CHUNK_PATH = 'public/sitemap-1.xml';
export const GENERATED_SITEMAP_INDEX_PATH = 'public/sitemap.xml';
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

export const buildOgSvg = ({
  title,
  subtitle,
  eyebrow,
  chip,
  accentStart,
  accentEnd,
}: {
  title: string;
  subtitle: string;
  eyebrow: string;
  chip?: string;
  accentStart: string;
  accentEnd: string;
}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${ogWidth}" height="${ogHeight}" viewBox="0 0 ${ogWidth} ${ogHeight}" role="img" aria-label="${escapeHtml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accentStart}" />
      <stop offset="100%" stop-color="${accentEnd}" />
    </linearGradient>
  </defs>
  <rect width="${ogWidth}" height="${ogHeight}" fill="url(#bg)" />
  <circle cx="1060" cy="520" r="210" fill="rgba(255,255,255,0.08)" />
  <circle cx="180" cy="120" r="130" fill="rgba(255,255,255,0.08)" />
  <circle cx="920" cy="140" r="56" fill="rgba(255,255,255,0.18)" />
  <rect x="88" y="86" width="${chip ? '280' : '0'}" height="${chip ? '52' : '0'}" rx="26" fill="rgba(255,255,255,0.12)" />
  ${chip ? `<text x="116" y="120" font-size="28" fill="#f4f7ff" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(chip)}</text>` : ''}
  <text x="88" y="${chip ? '206' : '152'}" font-size="34" fill="#d8e2ff" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(eyebrow)}</text>
  <text x="88" y="${chip ? '306' : '252'}" font-size="72" font-weight="700" fill="#ffffff" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(title)}</text>
  <text x="88" y="${chip ? '372' : '318'}" font-size="30" fill="#dbe4ff" font-family="Space Grotesk, Arial, sans-serif">${escapeHtml(subtitle)}</text>
</svg>`;

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
    path.join(rootDir, 'assets/data/toys.json'),
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
        'assets/data/toys.json',
        'assets/js/toys/milkdrop-toy.ts',
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
      sourcePaths: ['performance/index.html', 'assets/css/performance.css'],
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

export function buildSitemapIndex(
  entries: SitemapEntry[],
  baseUrl = DEFAULT_BASE_URL,
) {
  const lastmod =
    entries.reduce(
      (latest, entry) => (entry.lastmod > latest ? entry.lastmod : latest),
      entries[0]?.lastmod ?? formatDate(new Date()),
    ) ?? formatDate(new Date());

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${baseUrl}/sitemap-1.xml</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>
</sitemapindex>
`;
}

export function buildRobotsTxt(baseUrl = DEFAULT_BASE_URL) {
  return `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`;
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
  const defaultOgSvg = buildOgSvg({
    title: 'Stims',
    subtitle: 'MilkDrop-inspired visuals for your music',
    eyebrow: 'Music-reactive in the browser',
    chip: 'Instant visuals',
    accentStart: '#08131b',
    accentEnd: '#1f5f66',
  });
  const milkdropOgSvg = buildOgSvg({
    title: milkdrop.title,
    subtitle: 'Demo audio, presets, and your own music',
    eyebrow: 'Browser music visualizer',
    chip: 'Start fast',
    accentStart: '#150d2e',
    accentEnd: '#244b9a',
  });
  const performanceOgSvg = buildOgSvg({
    title: 'Compatibility and Performance',
    subtitle: 'Browser support, lighter modes, and first-run guidance',
    eyebrow: 'What to expect before you start',
    chip: 'Performance guide',
    accentStart: '#0a1328',
    accentEnd: '#0d8b8f',
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
      {
        relativePath: GENERATED_SITEMAP_INDEX_PATH,
        contents: buildSitemapIndex(sitemapEntries, baseUrl),
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
