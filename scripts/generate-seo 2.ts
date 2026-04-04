import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = 'https://no.toil.fyi';
const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const ogDir = path.join(publicDir, 'og');
const generatedDirs = ['toys', 'tags', 'moods', 'capabilities', 'discover'];
const ogWidth = 1200;
const ogHeight = 630;

type ToyEntry = {
  slug: string;
  title: string;
  description: string;
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

const buildOgSvg = ({
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

const getSitemapMeta = (url: string) => {
  if (url.endsWith('/milkdrop/')) {
    return { changefreq: 'weekly', priority: '0.9' };
  }

  return { changefreq: 'weekly', priority: '1.0' };
};

const generateSeo = async () => {
  const toysRaw = await readFile(path.join(publicDir, 'toys.json'), 'utf8');
  const toys: ToyEntry[] = JSON.parse(toysRaw);
  const milkdrop =
    toys.find((entry) => entry.slug === 'milkdrop') ??
    ({
      slug: 'milkdrop',
      title: 'MilkDrop Visualizer',
      description:
        'Dedicated Stims launch route for compatibility checks, audio setup, quality tuning, preset browsing, and live editing.',
    } satisfies ToyEntry);

  for (const dir of generatedDirs) {
    await rm(path.join(publicDir, dir), { recursive: true, force: true });
  }

  await mkdir(ogDir, { recursive: true });

  await writeFile(
    path.join(ogDir, 'default.svg'),
    buildOgSvg({
      title: 'Stims',
      subtitle: 'Browser-native MilkDrop visualizer',
      eyebrow: 'Home route',
      chip: 'Explanation first',
      accentStart: '#08131b',
      accentEnd: '#1f5f66',
    }),
  );

  await writeFile(
    path.join(ogDir, 'milkdrop.svg'),
    buildOgSvg({
      title: milkdrop.title,
      subtitle: 'Quick check, audio setup, presets, and live editing',
      eyebrow: 'Launch route',
      chip: '/milkdrop/',
      accentStart: '#150d2e',
      accentEnd: '#244b9a',
    }),
  );

  const today = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: `${baseUrl}/`, image: `${baseUrl}/og/default.svg` },
    { loc: `${baseUrl}/milkdrop/`, image: `${baseUrl}/og/milkdrop.svg` },
  ];

  const sitemapBody = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls
  .map((entry) => {
    const { changefreq, priority } = getSitemapMeta(entry.loc);
    return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
    <image:image>
      <image:loc>${escapeXml(entry.image)}</image:loc>
    </image:image>
  </url>`;
  })
  .join('\n')}
</urlset>
`;

  await writeFile(path.join(publicDir, 'sitemap-1.xml'), sitemapBody);
  await writeFile(
    path.join(publicDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${baseUrl}/sitemap-1.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>
`,
  );
  await writeFile(
    path.join(publicDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`,
  );
};

await generateSeo();
