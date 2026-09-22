/** Curated semantic routes shared by the edge and browser workspace. */
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
    slug: 'retro',
    label: 'Retro',
    searchQuery: 'retro',
    description:
      'Retro MilkDrop presets in the style of early music visualizers.',
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
  {
    kind: 'topic',
    slug: 'webgpu-showcase',
    label: 'WebGPU Showcase',
    collectionTag: 'collection:webgpu-showcase',
    description: "MilkDrop presets that run on Stims' WebGPU renderer.",
  },
];

export const AUTHOR_ROUTES: readonly SemanticDiscoveryRoute[] = [
  {
    kind: 'author',
    slug: 'geiss',
    label: 'Geiss',
    author: 'Geiss',
    description:
      'MilkDrop presets credited to Geiss, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'flexi',
    label: 'Flexi',
    author: 'Flexi',
    description:
      'MilkDrop presets credited to Flexi, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'martin',
    label: 'Martin',
    author: 'Martin',
    description:
      'MilkDrop presets credited to Martin, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'rovastar',
    label: 'Rovastar',
    author: 'Rovastar',
    description:
      'MilkDrop presets credited to Rovastar, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'eo-s',
    label: 'Eo.S.',
    author: 'Eo.S.',
    description:
      'MilkDrop presets credited to Eo.S., playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'phat',
    label: 'Phat',
    author: 'Phat',
    description:
      'MilkDrop presets credited to Phat, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'stahlregen',
    label: 'Stahlregen',
    author: 'Stahlregen',
    description:
      'MilkDrop presets credited to Stahlregen, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'unchained',
    label: 'Unchained',
    author: 'Unchained',
    description:
      'MilkDrop presets credited to Unchained, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'fishbrain',
    label: 'Fishbrain',
    author: 'Fishbrain',
    description:
      'MilkDrop presets credited to Fishbrain, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'aderrasi',
    label: 'Aderrasi',
    author: 'Aderrasi',
    description:
      'MilkDrop presets credited to Aderrasi, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'zylot',
    label: 'Zylot',
    author: 'Zylot',
    description:
      'MilkDrop presets credited to Zylot, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'shifter',
    label: 'Shifter',
    author: 'Shifter',
    description:
      'MilkDrop presets credited to Shifter, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'mig',
    label: 'Mig',
    author: 'Mig',
    description:
      'MilkDrop presets credited to Mig, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'orb',
    label: 'ORB',
    author: 'ORB',
    description:
      'MilkDrop presets credited to ORB, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'suksma',
    label: 'Suksma',
    author: 'suksma',
    description:
      'MilkDrop presets credited to Suksma, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'cope',
    label: 'Cope',
    author: 'cope',
    description:
      'MilkDrop presets credited to Cope, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'goody',
    label: 'Goody',
    author: 'Goody',
    description:
      'MilkDrop presets credited to Goody, playing live in your browser.',
  },
  {
    kind: 'author',
    slug: 'krash',
    label: 'Krash',
    author: 'Krash',
    description:
      'MilkDrop presets credited to Krash, playing live in your browser.',
  },
];

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
