/** Curated semantic routes shared by the edge and browser workspace. */
import { resolveHandleKey } from '../src/js/milkdrop/preset-handles.ts';

export type SemanticDiscoveryRoute = {
  kind: 'topic' | 'author';
  slug: string;
  label: string;
  description: string;
  collectionTag?: string;
  searchQuery?: string;
  author?: string;
};

export const DISCOVER_ROUTES: readonly SemanticDiscoveryRoute[] = [
  {
    kind: 'topic',
    slug: 'audio-reactive',
    label: 'Audio-Reactive',
    collectionTag: 'collection:audio-reactive',
    description:
      'MilkDrop presets that react to the audio you play, in your browser.',
  },
  {
    kind: 'topic',
    slug: 'ambient',
    label: 'Ambient',
    searchQuery: 'ambient',
    description:
      'Slow, atmospheric MilkDrop presets, playing live in your browser.',
  },
  {
    kind: 'topic',
    slug: 'fractal',
    label: 'Fractal',
    searchQuery: 'fractal',
    description:
      'Recursive and fractal MilkDrop presets, playing live in your browser.',
  },
  {
    kind: 'topic',
    slug: 'geometric',
    label: 'Geometric',
    searchQuery: 'geometric',
    description: 'MilkDrop presets built from lines, shapes, and symmetry.',
  },
  {
    kind: 'topic',
    slug: 'hall-of-fame',
    label: 'Hall of Fame',
    collectionTag: 'collection:hall-of-fame',
    description: 'Hand-picked MilkDrop presets from the Stims catalog.',
  },
  {
    kind: 'topic',
    slug: 'neon',
    label: 'Neon',
    searchQuery: 'neon',
    description: 'Bright, high-contrast neon MilkDrop presets.',
  },
  {
    kind: 'topic',
    slug: 'particles',
    label: 'Particle',
    searchQuery: 'particles',
    description: 'Particle-based MilkDrop presets that react to music.',
  },
  {
    kind: 'topic',
    slug: 'psychedelic',
    label: 'Psychedelic',
    searchQuery: 'psychedelic',
    description:
      'Psychedelic MilkDrop presets built on color feedback and warping.',
  },
  {
    kind: 'topic',
    slug: 'space',
    label: 'Space',
    searchQuery: 'space',
    description: 'Space-themed MilkDrop presets: stars, tunnels, and nebulae.',
  },
  {
    kind: 'topic',
    slug: 'trippy',
    label: 'Trippy',
    searchQuery: 'trippy',
    description:
      'Trippy MilkDrop presets with feedback trails and shifting geometry.',
  },
  {
    kind: 'topic',
    slug: 'tunnel',
    label: 'Tunnel',
    searchQuery: 'tunnel',
    description:
      'MilkDrop presets that fly you down a tunnel in time with the music.',
  },
  {
    kind: 'topic',
    slug: 'waveform',
    label: 'Waveform',
    searchQuery: 'waveform',
    description: 'MilkDrop presets built around the live audio waveform.',
  },
];

export const AUTHOR_ROUTES: readonly SemanticDiscoveryRoute[] = [
  {
    kind: 'author',
    slug: 'geiss',
    label: 'Geiss',
    author: 'Geiss',
    description:
      'MilkDrop presets credited to Geiss. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'flexi',
    label: 'Flexi',
    author: 'Flexi',
    description:
      'MilkDrop presets credited to Flexi. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'martin',
    label: 'Martin',
    author: 'Martin',
    description:
      'MilkDrop presets credited to Martin. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'rovastar',
    label: 'Rovastar',
    author: 'Rovastar',
    description:
      'MilkDrop presets credited to Rovastar. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'eo-s',
    label: 'Eo.S.',
    author: 'Eo.S.',
    description:
      'MilkDrop presets credited to Eo.S.. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'phat',
    label: 'Phat',
    author: 'Phat',
    description:
      'MilkDrop presets credited to Phat. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'stahlregen',
    label: 'Stahlregen',
    author: 'Stahlregen',
    description:
      'MilkDrop presets credited to Stahlregen. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'unchained',
    label: 'Unchained',
    author: 'Unchained',
    description:
      'MilkDrop presets credited to Unchained. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'fishbrain',
    label: 'Fishbrain',
    author: 'Fishbrain',
    description:
      'MilkDrop presets credited to Fishbrain. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'aderrasi',
    label: 'Aderrasi',
    author: 'Aderrasi',
    description:
      'MilkDrop presets credited to Aderrasi. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'zylot',
    label: 'Zylot',
    author: 'Zylot',
    description:
      'MilkDrop presets credited to Zylot. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'shifter',
    label: 'Shifter',
    author: 'Shifter',
    description:
      'MilkDrop presets credited to Shifter. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'mig',
    label: 'Mig',
    author: 'Mig',
    description:
      'MilkDrop presets credited to Mig. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'orb',
    label: 'ORB',
    author: 'ORB',
    description:
      'MilkDrop presets credited to ORB. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'suksma',
    label: 'Suksma',
    author: 'suksma',
    description:
      'MilkDrop presets credited to Suksma. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'cope',
    label: 'Cope',
    author: 'cope',
    description:
      'MilkDrop presets credited to Cope. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'goody',
    label: 'Goody',
    author: 'Goody',
    description:
      'MilkDrop presets credited to Goody. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'krash',
    label: 'Krash',
    author: 'Krash',
    description:
      'MilkDrop presets credited to Krash. Each one plays live in your browser.',
  },
  // Every credited hand with at least AUTHOR_HUB_MIN_PRESETS indexable presets
  // has a page; tests/unit/preset-catalog-index.test.ts fails when the catalog
  // grows one that does not. Labels are spelled as the catalog credits them,
  // the way Browse's author filter lists them.
  {
    kind: 'author',
    slug: 'royal',
    label: 'Royal',
    author: 'Royal',
    description:
      'MilkDrop presets credited to Royal. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'amandio-c',
    label: 'amandio c',
    author: 'amandio c',
    description:
      'MilkDrop presets credited to amandio c. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'bdrv',
    label: 'BDRV',
    author: 'BDRV',
    description:
      'MilkDrop presets credited to BDRV. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'hexcollie',
    label: 'Hexcollie',
    author: 'Hexcollie',
    description:
      'MilkDrop presets credited to Hexcollie. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'yin',
    label: 'Yin',
    author: 'Yin',
    description:
      'MilkDrop presets credited to Yin. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'luxxx',
    label: 'LuxXx',
    author: 'LuxXx',
    description:
      'MilkDrop presets credited to LuxXx. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'adamfx',
    label: 'AdamFX',
    author: 'AdamFX',
    description:
      'MilkDrop presets credited to AdamFX. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'beta106i',
    label: 'beta106i',
    author: 'beta106i',
    description:
      'MilkDrop presets credited to beta106i. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'tonymilkdrop',
    label: 'TonyMilkdrop',
    author: 'TonyMilkdrop',
    description:
      'MilkDrop presets credited to TonyMilkdrop. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'loadus',
    label: 'Loadus',
    author: 'Loadus',
    description:
      'MilkDrop presets credited to Loadus. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'pieturp',
    label: 'PieturP',
    author: 'PieturP',
    description:
      'MilkDrop presets credited to PieturP. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'evet',
    label: 'Evet',
    author: 'Evet',
    description:
      'MilkDrop presets credited to Evet. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'rozzor',
    label: 'Rozzor',
    author: 'Rozzor',
    description:
      'MilkDrop presets credited to Rozzor. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'tripgnosis',
    label: 'Tripgnosis',
    author: 'Tripgnosis',
    description:
      'MilkDrop presets credited to Tripgnosis. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'bmelgren',
    label: 'Bmelgren',
    author: 'Bmelgren',
    description:
      'MilkDrop presets credited to Bmelgren. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'idiot',
    label: 'Idiot',
    author: 'Idiot',
    description:
      'MilkDrop presets credited to Idiot. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'illusion',
    label: 'Illusion',
    author: 'Illusion',
    description:
      'MilkDrop presets credited to Illusion. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'esotic',
    label: 'Esotic',
    author: 'Esotic',
    description:
      'MilkDrop presets credited to Esotic. Each one plays live in your browser.',
  },
  {
    kind: 'author',
    slug: 'shadowharlequin',
    label: 'ShadowHarlequin',
    author: 'ShadowHarlequin',
    description:
      'MilkDrop presets credited to ShadowHarlequin. Each one plays live in your browser.',
  },
];

/**
 * A credited hand with this many indexable presets gets an /author/ page.
 */
export const AUTHOR_HUB_MIN_PRESETS = 10;

export const DISCOVER_SLUGS = DISCOVER_ROUTES.map((route) => route.slug);
export const AUTHOR_SLUGS = AUTHOR_ROUTES.map((route) => route.slug);

const DISCOVER_ROUTES_BY_SLUG = new Map(
  DISCOVER_ROUTES.map((route) => [route.slug, route] as const),
);
const AUTHOR_ROUTES_BY_SLUG = new Map(
  AUTHOR_ROUTES.map((route) => [route.slug, route] as const),
);

export function isAllowedDiscoverSlug(slug: string): boolean {
  return DISCOVER_ROUTES_BY_SLUG.has(slug);
}

export function isAllowedAuthorSlug(slug: string): boolean {
  return AUTHOR_ROUTES_BY_SLUG.has(slug);
}

/**
 * Retired discover slugs and the path each now redirects to, so a retired
 * page keeps its inbound links instead of turning into a 404.
 */
const RETIRED_DISCOVER_SLUGS = new Map<string, string>([
  // Held exactly the hall of fame's presets, because every preset runs on
  // the WebGPU renderer.
  ['webgpu-showcase', '/discover/hall-of-fame'],
  // Its search ("retro") matched no preset's title, author, id or tags, so
  // the page and its Browse list were empty. The catalog has no tag for the
  // style; the full index is the nearest page that lists anything.
  ['retro', '/presets/'],
]);

/** Where a retired `/discover/<slug>` path now lives, or null. */
export function retiredDiscoverTarget(pathname: string): string | null {
  const [, namespace, slug, extra] = pathname.split('/');
  if (namespace !== 'discover' || !slug || extra) return null;
  return RETIRED_DISCOVER_SLUGS.get(slug) ?? null;
}

/**
 * The curated author page for one credited handle, or null. Spelling drift
 * ("_Geiss", "eo.s") resolves through the handle registry, the same way the
 * author pages decide which presets they list. A whole chain such as
 * "Stahlregen + Geiss" is not a handle; split it with creditedHandles first.
 */
export function findAuthorRoute(handle: string): SemanticDiscoveryRoute | null {
  const key = resolveHandleKey(handle);
  if (!key) return null;
  return (
    AUTHOR_ROUTES.find(
      (route) => resolveHandleKey(route.author ?? route.label) === key,
    ) ?? null
  );
}

/** The page heading for a curated route: "Geiss MilkDrop Presets". */
export function semanticRouteHeading(route: SemanticDiscoveryRoute): string {
  return route.kind === 'author'
    ? `${route.label} MilkDrop Presets`
    : `${route.label} Music Visualizers`;
}

export function resolveSemanticRoute(
  pathname: string,
): SemanticDiscoveryRoute | null {
  const [, namespace, slug, extra] = pathname.split('/');
  if (!slug || extra) return null;
  if (namespace === 'discover') {
    return DISCOVER_ROUTES_BY_SLUG.get(slug) ?? null;
  }
  if (namespace === 'author') {
    return AUTHOR_ROUTES_BY_SLUG.get(slug) ?? null;
  }
  return null;
}
