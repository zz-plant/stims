import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = 'https://no.toil.fyi';
const iconUrl = `${baseUrl}/icons/icon-512.png`;
const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const generatedDirs = [
  'toys',
  'tags',
  'moods',
  'capabilities',
  'discover',
  'og',
];
const sitemapChunkSize = 5000;
const ogWidth = 1200;
const ogHeight = 630;

type ToyEntry = {
  slug: string;
  title: string;
  description: string;
  tags?: string[];
  moods?: string[];
};

type BreadcrumbEntry = {
  label: string;
  href: string;
};

type FaqEntry = {
  question: string;
  answer: string;
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

const truncateOgText = (value: string, maxChars: number) =>
  value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;

const buildOgSvg = ({
  title,
  subtitle,
  eyebrow = 'Stim Webtoys',
  accentStart = '#0b1024',
  accentEnd = '#26377f',
  chip,
}: {
  title: string;
  subtitle: string;
  eyebrow?: string;
  accentStart?: string;
  accentEnd?: string;
  chip?: string;
}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${ogWidth}" height="${ogHeight}" viewBox="0 0 ${ogWidth} ${ogHeight}" role="img" aria-label="${escapeHtml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accentStart}" />
      <stop offset="100%" stop-color="${accentEnd}" />
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.25)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0)" />
    </linearGradient>
  </defs>
  <rect width="${ogWidth}" height="${ogHeight}" fill="url(#bg)" />
  <rect x="0" y="0" width="${ogWidth}" height="${ogHeight}" fill="url(#shine)" opacity="0.4" />
  <circle cx="1035" cy="540" r="160" fill="rgba(255,255,255,0.12)" />
  <circle cx="160" cy="100" r="120" fill="rgba(255,255,255,0.1)" />
  ${
    chip
      ? `<rect x="90" y="92" width="${Math.max(220, Math.min(560, chip.length * 15))}" height="56" rx="28" fill="rgba(255,255,255,0.14)" />
  <text x="120" y="128" font-size="30" fill="#f7f9ff" font-family="Inter, Arial, sans-serif">${escapeHtml(truncateOgText(chip, 36))}</text>`
      : ''
  }
  <text x="90" y="${chip ? '220' : '170'}" font-size="40" fill="#dbe4ff" font-family="Inter, Arial, sans-serif">${escapeHtml(truncateOgText(eyebrow, 44))}</text>
  <text x="90" y="${chip ? '322' : '272'}" font-size="72" font-weight="700" fill="#ffffff" font-family="Inter, Arial, sans-serif">${escapeHtml(truncateOgText(title, 30))}</text>
  <text x="90" y="${chip ? '392' : '342'}" font-size="32" fill="#e2e8ff" font-family="Inter, Arial, sans-serif">${escapeHtml(truncateOgText(subtitle, 56))}</text>
</svg>`;

const getSitemapMeta = (url: string) => {
  if (url.includes('/toys/')) {
    return { changefreq: 'monthly', priority: '0.8' };
  }
  if (url.endsWith('/')) {
    return { changefreq: 'weekly', priority: '0.9' };
  }
  return { changefreq: 'monthly', priority: '0.7' };
};

const renderPage = ({
  title,
  description,
  canonical,
  body,
  keywords,
  extraHead = '',
  socialImage = iconUrl,
  socialImageAlt = 'Stim Webtoys icon',
  socialImageType = 'image/png',
  socialImageWidth = 512,
  socialImageHeight = 512,
  twitterImage,
  twitterImageAlt,
}: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  keywords?: string[];
  extraHead?: string;
  socialImage?: string;
  socialImageAlt?: string;
  socialImageType?: string;
  socialImageWidth?: number;
  socialImageHeight?: number;
  twitterImage?: string;
  twitterImageAlt?: string;
}) => {
  const resolvedTwitterImage =
    twitterImage ??
    (socialImageType === 'image/svg+xml' ? iconUrl : socialImage);
  const resolvedTwitterImageAlt = twitterImageAlt ?? socialImageAlt;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow" />
    ${keywords?.length ? `<meta name="keywords" content="${escapeHtml(keywords.join(', '))}" />` : ''}
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta property="og:image:type" content="${socialImageType}" />
    <meta property="og:image:width" content="${socialImageWidth}" />
    <meta property="og:image:height" content="${socialImageHeight}" />
    <meta property="og:image:alt" content="${escapeHtml(socialImageAlt)}" />
    <meta property="og:site_name" content="Stim Webtoys" />
    <meta property="og:locale" content="en_US" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${resolvedTwitterImage}" />
    <meta name="twitter:image:alt" content="${escapeHtml(resolvedTwitterImageAlt)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <link rel="stylesheet" href="/assets/css/base.css" />
    <link rel="stylesheet" href="/assets/css/index.css" />
    <title>${escapeHtml(title)}</title>
${extraHead}
  </head>
  <body>
    <div class="content">
      ${body}
    </div>
  </body>
</html>
`;
};

const renderBreadcrumbs = (entries: BreadcrumbEntry[]) => `
  <nav aria-label="Breadcrumb">
    <ol class="breadcrumb-list">
      ${entries
        .map((entry, index) =>
          index === entries.length - 1
            ? `<li><span aria-current="page">${escapeHtml(entry.label)}</span></li>`
            : `<li><a class="text-link" href="${entry.href}">${escapeHtml(entry.label)}</a></li>`,
        )
        .join('')}
    </ol>
  </nav>
`;

const renderToyList = (toys: ToyEntry[]) => `
  <div class="feature-card-grid">
    ${toys
      .map(
        (toy) => `
      <article class="feature-card">
        <h2>${escapeHtml(toy.title)}</h2>
        <p>${escapeHtml(toy.description)}</p>
        <div class="cta-row">
          <a class="cta-button primary" href="/toy.html?toy=${toy.slug}">Launch toy</a>
          <a class="cta-button ghost" href="/toys/${toy.slug}/">Details</a>
        </div>
      </article>
    `,
      )
      .join('')}
  </div>
`;

const renderMetaList = (label: string, items: string[]) => {
  if (!items.length) {
    return '';
  }

  return `
    <article class="feature-card">
      <h2>${escapeHtml(label)}</h2>
      <p>${items.map(escapeHtml).join(', ')}</p>
    </article>
  `;
};

const buildBreadcrumbJsonLd = (entries: BreadcrumbEntry[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: entries.map((entry, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: entry.label,
    item: `${baseUrl}${entry.href === '/' ? '/' : entry.href}`,
  })),
});

const buildCollectionJsonLd = ({
  canonical,
  title,
  description,
  toys,
}: {
  canonical: string;
  title: string;
  description: string;
  toys: ToyEntry[];
}) => ({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: title,
  description,
  url: canonical,
  isPartOf: {
    '@type': 'WebSite',
    name: 'Stims',
    url: baseUrl,
  },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: toys.map((toy, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: toy.title,
      url: `${baseUrl}/toys/${toy.slug}/`,
    })),
  },
});

const buildFaqItems = (toy: ToyEntry): FaqEntry[] => [
  {
    question: `What is ${toy.title}?`,
    answer: `${toy.title} is an interactive browser-native visual toy in Stims.`,
  },
  {
    question: `How do I launch ${toy.title}?`,
    answer: `Open the Stims player at /toy.html?toy=${toy.slug} to start ${toy.title}.`,
  },
  {
    question: `What kind of experience does ${toy.title} offer?`,
    answer: toy.description,
  },
];

const buildFaqJsonLd = (items: FaqEntry[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.answer,
    },
  })),
});

const renderFaqSection = (items: FaqEntry[]) => `
  <section>
    <div class="section-heading">
      <p class="eyebrow">Before you open it</p>
      <h2>What to expect</h2>
    </div>
    <div class="feature-card-grid">
      ${items
        .map(
          (item) => `
        <article class="feature-card">
          <h3>${escapeHtml(item.question)}</h3>
          <p>${escapeHtml(item.answer)}</p>
        </article>
      `,
        )
        .join('')}
    </div>
  </section>
`;

const generateSeo = async () => {
  const toysRaw = await readFile(path.join(publicDir, 'toys.json'), 'utf8');
  const toys: ToyEntry[] = JSON.parse(toysRaw);

  for (const dir of generatedDirs) {
    await rm(path.join(publicDir, dir), { recursive: true, force: true });
  }

  const toyDir = path.join(publicDir, 'toys');
  const ogDir = path.join(publicDir, 'og');
  await mkdir(toyDir, { recursive: true });
  await mkdir(ogDir, { recursive: true });

  await writeFile(
    path.join(ogDir, 'default.svg'),
    buildOgSvg({
      title: 'Stims',
      subtitle: 'Browser-native MilkDrop-inspired visualizer',
      eyebrow: 'Launch Stims',
      accentStart: '#0b1024',
      accentEnd: '#26377f',
    }),
  );

  const toysIndexOgFile = 'toys.svg';
  await writeFile(
    path.join(ogDir, toysIndexOgFile),
    buildOgSvg({
      title: 'Toy library',
      subtitle: 'Browse the curated Stims visualizer collection',
      eyebrow: 'Stims browse',
      accentStart: '#22113f',
      accentEnd: '#3b82f6',
      chip: 'Curated collection',
    }),
  );

  const toyIndexCanonical = `${baseUrl}/toys/`;
  const toyIndexTitle = 'Toy library | Stims';
  const toyIndexDescription =
    'Browse the curated Stims visualizer collection and open any toy directly in the shared player.';
  const toyIndexBody = `
    <section class="intro">
      <div class="section-heading">
        <p class="eyebrow">Stims</p>
        <h1>Library</h1>
        <p class="section-description">
          Open MilkDrop directly, or browse the rest of the visualizer library first.
        </p>
        <div class="cta-row">
          <a class="cta-button primary" href="/toy.html?toy=milkdrop">Open MilkDrop</a>
          <a class="cta-button ghost" href="/index.html#toy-list">Browse on homepage</a>
        </div>
      </div>
    </section>
    <section>
      ${renderToyList(toys)}
    </section>
  `;
  await writeFile(
    path.join(toyDir, 'index.html'),
    renderPage({
      title: toyIndexTitle,
      description: toyIndexDescription,
      canonical: toyIndexCanonical,
      body: toyIndexBody,
      keywords: [
        'browser visualizer',
        'audio-reactive toys',
        'milkdrop inspired visualizer',
      ],
      extraHead: `
    <script type="application/ld+json">${JSON.stringify(
      buildCollectionJsonLd({
        canonical: toyIndexCanonical,
        title: toyIndexTitle,
        description: toyIndexDescription,
        toys,
      }),
    )}</script>
`,
      socialImage: `${baseUrl}/og/${toysIndexOgFile}`,
      socialImageAlt: 'Stims toy library preview image',
      socialImageType: 'image/svg+xml',
      socialImageWidth: ogWidth,
      socialImageHeight: ogHeight,
    }),
  );

  for (const toy of toys) {
    const canonical = `${baseUrl}/toys/${toy.slug}/`;
    const breadcrumbs = [
      { label: 'Home', href: '/' },
      { label: 'Toy library', href: '/toys/' },
      { label: toy.title, href: `/toys/${toy.slug}/` },
    ];
    const faqItems = buildFaqItems(toy);
    const ogFile = `${toy.slug}.svg`;

    await writeFile(
      path.join(ogDir, ogFile),
      buildOgSvg({
        title: toy.title,
        subtitle: 'Interactive browser-native visualizer page',
        eyebrow: 'Stims toy page',
        accentStart: '#1a0c33',
        accentEnd: '#1d4ed8',
        chip: 'Launch now',
      }),
    );

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: toy.title,
      description: toy.description,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web',
      url: canonical,
      image: `${baseUrl}/og/${ogFile}`,
      isAccessibleForFree: true,
      keywords: Array.from(
        new Set([
          toy.slug,
          toy.title,
          ...(toy.tags ?? []),
          ...(toy.moods ?? []),
          'audio-reactive',
          'browser visualizer',
        ]),
      ),
    };

    const body = `
      ${renderBreadcrumbs(breadcrumbs)}
      <section class="intro">
        <div class="section-heading">
          <p class="eyebrow">Stims visualizer</p>
          <h1>${escapeHtml(toy.title)}</h1>
          <p class="section-description">${escapeHtml(toy.description)}</p>
          <div class="cta-row">
            <a class="cta-button primary" href="/toy.html?toy=${toy.slug}">Open visualizer</a>
            <a class="cta-button ghost" href="/toys/">Back to library</a>
          </div>
        </div>
      </section>
      <section class="feature-bands">
        <div class="feature-card-grid">
          ${renderMetaList('Tags', toy.tags ?? [])}
          ${renderMetaList('Moods', toy.moods ?? [])}
        </div>
      </section>
      ${renderFaqSection(faqItems)}
    `;

    const toyPath = path.join(toyDir, toy.slug);
    await mkdir(toyPath, { recursive: true });
    await writeFile(
      path.join(toyPath, 'index.html'),
      renderPage({
        title: `${toy.title} | Stims`,
        description: toy.description,
        canonical,
        body,
        keywords: Array.from(
          new Set([
            toy.slug,
            toy.title,
            ...(toy.tags ?? []),
            ...(toy.moods ?? []),
            'browser visualizer',
            'audio-reactive toy',
          ]),
        ),
        extraHead: `
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script type="application/ld+json">${JSON.stringify(buildBreadcrumbJsonLd(breadcrumbs))}</script>
    <script type="application/ld+json">${JSON.stringify(buildFaqJsonLd(faqItems))}</script>
`,
        socialImage: `${baseUrl}/og/${ogFile}`,
        socialImageAlt: `${toy.title} preview image`,
        socialImageType: 'image/svg+xml',
        socialImageWidth: ogWidth,
        socialImageHeight: ogHeight,
      }),
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: `${baseUrl}/`, image: `${baseUrl}/og/default.svg` },
    { loc: `${baseUrl}/index.html`, image: `${baseUrl}/og/default.svg` },
    { loc: `${baseUrl}/toy.html`, image: `${baseUrl}/og/default.svg` },
    { loc: toyIndexCanonical, image: `${baseUrl}/og/${toysIndexOgFile}` },
    ...toys.map((toy) => ({
      loc: `${baseUrl}/toys/${toy.slug}/`,
      image: `${baseUrl}/og/${toy.slug}.svg`,
    })),
  ];

  const sitemapChunks: string[] = [];
  for (let index = 0; index < urls.length; index += sitemapChunkSize) {
    const chunk = urls.slice(index, index + sitemapChunkSize);
    const sitemapName = `sitemap-${Math.floor(index / sitemapChunkSize) + 1}.xml`;
    const sitemapBody = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${chunk
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
    await writeFile(path.join(publicDir, sitemapName), sitemapBody);
    sitemapChunks.push(sitemapName);
  }

  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapChunks
  .map(
    (sitemapName) => `  <sitemap>
    <loc>${baseUrl}/${sitemapName}</loc>
    <lastmod>${today}</lastmod>
  </sitemap>`,
  )
  .join('\n')}
</sitemapindex>
`;
  await writeFile(path.join(publicDir, 'sitemap.xml'), sitemapIndex);
  await writeFile(
    path.join(publicDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`,
  );
};

await generateSeo();
