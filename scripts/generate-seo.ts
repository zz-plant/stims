import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_BASE_URL = 'https://toil.fyi';
export const GENERATED_SITEMAP_CHUNK_PATH = 'public/sitemap-1.xml';
export const GENERATED_SITEMAP_INDEX_PATH = 'public/sitemap.xml';
export const GENERATED_ROBOTS_PATH = 'public/robots.txt';
export const GENERATED_OG_DEFAULT_PATH = 'public/og/default.svg';
export const GENERATED_OG_MILKDROP_PATH = 'public/og/milkdrop.svg';

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
  contents: string;
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
      imagePath: '/og/milkdrop.svg',
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
      imagePath: '/og/milkdrop.svg',
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

  return {
    sitemapEntries,
    files: [
      {
        relativePath: GENERATED_OG_DEFAULT_PATH,
        contents: buildOgSvg({
          title: 'Stims',
          subtitle: 'MilkDrop-inspired visuals for your music',
          eyebrow: 'Music-reactive in the browser',
          chip: 'Instant visuals',
          accentStart: '#08131b',
          accentEnd: '#1f5f66',
        }),
      },
      {
        relativePath: GENERATED_OG_MILKDROP_PATH,
        contents: buildOgSvg({
          title: milkdrop.title,
          subtitle: 'Demo audio, presets, and your own music',
          eyebrow: 'Browser music visualizer',
          chip: 'Start fast',
          accentStart: '#150d2e',
          accentEnd: '#244b9a',
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

  await mkdir(path.join(publicDir, 'og'), { recursive: true });

  const { files } = await buildSeoArtifacts(rootDir, { baseUrl });
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
