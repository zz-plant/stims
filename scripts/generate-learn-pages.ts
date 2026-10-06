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
    seoTitle: 'MilkDrop Online — Play and Edit Presets in Your Browser',
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
      'How Stims, Butterchurn, and projectM differ (browser app, embeddable renderer, and native library) and which one fits what you want to do.',
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
      'Control how a MilkDrop preset moves with zoom, rot, dx/dy, sx/sy, and warp, plus a line-by-line dissection of a Geiss classic.',
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
      'Per-pixel equations in MilkDrop: rad and ang, tunnels, ripples, and other warp fields that change with position across the screen.',
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
      'Five celebrated MilkDrop presets taken apart: reaction-diffusion, tempo tracking, hand-rolled HSL, and more, to learn what makes them good.',
    kind: 'track',
  },
  {
    slug: 'shipping',
    source: 'docs/authoring/08-shipping.md',
    seoTitle: 'Publishing MilkDrop Presets and Engine Compatibility — Track 8',
    description:
      'What works in MilkDrop, projectM, Butterchurn, and Stims: a cross-engine compatibility matrix, performance advice, and how to publish your preset.',
    kind: 'track',
  },
  {
    slug: 'technique-glossary',
    source: 'docs/authoring/09-technique-glossary.md',
    seoTitle: 'MilkDrop Technique Glossary',
    description:
      'The named techniques of MilkDrop presets, like Jelly, Relief, and Painterly, counted across the shipped catalog with examples.',
    kind: 'track',
  },
  {
    slug: 'reference',
    source: 'docs/authoring/reference.md',
    seoTitle: 'MilkDrop Language Reference',
    description:
      'Reference for the MilkDrop preset language as Stims implements it: variables, functions, signals, and the fields a preset can set.',
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
        const inner = this.parser.parseInline(tokens);
        // "▶ Run …" links open the example in the live editor: style them as
        // the primary action of the lesson rather than as inline text.
        const cls = stripTags(inner).trimStart().startsWith('▶')
          ? ' class="run-link"'
          : '';
        return `<a${cls} href="${escapeHtml(target)}"${titleAttr}>${inner}</a>`;
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
  // Wide tables scroll inside a focusable, labelled region with edge shadows
  // so a phone reader can see there is more to the right.
  const html = (marked.parse(markdown, { async: false }) as string)
    .replace(
      /<table>/gu,
      '<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table"><table>',
    )
    .replace(/<\/table>/gu, '</table></div>');
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
@font-face{font-family:Archivo;font-style:normal;font-weight:100 900;font-stretch:62% 125%;font-display:swap;src:url(/fonts/archivo-latin-var.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Martian Mono";font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/martian-mono-latin-875.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{color-scheme:dark light;--bg:#0b0f1a;--fg:#e8ecf3;--muted:#a9b3c4;--line:rgba(255,255,255,.12);--code:#121a2a;--accent:#5fc0b5;--accent-fg:#0a0f19;--glow:rgba(95,192,181,.16);--zebra:rgba(255,255,255,.035);--shadow:rgba(95,192,181,.4)}
@media(prefers-color-scheme:light){:root{--bg:#f7f8fb;--fg:#141a26;--muted:#4a5568;--line:rgba(0,0,0,.14);--code:#eaeef5;--accent:#0f766e;--accent-fg:#fff;--glow:rgba(15,118,110,.09);--zebra:rgba(0,0,0,.035);--shadow:rgba(0,0,0,.22)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg) radial-gradient(60rem 22rem at 50% -6rem,var(--glow),transparent) no-repeat;color:var(--fg);font:1rem/1.7 Archivo,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-underline-offset:.18em;text-decoration-thickness:1px}
a:focus-visible,[tabindex]:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
img{max-width:100%;height:auto}
.site-header,.site-footer,main{max-width:48rem;margin:0 auto;padding-left:16px;padding-right:16px}
.site-header{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;padding-top:14px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.brand{display:inline-flex;align-items:center;gap:8px;margin-right:auto;font-weight:700;font-size:1.2rem;letter-spacing:-.01em;text-decoration:none;color:var(--fg)}
.brand:before{content:"";width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
.links{display:flex;flex-wrap:wrap;gap:2px 16px;order:3;flex-basis:100%}
.links a{color:var(--muted);text-decoration:none;font-size:.95rem;padding:4px 0}
.links a:hover{color:var(--fg);text-decoration:underline}
.nav-cta{order:2;background:var(--accent);color:var(--accent-fg);text-decoration:none;font-weight:600;font-size:.95rem;padding:8px 16px;border-radius:999px}
.nav-cta:hover{filter:brightness(1.08)}
@media(min-width:640px){.links{order:1;flex-basis:auto;gap:2px 20px}.brand{order:0}}
main{padding-top:28px;padding-bottom:32px}
h1{font-size:clamp(1.9rem,6vw,2.7rem);line-height:1.15;letter-spacing:-.02em;margin:.3em 0 .5em}
h2{font-size:1.5rem;line-height:1.3;letter-spacing:-.01em;margin:2em 0 .5em;padding-top:.6em;border-top:1px solid var(--line);scroll-margin-top:16px}
h3{font-size:1.15rem;margin:1.6em 0 .4em;scroll-margin-top:16px}
p,li{max-width:42rem}
code{font:.82em "Martian Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.12em .38em;border-radius:5px}
pre{background:var(--code);padding:14px 16px;border-radius:10px;border:1px solid var(--line);overflow-x:auto;line-height:1.55}
pre code{background:none;padding:0;font-size:.8rem}
.table-wrap{margin:1.2em 0;border:1px solid var(--line);border-radius:10px;overflow-x:auto;background:linear-gradient(to right,var(--bg) 30%,transparent) 0 0/40px 100% no-repeat local,linear-gradient(to left,var(--bg) 30%,transparent) 100% 0/40px 100% no-repeat local,radial-gradient(farthest-side at 0 50%,var(--shadow),transparent) 0 0/14px 100% no-repeat scroll,radial-gradient(farthest-side at 100% 50%,var(--shadow),transparent) 100% 0/14px 100% no-repeat scroll}
table{border-collapse:collapse;min-width:100%;font-size:.95rem}
th,td{padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{font-weight:700;background:var(--zebra);white-space:nowrap}
tbody tr:nth-child(even){background:var(--zebra)}
td:first-child{min-width:7rem}
blockquote{margin:1.2em 0;padding:.2em 1.1em;border-left:3px solid var(--accent);background:var(--zebra);border-radius:0 8px 8px 0;color:var(--muted)}
details{margin:1em 0}
summary{cursor:pointer;color:var(--muted)}
.toc{border:1px solid var(--line);border-radius:12px;padding:10px 18px;margin:1.2em 0;background:var(--zebra)}
.toc ul{margin:.4em 0;padding-left:1.2em}
.toc a{text-decoration:none}
.toc a:hover{text-decoration:underline}
.run-link{display:inline-block;padding:.3em 1em;border:1px solid var(--accent);border-radius:999px;font-weight:600;text-decoration:none;line-height:1.5}
.run-link:hover{background:var(--accent);color:var(--accent-fg)}
.cta{display:inline-block;background:var(--accent);color:var(--accent-fg);padding:11px 22px;border-radius:12px;text-decoration:none;font-weight:600}
.cta:hover{filter:brightness(1.08)}
.try{margin:2.5em 0 1em;padding:20px 22px;border:1px solid var(--line);border-radius:14px;background:var(--zebra)}
.try p{margin:.2em 0 .8em}
.pager{display:grid;gap:12px;margin:1.5em 0}
@media(min-width:640px){.pager{grid-template-columns:1fr 1fr}.pager .next{grid-column:2}}
.pager a{display:block;padding:10px 14px;border:1px solid var(--line);border-radius:10px;text-decoration:none;max-width:100%}
.pager a:hover{border-color:var(--accent)}
.pager .next{text-align:right}
.site-footer{border-top:1px solid var(--line);color:var(--muted);font-size:.9rem;padding-top:8px;padding-bottom:48px}
.site-footer h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;margin:1.4em 0 .5em;padding:0;border:0;color:var(--fg)}
.site-footer ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 18px}
.site-footer a{color:var(--muted)}
.site-footer a:hover{color:var(--accent)}
`
  .replace(/\s*\n\s*/gu, '')
  .trim();

const NAV_LINKS: Array<[string, string]> = [
  ['/learn/', 'Learn'],
  ['/learn/milkdrop-online/', 'MilkDrop online'],
  ['/learn/milkdrop-vs-butterchurn-projectm/', 'Compare'],
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
      ? `<nav class="pager" aria-label="Course navigation">${
          prev
            ? `<a rel="prev" href="${escapeHtml(learnPagePath(prev))}">← ${escapeHtml(prev.seoTitle)}</a>`
            : ''
        }${
          next
            ? `<a class="next" rel="next" href="${escapeHtml(learnPagePath(next))}">${escapeHtml(next.seoTitle)} →</a>`
            : ''
        }</nav>`
      : '';

  // The header already carries an "Open Stims" button, so a second one under
  // every track title was noise. Landing pages, where the visitor may not know
  // what Stims is, keep the hero button; every page ends with a try-it card.
  const cta =
    page.kind === 'track'
      ? ''
      : '<p><a class="cta" href="/">Open Stims — no install needed</a></p>';
  const body = html.replace(/(<h1[^>]*>.*?<\/h1>\n?)/su, `$1${cta}\n${toc}\n`);
  const tryIt =
    '<aside class="try" aria-label="Try Stims"><p><strong>Try it now.</strong> Stims plays MilkDrop presets in your browser, with nothing to install.</p><p><a class="cta" href="/">Open Stims</a></p></aside>';

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
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
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
<nav class="links" aria-label="Site">${NAV_LINKS.map(([href, label]) => anchor(href, label)).join('')}</nav>
<a class="nav-cta" href="/">Open Stims</a>
</header>
<main>
<article>
${body}
${tryIt}
</article>
${pager}
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
