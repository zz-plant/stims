import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = 'https://no.toil.fyi';
const iconUrl = `${baseUrl}/icons/icon-512.png`;
const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');
const generatedDirs = ['toys', 'tags', 'moods', 'capabilities'];

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

const renderPage = ({
  title,
  description,
  canonical,
  body,
  extraHead = '',
}: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  extraHead?: string;
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${iconUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${iconUrl}" />
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
  await mkdir(toyDir, { recursive: true });
  await mkdir(tagsDir, { recursive: true });
  await mkdir(moodsDir, { recursive: true });
  await mkdir(capabilitiesDir, { recursive: true });

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
        'Browse every audio-reactive toy in the Stim Webtoys Library.',
      canonical: `${baseUrl}/toys/`,
      body: toyIndexBody,
    }),
  );

  for (const toy of toys) {
    const canonical = `${baseUrl}/toys/${toy.slug}/`;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: toy.title,
      description: toy.description,
      applicationCategory: 'Game',
      operatingSystem: 'Web',
      url: canonical,
      image: iconUrl,
    };
    const extraHead = `    <script type="application/ld+json">${JSON.stringify(
      jsonLd,
    )}</script>`;
    const body = `
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
          ${renderToyMetaList(
            'Capabilities',
            [
              toy.capabilities?.microphone ? 'Microphone' : null,
              toy.capabilities?.demoAudio ? 'Demo audio' : null,
              toy.capabilities?.motion ? 'Device motion' : null,
              toy.requiresWebGPU ? 'WebGPU' : null,
            ].filter(Boolean) as string[],
            'capabilities',
          )}
        </div>
      </section>
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
        extraHead: `
${extraHead}
`,
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
        'Browse Stim Webtoys by theme, visuals, and interaction style.',
      canonical: `${baseUrl}/tags/`,
      body: tagsIndexBody,
    }),
  );

  for (const entry of tagEntries) {
    const canonical = `${baseUrl}/tags/${entry.slug}/`;
    const body = `
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
    await mkdir(tagPath, { recursive: true });
    await writeFile(
      path.join(tagPath, 'index.html'),
      renderPage({
        title: `${entry.label} toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} Stim Webtoys tagged ${entry.label}.`,
        canonical,
        body,
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
      description: 'Browse toys by mood and sensory vibe.',
      canonical: `${baseUrl}/moods/`,
      body: moodsIndexBody,
    }),
  );

  for (const entry of moodEntries) {
    const canonical = `${baseUrl}/moods/${entry.slug}/`;
    const body = `
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
    await mkdir(moodPath, { recursive: true });
    await writeFile(
      path.join(moodPath, 'index.html'),
      renderPage({
        title: `${entry.label} mood toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} toys with a ${entry.label} vibe.`,
        canonical,
        body,
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
        'Filter toys by microphone support, demo audio, motion input, and WebGPU.',
      canonical: `${baseUrl}/capabilities/`,
      body: capabilitiesIndexBody,
    }),
  );

  for (const entry of capabilityEntries) {
    const canonical = `${baseUrl}/capabilities/${entry.slug}/`;
    const body = `
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
    await mkdir(capPath, { recursive: true });
    await writeFile(
      path.join(capPath, 'index.html'),
      renderPage({
        title: `${entry.label} toys | Stim Webtoys`,
        description: `Explore ${entry.toys.length} toys with ${entry.label.toLowerCase()} support.`,
        canonical,
        body,
      }),
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const urls = [
    `${baseUrl}/`,
    `${baseUrl}/index.html`,
    `${baseUrl}/toys/`,
    `${baseUrl}/tags/`,
    `${baseUrl}/moods/`,
    `${baseUrl}/capabilities/`,
    ...toys.map((toy) => `${baseUrl}/toys/${toy.slug}/`),
    ...tagEntries.map((entry) => `${baseUrl}/tags/${entry.slug}/`),
    ...moodEntries.map((entry) => `${baseUrl}/moods/${entry.slug}/`),
    ...capabilityEntries.map(
      (entry) => `${baseUrl}/capabilities/${entry.slug}/`,
    ),
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
  await writeFile(path.join(publicDir, 'sitemap.xml'), sitemap);
  await writeFile(
    path.join(publicDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`,
  );
};

await generateSeo();
