/**
 * Generates the crawlable /learn/ section from the authoring curriculum.
 *
 * The ten authoring tracks, the language reference and two landing pages
 * ("MilkDrop online", "Stims vs Butterchurn vs projectM") used to exist only
 * as markdown on GitHub, so the queries they answer — "how to make a milkdrop
 * preset", "milkdrop online", "butterchurn alternative" — had nothing on the
 * site to rank. This renders them to static HTML under public/learn/, with
 * unique titles, canonicals, TechArticle/FAQ/Breadcrumb JSON-LD, and a
 * footer that links every discover hub and author page from real HTML.
 *
 *   bun run generate:learn            # write public/learn/**
 *   bun run generate:learn -- --check # fail if the files are stale
 *
 * Pages are plain static HTML (no app shell, no JavaScript), served straight
 * from assets. Edit the markdown under docs/authoring/ or docs/learn/, never
 * the output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked, type Tokens } from 'marked';
import { AUTHOR_ROUTES, DISCOVER_ROUTES } from '../functions/discover-slugs.ts';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const BASE_URL = 'https://toil.fyi';
const GITHUB_BLOB = 'https://github.com/zz-plant/stims/blob/main';
const GITHUB_TREE = 'https://github.com/zz-plant/stims/tree/main';
export const LEARN_OUTPUT_DIR = 'public/learn';

export type LearnPage = {
  /** '' is the /learn/ hub. */
  slug: string;
  /** Repo-relative markdown source. */
  source: string;
  /** Text before " | Stims" in <title>; written for the query, not the file. */
  seoTitle: string;
  description: string;
  kind: 'hub' | 'track' | 'landing';
  /** Derive FAQPage JSON-LD from the `## FAQ` section. */
  faq?: boolean;
};

export const LEARN_PAGES: readonly LearnPage[] = [
  {
    slug: '',
    source: 'docs/authoring/README.md',
    seoTitle: 'Learn to Write MilkDrop Presets — Free Course',
    description:
      'A free course in writing MilkDrop presets, from remixing with sliders to shaders. Every example runs live in your browser with nothing to install.',
    kind: 'hub',
  },
  {
    slug: 'milkdrop-online',
    source: 'docs/learn/milkdrop-online.md',
    seoTitle: 'MilkDrop Online — Winamp’s Visualizer in Your Browser',
    description:
      'Run MilkDrop presets in your browser with nothing to install. Watch, play your own music, edit the equations, and import or export .milk files.',
    kind: 'landing',
    faq: true,
  },
  {
    slug: 'milkdrop-vs-butterchurn-projectm',
    source: 'docs/learn/milkdrop-vs-butterchurn-projectm.md',
    seoTitle: 'Stims vs Butterchurn vs projectM',
    description:
      'How Stims, Butterchurn and projectM differ: browser app, embeddable renderer and native library, and which one fits what you want to do.',
    kind: 'landing',
    faq: true,
  },
  {
    slug: 'play',
    source: 'docs/authoring/00-play.md',
    seoTitle: 'Remix a MilkDrop Preset With No Code — Track 0',
    description:
      'Fifteen minutes, no code: find a MilkDrop preset you love, drag its live sliders, remix it with credit preserved, and share it as a link.',
    kind: 'track',
  },
  {
    slug: 'how-milkdrop-thinks',
    source: 'docs/authoring/01-how-milkdrop-thinks.md',
    seoTitle: 'How MilkDrop Works: Feedback, Pipeline, Decay — Track 1',
    description:
      'The mental model behind every MilkDrop preset: the feedback loop, the per-frame and per-pixel pipeline, and what decay and time really do.',
    kind: 'track',
  },
  {
    slug: 'motion',
    source: 'docs/authoring/02-motion.md',
    seoTitle: 'MilkDrop Motion: zoom, rot, dx, sx, warp — Track 2',
    description:
      'Control how a MilkDrop preset moves with zoom, rot, dx/dy, sx/sy and warp, plus a line-by-line dissection of a Geiss classic.',
    kind: 'track',
  },
  {
    slug: 'listening',
    source: 'docs/authoring/03-listening.md',
    seoTitle: 'Audio-Reactive MilkDrop: Bass, Beats, Smoothing — Track 3',
    description:
      'Make a MilkDrop preset react to music: audio bands, smoothing, beat detection without a beat detector, and measuring how reactive it really is.',
    kind: 'track',
  },
  {
    slug: 'warp-fields',
    source: 'docs/authoring/04-warp-fields.md',
    seoTitle: 'MilkDrop Per-Pixel Warp Fields — Track 4',
    description:
      'Per-pixel equations in MilkDrop: rad and ang, tunnels, ripples and other warp fields that change with position across the screen.',
    kind: 'track',
  },
  {
    slug: 'waves-and-shapes',
    source: 'docs/authoring/05-waves-and-shapes.md',
    seoTitle: 'MilkDrop Custom Waves and Shapes — Track 5',
    description:
      'Draw with MilkDrop custom waves and custom shapes, and pass values from per-frame equations into them with the q-variable bridge.',
    kind: 'track',
  },
  {
    slug: 'shaders',
    source: 'docs/authoring/06-shaders.md',
    seoTitle: 'MilkDrop Warp and Composite Shaders — Track 6',
    description:
      'Write MilkDrop warp and composite shaders, the pair used by most of the catalog, with runnable examples and notes on what browsers support.',
    kind: 'track',
  },
  {
    slug: 'taste',
    source: 'docs/authoring/07-taste.md',
    seoTitle: 'MilkDrop Masterworks Dissected — Track 7',
    description:
      'Five celebrated MilkDrop presets taken apart: reaction-diffusion, tempo tracking, hand-rolled HSL and more, to learn what makes them good.',
    kind: 'track',
  },
  {
    slug: 'shipping',
    source: 'docs/authoring/08-shipping.md',
    seoTitle: 'Publishing MilkDrop Presets and Engine Compatibility — Track 8',
    description:
      'What works in MilkDrop, projectM, Butterchurn and Stims: a cross-engine compatibility matrix, performance advice, and how to publish your preset.',
    kind: 'track',
  },
  {
    slug: 'technique-glossary',
    source: 'docs/authoring/09-technique-glossary.md',
    seoTitle: 'MilkDrop Technique Glossary',
    description:
      'The named techniques of MilkDrop presets, like Jelly, Relief and Painterly, counted across the shipped catalog with examples.',
    kind: 'track',
  },
  {
    slug: 'reference',
    source: 'docs/authoring/reference.md',
    seoTitle: 'MilkDrop Language Reference',
    description:
      'Reference for the MilkDrop preset language as Stims implements it: variables, functions, signals and the fields a preset can set.',
    kind: 'track',
  },
];

const pageBySource = new Map(LEARN_PAGES.map((page) => [page.source, page]));

export const learnPagePath = (page: LearnPage) =>
  page.slug ? `/learn/${page.slug}/` : '/learn/';
export const learnPageOutFile = (page: LearnPage) =>
  `${LEARN_OUTPUT_DIR}/${page.slug ? `${page.slug}/` : ''}index.html`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

const decodeEntities = (value: string) =>
  value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&');

const stripTags = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/gu, ''));

/** GitHub-style heading id, so existing `#anchor` links keep working. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/gu, '-');
}

/**
 * Where a link found in `sourceFile` should point on the site: another
 * curriculum page becomes its /learn/ URL, anything else in the repo goes to
 * GitHub, and absolute, site-absolute and anchor links pass through.
 */
export function rewriteLearnHref(href: string, sourceFile: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(href)) return href;
  const [pathPart = '', hash] = href.split('#') as [string, string?];
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourceFile), pathPart),
  );
  const suffix = hash ? `#${hash}` : '';
  const page = pageBySource.get(resolved);
  if (page) return `${learnPagePath(page)}${suffix}`;
  const isDir = pathPart.endsWith('/');
  return `${isDir ? GITHUB_TREE : GITHUB_BLOB}/${resolved.replace(/\/$/u, '')}${suffix}`;
}

export type RenderedMarkdown = {
  html: string;
  h1: string;
  headings: Array<{ depth: number; text: string; id: string }>;
};

export function renderLearnMarkdown(
  markdown: string,
  sourceFile: string,
): RenderedMarkdown {
  const headings: RenderedMarkdown['headings'] = [];
  const usedIds = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = stripTags(inner);
        const base = slugifyHeading(text) || 'section';
        const seen = usedIds.get(base) ?? 0;
        usedIds.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        headings.push({ depth, text, id });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const target = rewriteLearnHref(href, sourceFile);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(target)}"${titleAttr}>${this.parser.parseInline(tokens)}</a>`;
      },
      code({ text, lang }: Tokens.Code) {
        const escaped = escapeHtml(text);
        // Diagrams are mermaid source in the repo. There is no JavaScript on
        // these pages, so show the source as text rather than as broken art.
        if (lang === 'mermaid') {
          return `<details class="diagram"><summary>Diagram (text form)</summary><pre><code>${escaped}</code></pre></details>\n`;
        }
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        return `<pre><code${cls}>${escaped}</code></pre>\n`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false }) as string;
  const h1 = headings.find((heading) => heading.depth === 1)?.text ?? '';
  return { html, h1, headings };
}

/** Q/A pairs from `### question` headings under `## FAQ`, from rendered HTML. */
export function extractFaq(html: string): Array<{ q: string; a: string }> {
  const faqStart = html.search(/<h2 id="faq">/u);
  if (faqStart < 0) return [];
  const section = html.slice(faqStart).replace(/^<h2[^>]*>.*?<\/h2>/su, '');
  const parts = section.split(/<h3 id="[^"]*">/u).slice(1);
  return parts.flatMap((part) => {
    const [question = '', ...rest] = part.split('</h3>');
    const answer = stripTags(rest.join('')).replace(/\s+/gu, ' ').trim();
    const q = stripTags(question).trim();
    return q && answer ? [{ q, a: answer }] : [];
  });
}

const STYLE = `
:root{color-scheme:dark light;--bg:#0b0f1a;--fg:#e8ecf3;--muted:#a9b3c4;--line:rgba(255,255,255,.12);--code:#121a2a;--accent:#5fc0b5;--accent-fg:#0a0f19}
@media(prefers-color-scheme:light){:root{--bg:#f7f8fb;--fg:#141a26;--muted:#4a5568;--line:rgba(0,0,0,.14);--code:#eaeef5;--accent:#0f766e;--accent-fg:#fff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.site-header,.site-footer,main{max-width:48rem;margin:0 auto;padding:0 16px}
.site-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 20px;padding-top:16px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.site-header .brand{font-weight:700;font-size:1.15rem;text-decoration:none;color:var(--fg)}
.site-header nav{display:flex;flex-wrap:wrap;gap:4px 18px}
main{padding-top:24px;padding-bottom:32px}
h1{font-size:2rem;line-height:1.2;margin:.4em 0}
h2{font-size:1.4rem;margin:1.8em 0 .5em;line-height:1.3}
h3{font-size:1.15rem;margin:1.5em 0 .4em}
code{font:.9em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.1em .35em;border-radius:4px}
pre{background:var(--code);padding:12px 14px;border-radius:8px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
blockquote{margin:1em 0;padding:.1em 1em;border-left:3px solid var(--accent);color:var(--muted)}
details{margin:1em 0}
.toc{border:1px solid var(--line);border-radius:8px;padding:8px 16px;margin:1em 0}
.toc ul{margin:.3em 0;padding-left:1.2em}
.cta{display:inline-block;background:var(--accent);color:var(--accent-fg);padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600}
.pager{display:flex;justify-content:space-between;gap:16px;margin:2em 0;flex-wrap:wrap}
.related,.site-footer{border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
.related{margin-top:2em;padding-top:1em}
.site-footer{padding-top:16px;padding-bottom:40px}
.site-footer h2{font-size:.95rem;margin:1em 0 .3em;color:var(--fg)}
.site-footer ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:2px 16px}
`
  .replace(/\s*\n\s*/gu, '')
  .trim();

const NAV_LINKS: Array<[string, string]> = [
  ['/', 'Open the visualizer'],
  ['/learn/', 'Learn'],
  ['/learn/milkdrop-online/', 'MilkDrop online'],
  ['/performance/', 'Compatibility'],
];

const anchor = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

function renderFooter(): string {
  const list = (
    routes: ReadonlyArray<{ slug: string; label: string }>,
    base: string,
  ) =>
    `<ul>${routes.map((route) => `<li>${anchor(`${base}${route.slug}`, route.label)}</li>`).join('')}</ul>`;
  return [
    '<footer class="site-footer">',
    '<h2>Stims</h2>',
    `<ul>${[
      ['/', 'Visualizer'],
      ['/learn/', 'Learn to write presets'],
      ['/learn/milkdrop-online/', 'MilkDrop online'],
      [
        '/learn/milkdrop-vs-butterchurn-projectm/',
        'Stims vs Butterchurn vs projectM',
      ],
      ['/performance/', 'Compatibility and performance'],
      ['https://github.com/zz-plant/stims', 'Source on GitHub'],
    ]
      .map(
        ([href, label]) =>
          `<li>${anchor(href as string, label as string)}</li>`,
      )
      .join('')}</ul>`,
    '<h2>Browse presets by look</h2>',
    list(DISCOVER_ROUTES, '/discover/'),
    '<h2>Browse presets by author</h2>',
    list(AUTHOR_ROUTES, '/author/'),
    '</footer>',
  ].join('\n');
}

/** Ordered pages that get previous/next links: the hub, then the tracks. */
const PAGER_ORDER = LEARN_PAGES.filter((page) => page.kind !== 'landing');

export function renderLearnPage(page: LearnPage): string {
  const markdown = fs.readFileSync(path.join(repoRoot, page.source), 'utf8');
  const { html, h1, headings } = renderLearnMarkdown(markdown, page.source);
  const url = `${BASE_URL}${learnPagePath(page)}`;
  const title = `${page.seoTitle} | Stims`;
  const image = `${BASE_URL}/og/milkdrop.png`;

  const breadcrumbs = [
    { name: 'Stims', url: `${BASE_URL}/` },
    ...(page.slug === '' ? [] : [{ name: 'Learn', url: `${BASE_URL}/learn/` }]),
    { name: h1 || page.seoTitle, url },
  ];
  const graph: Array<Record<string, unknown>> = [
    {
      '@type': page.kind === 'track' ? 'TechArticle' : 'WebPage',
      headline: h1 || page.seoTitle,
      name: page.seoTitle,
      description: page.description,
      url,
      mainEntityOfPage: url,
      inLanguage: 'en',
      image,
      isPartOf: { '@type': 'WebSite', name: 'Stims', url: `${BASE_URL}/` },
      publisher: {
        '@type': 'Organization',
        name: 'Stims',
        url: `${BASE_URL}/`,
      },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: crumb.url,
      })),
    },
  ];
  if (page.faq) {
    const faq = extractFaq(html);
    if (faq.length > 0) {
      graph.push({
        '@type': 'FAQPage',
        mainEntity: faq.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      });
    }
  }
  const jsonLd = JSON.stringify(
    { '@context': 'https://schema.org', '@graph': graph },
    null,
    2,
  ).replace(/</gu, '\\u003c');

  const h2s = headings.filter((heading) => heading.depth === 2);
  const toc =
    h2s.length >= 4
      ? `<nav class="toc" aria-label="On this page"><strong>On this page</strong><ul>${h2s
          .map(
            (heading) => `<li>${anchor(`#${heading.id}`, heading.text)}</li>`,
          )
          .join('')}</ul></nav>`
      : '';

  const index = PAGER_ORDER.indexOf(page);
  const prev = index > 0 ? PAGER_ORDER[index - 1] : undefined;
  const next = index >= 0 ? PAGER_ORDER[index + 1] : undefined;
  const pager =
    prev || next
      ? `<nav class="pager" aria-label="Course navigation"><span>${
          prev ? `← ${anchor(learnPagePath(prev), prev.seoTitle)}` : ''
        }</span><span>${next ? `${anchor(learnPagePath(next), next.seoTitle)} →` : ''}</span></nav>`
      : '';

  const related = `<aside class="related" aria-label="Related pages"><strong>Keep going</strong><ul>${[
    ['/', 'Open the Stims visualizer'],
    ['/learn/', 'Learn to write MilkDrop presets'],
    ['/learn/milkdrop-online/', 'MilkDrop online, in your browser'],
    [
      '/learn/milkdrop-vs-butterchurn-projectm/',
      'Stims vs Butterchurn vs projectM',
    ],
    ['/performance/', 'Compatibility and performance'],
  ]
    .filter(([href]) => href !== learnPagePath(page))
    .map(
      ([href, label]) => `<li>${anchor(href as string, label as string)}</li>`,
    )
    .join('')}</ul></aside>`;

  // Insert the table of contents and the visualizer call to action right
  // after the H1 so they sit above the fold.
  const cta =
    '<p><a class="cta" href="/">Open Stims — it plays with nothing to install</a></p>';
  const body = html.replace(/(<h1[^>]*>.*?<\/h1>\n?)/su, `$1${cta}\n${toc}\n`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(page.description)}" />
<meta name="robots" content="index,follow" />
<meta name="theme-color" content="#0b0f1a" />
<link rel="canonical" href="${url}" />
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
<meta property="og:site_name" content="Stims" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(page.description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(page.description)}" />
<meta name="twitter:image" content="${image}" />
<script type="application/ld+json">
${jsonLd}
</script>
<style>${STYLE}</style>
</head>
<body>
<header class="site-header">
<a class="brand" href="/">Stims</a>
<nav aria-label="Site">${NAV_LINKS.map(([href, label]) => anchor(href, label)).join('')}</nav>
</header>
<main>
<article>
${body}
</article>
${pager}
${related}
</main>
${renderFooter()}
</body>
</html>
`;
}

/** Every generated file: repo-relative path → contents. */
export function buildLearnArtifacts(): Map<string, string> {
  return new Map(
    LEARN_PAGES.map((page) => [learnPageOutFile(page), renderLearnPage(page)]),
  );
}

/** Repo-relative output files that are missing or differ from a fresh build. */
export function findStaleLearnFiles(): string[] {
  const stale: string[] = [];
  for (const [file, contents] of buildLearnArtifacts()) {
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== contents) {
      stale.push(file);
    }
  }
  return stale;
}

function main() {
  if (process.argv.includes('--check')) {
    const stale = findStaleLearnFiles();
    if (stale.length > 0) {
      console.error(
        `Learn pages are stale (${stale.length}): ${stale.join(', ')}\nRun: bun run generate:learn`,
      );
      process.exit(1);
    }
    console.log(`✔ ${LEARN_PAGES.length} learn pages are current`);
    return;
  }
  for (const [file, contents] of buildLearnArtifacts()) {
    const full = path.join(repoRoot, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  console.log(
    `Wrote ${LEARN_PAGES.length} learn pages to ${LEARN_OUTPUT_DIR}/`,
  );
}

if (import.meta.main) main();
