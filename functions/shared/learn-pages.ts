/**
 * The /learn/ curriculum's page list and URL mapping, shared by the build
 * script (scripts/generate-learn-pages.ts, which renders the HTML and the
 * markdown siblings) and the site worker (functions/_middleware.ts, which
 * negotiates `Accept: text/markdown` against the generated .md files). Pure
 * data — no node imports, so the worker bundle stays clean.
 *
 * The ten authoring tracks, the language reference and two landing pages
 * ("MilkDrop online", "Stims vs Butterchurn vs projectM") used to exist only
 * as markdown on GitHub, so the queries they answer — "how to make a milkdrop
 * preset", "milkdrop online", "butterchurn alternative" — had nothing on the
 * site to rank.
 */

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

/** Source-file path → page, so markdown links between curriculum files map. */
export const learnPageBySource = new Map(
  LEARN_PAGES.map((page) => [page.source, page]),
);

const pageBySlug = new Map(LEARN_PAGES.map((page) => [page.slug, page]));

export const learnPagePath = (page: LearnPage) =>
  page.slug ? `/learn/${page.slug}/` : '/learn/';
export const learnPageOutFile = (page: LearnPage) =>
  `${LEARN_OUTPUT_DIR}/${page.slug ? `${page.slug}/` : ''}index.html`;

/**
 * The markdown sibling of a learn page: `/learn.md` for the hub,
 * `/learn/<slug>.md` for every other page. Also the value of the pages'
 * `<link rel="alternate" type="text/markdown">` and their content-negotiated
 * representation in the worker.
 */
export const learnMarkdownPath = (page: LearnPage) =>
  page.slug ? `/learn/${page.slug}.md` : '/learn.md';
export const learnMarkdownOutFile = (page: LearnPage) =>
  page.slug ? `${LEARN_OUTPUT_DIR}/${page.slug}.md` : 'public/learn.md';

/**
 * What a request to a /learn* URL asks for: the HTML page, its markdown
 * sibling, or nothing (an unknown path keeps its 404).
 */
export type LearnRequestTarget =
  | { kind: 'html'; page: LearnPage }
  | { kind: 'markdown'; page: LearnPage };

export function learnRequestTarget(
  pathname: string,
): LearnRequestTarget | null {
  if (pathname === '/learn' || pathname === '/learn/') {
    return { kind: 'html', page: pageBySlug.get('')! };
  }
  if (pathname === '/learn.md') {
    return { kind: 'markdown', page: pageBySlug.get('')! };
  }
  if (pathname.startsWith('/learn/')) {
    const rest = pathname.slice('/learn/'.length);
    const mdMatch = /^([\w-]+)\.md$/u.exec(rest);
    if (mdMatch) {
      const page = pageBySlug.get(mdMatch[1] ?? '');
      return page ? { kind: 'markdown', page } : null;
    }
    const slug = rest.replace(/\/$/u, '');
    if (slug && !slug.includes('/')) {
      const page = pageBySlug.get(slug);
      return page ? { kind: 'html', page } : null;
    }
  }
  return null;
}
