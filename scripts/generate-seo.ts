import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = 'https://no.toil.fyi';
const iconUrl = `${baseUrl}/icons/icon-512.png`;
const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const generatedDirs = ['toys', 'tags', 'moods', 'capabilities', 'og'];
const sitemapChunkSize = 5000;
const ogWidth = 1200;
const ogHeight = 630;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

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
  eyebrow = 'Stim Webtoys Library',
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
  if (url.endsWith('/')) {
    return { changefreq: 'weekly', priority: '0.9' };
  }
  if (url.includes('/toys/')) {
    return { changefreq: 'monthly', priority: '0.8' };
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
  socialImageAlt = 'Stim Webtoys Library icon',
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
    <meta property="og:site_name" content="Stim Webtoys Library" />
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

type ToyEntry = {
  slug: string;
  title: string;
  description: string;
  tags?: string[];
  moods?: string[];
  capabilities?: {
    microphone?: boolean;
    demoAudio?: boolean;
    motion?: boolean;
  };
  requiresWebGPU?: boolean;
};

type BreadcrumbEntry = {
  label: string;
  href: string;
};

const buildTagIndex = (toys: ToyEntry[]) => {
  const tagMap = new Map<
    string,
    { slug: string; label: string; toys: ToyEntry[] }
  >();
  for (const toy of toys) {
    for (const tag of toy.tags ?? []) {
      const slug = slugify(tag);
      if (!tagMap.has(slug)) {
        tagMap.set(slug, { slug, label: tag, toys: [] });
      }
      tagMap.get(slug)?.toys.push(toy);
    }
  }
  return Array.from(tagMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
};

const buildMoodIndex = (toys: ToyEntry[]) => {
  const moodMap = new Map<
    string,
    { slug: string; label: string; toys: ToyEntry[] }
  >();
  for (const toy of toys) {
    for (const mood of toy.moods ?? []) {
      const slug = slugify(mood);
      if (!moodMap.has(slug)) {
        moodMap.set(slug, { slug, label: mood, toys: [] });
      }
      moodMap.get(slug)?.toys.push(toy);
    }
  }
  return Array.from(moodMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
};

const buildCapabilityIndex = (toys: ToyEntry[]) => {
  const capabilities = [
    {
      slug: 'microphone',
      label: 'Microphone ready',
      match: (toy: ToyEntry) => !!toy.capabilities?.microphone,
    },
    {
      slug: 'demo-audio',
      label: 'Demo audio available',
      match: (toy: ToyEntry) => !!toy.capabilities?.demoAudio,
    },
    {
      slug: 'motion',
      label: 'Device motion support',
      match: (toy: ToyEntry) => !!toy.capabilities?.motion,
    },
    {
      slug: 'webgpu',
      label: 'WebGPU enhanced',
      match: (toy: ToyEntry) => !!toy.requiresWebGPU,
    },
  ];
  return capabilities.map((capability) => ({
    ...capability,
    toys: toys.filter(capability.match),
  }));
};

const renderToyList = (toys: ToyEntry[]) =>
  `<ul class="feature-card-grid">${toys
    .map(
      (toy) => `
        <li class="feature-card">
          <h3>${escapeHtml(toy.title)}</h3>
          <p>${escapeHtml(toy.description)}</p>
          <a class="cta-button ghost" href="/toys/${toy.slug}/">View details</a>
          <a class="text-link" href="/toy.html?toy=${toy.slug}">Launch toy</a>
        </li>
      `,
    )
    .join('')}</ul>`;

const renderTagLinks = (
  entries: { slug: string; label: string; toys: ToyEntry[] }[],
) =>
  `<ul class="feature-card-grid">${entries
    .map(
      (entry) => `
        <li class="feature-card">
          <h3>${escapeHtml(entry.label)}</h3>
          <p>${entry.toys.length} toys</p>
          <a class="cta-button ghost" href="/tags/${entry.slug}/">View toys</a>
        </li>
      `,
    )
    .join('')}</ul>`;

const renderMoodLinks = (
  entries: { slug: string; label: string; toys: ToyEntry[] }[],
) =>
  `<ul class="feature-card-grid">${entries
    .map(
      (entry) => `
        <li class="feature-card">
          <h3>${escapeHtml(entry.label)}</h3>
          <p>${entry.toys.length} toys</p>
          <a class="cta-button ghost" href="/moods/${entry.slug}/">View toys</a>
        </li>
      `,
    )
    .join('')}</ul>`;

const renderCapabilityLinks = (
  entries: { slug: string; label: string; toys: ToyEntry[] }[],
) =>
  `<ul class="feature-card-grid">${entries
    .map(
      (entry) => `
        <li class="feature-card">
          <h3>${escapeHtml(entry.label)}</h3>
          <p>${entry.toys.length} toys</p>
          <a class="cta-button ghost" href="/capabilities/${entry.slug}/">View toys</a>
        </li>
      `,
    )
    .join('')}</ul>`;

const renderToyMetaList = (label: string, items: string[], basePath: string) =>
  items.length
    ? `
      <div class="feature-card">
        <h3>${escapeHtml(label)}</h3>
        <ul>
          ${items
            .map(
              (item) =>
                `<li><a class="text-link" href="/${basePath}/${slugify(item)}/">${escapeHtml(
                  item,
                )}</a></li>`,
            )
            .join('')}
        </ul>
      </div>
    `
    : '';

const renderCapabilityMetaList = (
  label: string,
  items: { label: string; slug: string }[],
) =>
  items.length
    ? `
      <div class="feature-card">
        <h3>${escapeHtml(label)}</h3>
        <ul>
          ${items
            .map(
              (item) =>
                `<li><a class="text-link" href="/capabilities/${item.slug}/">${escapeHtml(
                  item.label,
                )}</a></li>`,
            )
            .join('')}
        </ul>
      </div>
    `
    : '';

const renderBreadcrumbs = (entries: BreadcrumbEntry[]) =>
  `<nav aria-label="Breadcrumb" class="breadcrumb-nav">
    <ol>
      ${entries
        .map(
          (entry, index) =>
            `<li>${
              index === entries.length - 1
                ? `<span aria-current="page">${escapeHtml(entry.label)}</span>`
                : `<a class="text-link" href="${entry.href}">${escapeHtml(entry.label)}</a>`
            }</li>`,
        )
        .join('')}
    </ol>
  </nav>`;

const buildBreadcrumbJsonLd = (entries: BreadcrumbEntry[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: entries.map((entry, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: entry.label,
    item: `${baseUrl}${entry.href}`,
  })),
});

const buildFaqItems = (toy: ToyEntry) => {
  const capabilityLines = [
    toy.capabilities?.microphone
      ? 'Supports live microphone input.'
      : 'No live microphone required.',
    toy.capabilities?.demoAudio
      ? 'Includes demo audio mode.'
      : 'No built-in demo audio mode.',
    toy.capabilities?.motion
      ? 'Supports device motion interactions.'
      : 'No device motion input required.',
    toy.requiresWebGPU
      ? 'Uses WebGPU for enhanced effects and needs a compatible browser/device.'
      : 'Runs without WebGPU requirements.',
  ];
  return [
    {
      question: `What is ${toy.title}?`,
      answer: toy.description,
    },
    {
      question: `How do I start ${toy.title}?`,
      answer: `Open the toy and press Launch. Then enable microphone or demo audio options if prompted for the most reactive visuals.`,
    },
    {
      question: `What capabilities does ${toy.title} support?`,
      answer: capabilityLines.join(' '),
    },
  ];
};

const buildFaqJsonLd = (
  items: {
    question: string;
    answer: string;
  }[],
) => ({
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

const renderFaqSection = (
  items: {
    question: string;
    answer: string;
  }[],
) => `
  <section>
    <div class="section-heading">
      <p class="eyebrow">FAQ</p>
      <h2>About this toy</h2>
    </div>
    <dl class="feature-card-grid">
      ${items
        .map(
          (item) => `
        <div class="feature-card">
          <dt><strong>${escapeHtml(item.question)}</strong></dt>
          <dd>${escapeHtml(item.answer)}</dd>
        </div>
      `,
        )
        .join('')}
    </dl>
  </section>
`;

const buildRelatedToys = (toy: ToyEntry, toys: ToyEntry[]) => {
  const currentTags = new Set(toy.tags ?? []);
  const currentMoods = new Set(toy.moods ?? []);
  return toys
    .filter((candidate) => candidate.slug !== toy.slug)
    .map((candidate) => {
      let score = 0;
      for (const tag of candidate.tags ?? []) {
        if (currentTags.has(tag)) score += 2;
      }
      for (const mood of candidate.moods ?? []) {
        if (currentMoods.has(mood)) score += 2;
      }
      if (toy.capabilities?.microphone === candidate.capabilities?.microphone)
        score += 1;
      if (toy.capabilities?.demoAudio === candidate.capabilities?.demoAudio)
        score += 1;
      if (toy.capabilities?.motion === candidate.capabilities?.motion)
        score += 1;
      if (toy.requiresWebGPU === candidate.requiresWebGPU) score += 1;
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => entry.candidate);
};

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
    name: 'Stim Webtoys Library',
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

const generateSeo = async () => {
  const toysRaw = await readFile(path.join(publicDir, 'toys.json'), 'utf8');
  const toys: ToyEntry[] = JSON.parse(toysRaw);

  for (const dir of generatedDirs) {
    await rm(path.join(publicDir, dir), { recursive: true, force: true });
  }

  const toyDir = path.join(publicDir, 'toys');
  const tagsDir = path.join(publicDir, 'tags');
  const moodsDir = path.join(publicDir, 'moods');
  const capabilitiesDir = path.join(publicDir, 'capabilities');
  const ogDir = path.join(publicDir, 'og');
  await mkdir(toyDir, { recursive: true });
  await mkdir(tagsDir, { recursive: true });
  await mkdir(moodsDir, { recursive: true });
  await mkdir(capabilitiesDir, { recursive: true });
  await mkdir(ogDir, { recursive: true });

  const defaultOgSvg = buildOgSvg({
    title: 'Stim Webtoys',
    subtitle: 'Audio-reactive sensory visual play',
    eyebrow: 'Stim Webtoys Library',
    accentStart: '#0b1024',
    accentEnd: '#26377f',
  });
  await writeFile(path.join(ogDir, 'default.svg'), defaultOgSvg);

  const toysIndexOgFile = 'toys.svg';
  const tagsIndexOgFile = 'tags.svg';
  const moodsIndexOgFile = 'moods.svg';
  const capabilitiesIndexOgFile = 'capabilities.svg';
  await writeFile(
    path.join(ogDir, toysIndexOgFile),
    buildOgSvg({
      title: 'All toys',
      subtitle: 'Browse every interactive audio-reactive visual toy',
      eyebrow: 'Stim Webtoys collection',
      accentStart: '#22113f',
      accentEnd: '#3b82f6',
      chip: 'SEO collection page',
    }),
  );
  await writeFile(
    path.join(ogDir, tagsIndexOgFile),
    buildOgSvg({
      title: 'Tags',
      subtitle: 'Explore themes, interactions, and visual styles',
      eyebrow: 'Stim Webtoys discovery',
      accentStart: '#0b3b35',
      accentEnd: '#0ea5a0',
      chip: 'Browse by tag',
    }),
  );
  await writeFile(
    path.join(ogDir, moodsIndexOgFile),
    buildOgSvg({
      title: 'Moods',
      subtitle: 'Find visuals that match your sensory flow',
      eyebrow: 'Stim Webtoys discovery',
      accentStart: '#3b1027',
      accentEnd: '#9333ea',
      chip: 'Browse by mood',
    }),
  );
  await writeFile(
    path.join(ogDir, capabilitiesIndexOgFile),
    buildOgSvg({
      title: 'Capabilities',
      subtitle: 'Filter toys by microphone, motion, audio, and WebGPU',
      eyebrow: 'Stim Webtoys discovery',
      accentStart: '#1f2937',
      accentEnd: '#2563eb',
      chip: 'Browse by capability',
    }),
  );

  const tagEntries = buildTagIndex(toys);
  const moodEntries = buildMoodIndex(toys);
  const capabilityEntries = buildCapabilityIndex(toys);

  const toyIndexBody = `
    <section class="intro">
      <div class="section-heading">
        <p class="eyebrow">Stim Webtoys</p>
        <h1>All toys</h1>
        <p class="section-description">
          Browse every audio-reactive toy in the Stim library. Launch any toy or open its detail page for more context.
        </p>
        <a class="text-link" href="/index.html">Back to library</a>
      </div>
    </section>
    <section>
      ${renderToyList(toys)}
    </section>
  `;

  await writeFile(
    path.join(toyDir, 'index.html'),
    renderPage({
      title: 'All toys | Stim Webtoys Library',
      description:
        'Browse every audio-reactive visual toy for sensory play, calming exploration, and responsive creative visuals.',
      canonical: `${baseUrl}/toys/`,
      body: toyIndexBody,
      keywords: [
        'audio-reactive visual toys',
        'sensory play',
        'interactive web toys',
        'three.js webgl toys',
      ],
      extraHead: `
    <script type="application/ld+json">${JSON.stringify(
      buildCollectionJsonLd({
        canonical: `${baseUrl}/toys/`,
        title: 'All toys | Stim Webtoys Library',
        description:
          'Browse every audio-reactive visual toy for sensory play, calming exploration, and responsive creative visuals.',
        toys,
      }),
    )}</script>
`,
      socialImage: `${baseUrl}/og/${toysIndexOgFile}`,
      socialImageAlt: 'Stim Webtoys collection preview image',
      socialImageType: 'image/svg+xml',
      socialImageWidth: ogWidth,
      socialImageHeight: ogHeight,
    }),
  );

  for (const toy of toys) {
    const canonical = `${baseUrl}/toys/${toy.slug}/`;
    const capabilityMeta = capabilityEntries
      .filter((entry) => entry.match(toy))
      .map((entry) => ({ label: entry.label, slug: entry.slug }));
    const breadcrumbs = [
      { label: 'Home', href: '/' },
      { label: 'All toys', href: '/toys/' },
      { label: toy.title, href: `/toys/${toy.slug}/` },
    ];
    const faqItems = buildFaqItems(toy);
    const relatedToys = buildRelatedToys(toy, toys);
    const ogSvg = buildOgSvg({
      title: toy.title,
      subtitle: 'Interactive audio-reactive web toy',
      eyebrow: 'Stim Webtoys toy page',
      accentStart: '#1a0c33',
      accentEnd: '#1d4ed8',
      chip: 'Launch now',
    });
    await writeFile(path.join(ogDir, `${toy.slug}.svg`), ogSvg);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: toy.title,
      description: toy.description,
      applicationCategory: 'Game',
      operatingSystem: 'Web',
      url: canonical,
      image: `${baseUrl}/og/${toy.slug}.svg`,
      isAccessibleForFree: true,
      audience: {
        '@type': 'Audience',
        audienceType:
          'People seeking interactive audio-reactive visuals for sensory-friendly creative play',
      },
      keywords: Array.from(
        new Set([...(toy.tags ?? []), ...(toy.moods ?? []), 'audio-reactive']),
      ),
    };
    const extraHead = `
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script type="application/ld+json">${JSON.stringify(buildBreadcrumbJsonLd(breadcrumbs))}</script>
    <script type="application/ld+json">${JSON.stringify(buildFaqJsonLd(faqItems))}</script>
`;
    const body = `
      ${renderBreadcrumbs(breadcrumbs)}
      <section class="intro">
        <div class="section-heading">
          <p class="eyebrow">Stim Webtoys</p>
          <h1>${escapeHtml(toy.title)}</h1>
          <p class="section-description">${escapeHtml(toy.description)}</p>
          <div class="cta-row">
            <a class="cta-button primary" href="/toy.html?toy=${toy.slug}">Launch toy</a>
            <a class="cta-button ghost" href="/index.html#toy-list">Back to library</a>
          </div>
        </div>
      </section>
      <section class="feature-bands">
        <div class="feature-card-grid">
          ${renderToyMetaList('Tags', toy.tags ?? [], 'tags')}
          ${renderToyMetaList('Moods', toy.moods ?? [], 'moods')}
          ${renderCapabilityMetaList('Capabilities', capabilityMeta)}
        </div>
      </section>
      <section>
        <div class="section-heading">
          <p class="eyebrow">Related</p>
          <h2>More toys you might like</h2>
        </div>
        ${renderToyList(relatedToys)}
      </section>
      ${renderFaqSection(faqItems)}
    `;

    const toyPath = path.join(toyDir, toy.slug);
    await mkdir(toyPath, { recursive: true });
    await writeFile(
      path.join(toyPath, 'index.html'),
      renderPage({
        title: `${toy.title} | Stim Webtoys`,
        description: toy.description,
        canonical,
        body,
        keywords: Array.from(
          new Set([
            toy.slug,
            toy.title,
            ...(toy.tags ?? []),
            ...(toy.moods ?? []),
            'audio-reactive toy',
            'sensory visualizer',
          ]),
        ),
        extraHead: `
${extraHead}
`,
        socialImage: `${baseUrl}/og/${toy.slug}.svg`,
        socialImageAlt: `${toy.title} preview image`,
        socialImageType: 'image/svg+xml',
        socialImageWidth: ogWidth,
        socialImageHeight: ogHeight,
      }),
    );
  }

  const tagsIndexBody = `
    <section class="intro">
      <div class="section-heading">
        <p class="eyebrow">Stim Webtoys</p>
        <h1>Tags</h1>
        <p class="section-description">Explore toys by theme, visuals, and interaction style.</p>
        <a class="text-link" href="/index.html">Back to library</a>
      </div>
    </section>
    <section>
      ${renderTagLinks(tagEntries)}
    </section>
  `;
  await writeFile(
    path.join(tagsDir, 'index.html'),
    renderPage({
      title: 'Tags | Stim Webtoys Library',
      description:
        'Browse audio-reactive toys by visual theme, interaction style, and sensory-friendly tags.',
      canonical: `${baseUrl}/tags/`,
      body: tagsIndexBody,
      keywords: [
        'visual toy tags',
        'audio reactive themes',
        'sensory friendly toys',
      ],
      socialImage: `${baseUrl}/og/${tagsIndexOgFile}`,
      socialImageAlt: 'Stim Webtoys tags page preview image',
      socialImageType: 'image/svg+xml',
      socialImageWidth: ogWidth,
      socialImageHeight: ogHeight,
    }),
  );

  for (const entry of tagEntries) {
    const canonical = `${baseUrl}/tags/${entry.slug}/`;
    const body = `
      ${renderBreadcrumbs([
        { label: 'Home', href: '/' },
        { label: 'Tags', href: '/tags/' },
        { label: entry.label, href: `/tags/${entry.slug}/` },
      ])}
      <section class="intro">
        <div class="section-heading">
          <p class="eyebrow">Tag</p>
          <h1>${escapeHtml(entry.label)}</h1>
          <p class="section-description">${entry.toys.length} toys with this tag.</p>
          <a class="text-link" href="/tags/">All tags</a>
        </div>
      </section>
      <section>
        ${renderToyList(entry.toys)}
      </section>
    `;
    const tagPath = path.join(tagsDir, entry.slug);
    const tagOgFile = `tag-${entry.slug}.svg`;
    await writeFile(
      path.join(ogDir, tagOgFile),
      buildOgSvg({
        title: `${entry.label} toys`,
        subtitle: `${entry.toys.length} toy${entry.toys.length === 1 ? '' : 's'} in this tag`,
        eyebrow: 'Stim Webtoys tag collection',
        accentStart: '#0f2f4f',
        accentEnd: '#2563eb',
        chip: `Tag: ${entry.label}`,
      }),
    );
    await mkdir(tagPath, { recursive: true });
    await writeFile(
      path.join(tagPath, 'index.html'),
      renderPage({
        title: `${entry.label} toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} Stim Webtoys tagged ${entry.label}.`,
        canonical,
        body,
        keywords: [
          `${entry.label} toys`,
          `${entry.label} visualizers`,
          'audio-reactive web toys',
        ],
        extraHead: `
    <script type="application/ld+json">${JSON.stringify(
      buildBreadcrumbJsonLd([
        { label: 'Home', href: '/' },
        { label: 'Tags', href: '/tags/' },
        { label: entry.label, href: `/tags/${entry.slug}/` },
      ]),
    )}</script>
    <script type="application/ld+json">${JSON.stringify(
      buildCollectionJsonLd({
        canonical,
        title: `${entry.label} toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} Stim Webtoys tagged ${entry.label}.`,
        toys: entry.toys,
      }),
    )}</script>
`,
        socialImage: `${baseUrl}/og/${tagOgFile}`,
        socialImageAlt: `${entry.label} tag page preview image`,
        socialImageType: 'image/svg+xml',
        socialImageWidth: ogWidth,
        socialImageHeight: ogHeight,
      }),
    );
  }

  const moodsIndexBody = `
    <section class="intro">
      <div class="section-heading">
        <p class="eyebrow">Stim Webtoys</p>
        <h1>Moods</h1>
        <p class="section-description">Find the mood that matches your sensory flow.</p>
        <a class="text-link" href="/index.html">Back to library</a>
      </div>
    </section>
    <section>
      ${renderMoodLinks(moodEntries)}
    </section>
  `;
  await writeFile(
    path.join(moodsDir, 'index.html'),
    renderPage({
      title: 'Moods | Stim Webtoys Library',
      description:
        'Browse toys by mood and sensory vibe, from calming visuals to playful, energetic stims.',
      canonical: `${baseUrl}/moods/`,
      body: moodsIndexBody,
      keywords: ['mood visualizer', 'calming visuals', 'sensory vibe toys'],
      socialImage: `${baseUrl}/og/${moodsIndexOgFile}`,
      socialImageAlt: 'Stim Webtoys moods page preview image',
      socialImageType: 'image/svg+xml',
      socialImageWidth: ogWidth,
      socialImageHeight: ogHeight,
    }),
  );

  for (const entry of moodEntries) {
    const canonical = `${baseUrl}/moods/${entry.slug}/`;
    const body = `
      ${renderBreadcrumbs([
        { label: 'Home', href: '/' },
        { label: 'Moods', href: '/moods/' },
        { label: entry.label, href: `/moods/${entry.slug}/` },
      ])}
      <section class="intro">
        <div class="section-heading">
          <p class="eyebrow">Mood</p>
          <h1>${escapeHtml(entry.label)}</h1>
          <p class="section-description">${entry.toys.length} toys that match this mood.</p>
          <a class="text-link" href="/moods/">All moods</a>
        </div>
      </section>
      <section>
        ${renderToyList(entry.toys)}
      </section>
    `;
    const moodPath = path.join(moodsDir, entry.slug);
    const moodOgFile = `mood-${entry.slug}.svg`;
    await writeFile(
      path.join(ogDir, moodOgFile),
      buildOgSvg({
        title: `${entry.label} mood`,
        subtitle: `${entry.toys.length} toy${entry.toys.length === 1 ? '' : 's'} with this vibe`,
        eyebrow: 'Stim Webtoys mood collection',
        accentStart: '#3f1239',
        accentEnd: '#c026d3',
        chip: `Mood: ${entry.label}`,
      }),
    );
    await mkdir(moodPath, { recursive: true });
    await writeFile(
      path.join(moodPath, 'index.html'),
      renderPage({
        title: `${entry.label} mood toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} toys with a ${entry.label} vibe.`,
        canonical,
        body,
        keywords: [
          `${entry.label} mood toys`,
          `${entry.label} sensory visuals`,
          'audio-reactive web toys',
        ],
        extraHead: `
    <script type="application/ld+json">${JSON.stringify(
      buildBreadcrumbJsonLd([
        { label: 'Home', href: '/' },
        { label: 'Moods', href: '/moods/' },
        { label: entry.label, href: `/moods/${entry.slug}/` },
      ]),
    )}</script>
    <script type="application/ld+json">${JSON.stringify(
      buildCollectionJsonLd({
        canonical,
        title: `${entry.label} mood toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} toys with a ${entry.label} vibe.`,
        toys: entry.toys,
      }),
    )}</script>
`,
        socialImage: `${baseUrl}/og/${moodOgFile}`,
        socialImageAlt: `${entry.label} mood page preview image`,
        socialImageType: 'image/svg+xml',
        socialImageWidth: ogWidth,
        socialImageHeight: ogHeight,
      }),
    );
  }

  const capabilitiesIndexBody = `
    <section class="intro">
      <div class="section-heading">
        <p class="eyebrow">Stim Webtoys</p>
        <h1>Capabilities</h1>
        <p class="section-description">Match toys to microphone, demo audio, motion, or WebGPU support.</p>
        <a class="text-link" href="/index.html">Back to library</a>
      </div>
    </section>
    <section>
      ${renderCapabilityLinks(capabilityEntries)}
    </section>
  `;
  await writeFile(
    path.join(capabilitiesDir, 'index.html'),
    renderPage({
      title: 'Capabilities | Stim Webtoys Library',
      description:
        'Find toys by microphone support, demo audio, device motion, and WebGPU so you can play with the setup you have.',
      canonical: `${baseUrl}/capabilities/`,
      body: capabilitiesIndexBody,
      keywords: [
        'microphone visualizer',
        'demo audio toys',
        'webgpu visual toys',
      ],
      socialImage: `${baseUrl}/og/${capabilitiesIndexOgFile}`,
      socialImageAlt: 'Stim Webtoys capabilities page preview image',
      socialImageType: 'image/svg+xml',
      socialImageWidth: ogWidth,
      socialImageHeight: ogHeight,
    }),
  );

  for (const entry of capabilityEntries) {
    const canonical = `${baseUrl}/capabilities/${entry.slug}/`;
    const body = `
      ${renderBreadcrumbs([
        { label: 'Home', href: '/' },
        { label: 'Capabilities', href: '/capabilities/' },
        { label: entry.label, href: `/capabilities/${entry.slug}/` },
      ])}
      <section class="intro">
        <div class="section-heading">
          <p class="eyebrow">Capability</p>
          <h1>${escapeHtml(entry.label)}</h1>
          <p class="section-description">${entry.toys.length} toys support this capability.</p>
          <a class="text-link" href="/capabilities/">All capabilities</a>
        </div>
      </section>
      <section>
        ${renderToyList(entry.toys)}
      </section>
    `;
    const capPath = path.join(capabilitiesDir, entry.slug);
    const capabilityOgFile = `capability-${entry.slug}.svg`;
    await writeFile(
      path.join(ogDir, capabilityOgFile),
      buildOgSvg({
        title: `${entry.label} toys`,
        subtitle: `${entry.toys.length} toy${entry.toys.length === 1 ? '' : 's'} support this`,
        eyebrow: 'Stim Webtoys capability collection',
        accentStart: '#1f2937',
        accentEnd: '#0ea5e9',
        chip: `Capability: ${entry.label}`,
      }),
    );
    await mkdir(capPath, { recursive: true });
    await writeFile(
      path.join(capPath, 'index.html'),
      renderPage({
        title: `${entry.label} toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} toys with ${entry.label.toLowerCase()} support.`,
        canonical,
        body,
        keywords: [
          `${entry.label} toys`,
          `${entry.label} support`,
          'audio-reactive web toys',
        ],
        extraHead: `
    <script type="application/ld+json">${JSON.stringify(
      buildBreadcrumbJsonLd([
        { label: 'Home', href: '/' },
        { label: 'Capabilities', href: '/capabilities/' },
        { label: entry.label, href: `/capabilities/${entry.slug}/` },
      ]),
    )}</script>
    <script type="application/ld+json">${JSON.stringify(
      buildCollectionJsonLd({
        canonical,
        title: `${entry.label} toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} toys with ${entry.label.toLowerCase()} support.`,
        toys: entry.toys,
      }),
    )}</script>
`,
        socialImage: `${baseUrl}/og/${capabilityOgFile}`,
        socialImageAlt: `${entry.label} capability page preview image`,
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
    { loc: `${baseUrl}/toys/`, image: `${baseUrl}/og/${toysIndexOgFile}` },
    { loc: `${baseUrl}/tags/`, image: `${baseUrl}/og/${tagsIndexOgFile}` },
    { loc: `${baseUrl}/moods/`, image: `${baseUrl}/og/${moodsIndexOgFile}` },
    {
      loc: `${baseUrl}/capabilities/`,
      image: `${baseUrl}/og/${capabilitiesIndexOgFile}`,
    },
    ...toys.map((toy) => ({
      loc: `${baseUrl}/toys/${toy.slug}/`,
      image: `${baseUrl}/og/${toy.slug}.svg`,
    })),
    ...tagEntries.map((entry) => ({
      loc: `${baseUrl}/tags/${entry.slug}/`,
      image: `${baseUrl}/og/tag-${entry.slug}.svg`,
    })),
    ...moodEntries.map((entry) => ({
      loc: `${baseUrl}/moods/${entry.slug}/`,
      image: `${baseUrl}/og/mood-${entry.slug}.svg`,
    })),
    ...capabilityEntries.map((entry) => ({
      loc: `${baseUrl}/capabilities/${entry.slug}/`,
      image: `${baseUrl}/og/capability-${entry.slug}.svg`,
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
