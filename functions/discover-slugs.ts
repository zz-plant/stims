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
      'Explore audio-reactive MilkDrop presets that turn music into motion in your browser.',
  },
  {
    kind: 'topic',
    slug: 'ambient',
    label: 'Ambient',
    searchQuery: 'ambient',
    description:
      'Explore ambient MilkDrop presets for slow, atmospheric music visualization.',
  },
  {
    kind: 'topic',
    slug: 'fractal',
    label: 'Fractal',
    searchQuery: 'fractal',
    description:
      'Explore recursive and fractal MilkDrop presets running live in your browser.',
  },
  {
    kind: 'topic',
    slug: 'geometric',
    label: 'Geometric',
    searchQuery: 'geometric',
    description:
      'Explore geometric MilkDrop presets built from lines, shapes, symmetry, and motion.',
  },
  {
    kind: 'topic',
    slug: 'hall-of-fame',
    label: 'Hall of Fame',
    collectionTag: 'collection:hall-of-fame',
    description:
      'Explore standout MilkDrop presets selected from the Stims catalog.',
  },
  {
    kind: 'topic',
    slug: 'neon',
    label: 'Neon',
    searchQuery: 'neon',
    description:
      'Explore neon MilkDrop presets with luminous color and high-contrast motion.',
  },
  {
    kind: 'topic',
    slug: 'particles',
    label: 'Particle',
    searchQuery: 'particles',
    description:
      'Explore particle-driven MilkDrop presets that react live to music.',
  },
  {
    kind: 'topic',
    slug: 'psychedelic',
    label: 'Psychedelic',
    searchQuery: 'psychedelic',
    description:
      'Explore psychedelic MilkDrop presets with fluid color, feedback, and motion.',
  },
  {
    kind: 'topic',
    slug: 'retro',
    label: 'Retro',
    searchQuery: 'retro',
    description:
      'Explore retro MilkDrop presets inspired by classic music visualizers.',
  },
  {
    kind: 'topic',
    slug: 'space',
    label: 'Space',
    searchQuery: 'space',
    description:
      'Explore space-themed MilkDrop presets with stars, tunnels, and cosmic motion.',
  },
  {
    kind: 'topic',
    slug: 'trippy',
    label: 'Trippy',
    searchQuery: 'trippy',
    description:
      'Explore trippy MilkDrop presets with animated feedback and shifting geometry.',
  },
  {
    kind: 'topic',
    slug: 'tunnel',
    label: 'Tunnel',
    searchQuery: 'tunnel',
    description:
      'Explore tunnel MilkDrop presets that turn music into forward motion.',
  },
  {
    kind: 'topic',
    slug: 'waveform',
    label: 'Waveform',
    searchQuery: 'waveform',
    description:
      'Explore MilkDrop presets that make the live audio waveform part of the artwork.',
  },
  {
    kind: 'topic',
    slug: 'webgpu-showcase',
    label: 'WebGPU Showcase',
    collectionTag: 'collection:webgpu-showcase',
    description:
      'Explore MilkDrop presets available through Stims guarded WebGPU renderer path.',
  },
];

export const AUTHOR_ROUTES: readonly SemanticDiscoveryRoute[] = [
  {
    kind: 'author',
    slug: 'geiss',
    label: 'Geiss',
    author: 'Geiss',
    description:
      'Explore MilkDrop presets credited to Geiss and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'flexi',
    label: 'Flexi',
    author: 'Flexi',
    description:
      'Explore MilkDrop presets credited to Flexi and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'martin',
    label: 'Martin',
    author: 'Martin',
    description:
      'Explore MilkDrop presets credited to Martin and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'rovastar',
    label: 'Rovastar',
    author: 'Rovastar',
    description:
      'Explore MilkDrop presets credited to Rovastar and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'eo-s',
    label: 'Eo.S.',
    author: 'Eo.S.',
    description:
      'Explore MilkDrop presets credited to Eo.S. and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'phat',
    label: 'Phat',
    author: 'Phat',
    description:
      'Explore MilkDrop presets credited to Phat and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'stahlregen',
    label: 'Stahlregen',
    author: 'Stahlregen',
    description:
      'Explore MilkDrop presets credited to Stahlregen and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'unchained',
    label: 'Unchained',
    author: 'Unchained',
    description:
      'Explore MilkDrop presets credited to Unchained and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'fishbrain',
    label: 'Fishbrain',
    author: 'Fishbrain',
    description:
      'Explore MilkDrop presets credited to Fishbrain and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'aderrasi',
    label: 'Aderrasi',
    author: 'Aderrasi',
    description:
      'Explore MilkDrop presets credited to Aderrasi and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'zylot',
    label: 'Zylot',
    author: 'Zylot',
    description:
      'Explore MilkDrop presets credited to Zylot and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'shifter',
    label: 'Shifter',
    author: 'Shifter',
    description:
      'Explore MilkDrop presets credited to Shifter and run them live in your browser.',
  },
  {
    kind: 'author',
    slug: 'mig',
    label: 'Mig',
    author: 'Mig',
    description:
      'Explore MilkDrop presets credited to Mig and run them live in your browser.',
  },
];

export const DISCOVER_SLUGS = DISCOVER_ROUTES.map((route) => route.slug);
export const AUTHOR_SLUGS = AUTHOR_ROUTES.map((route) => route.slug);

export function isAllowedDiscoverSlug(slug: string): boolean {
  return DISCOVER_SLUGS.includes(slug);
}

export function isAllowedAuthorSlug(slug: string): boolean {
  return AUTHOR_SLUGS.includes(slug);
}

export function resolveSemanticRoute(
  pathname: string,
): SemanticDiscoveryRoute | null {
  const [, namespace, slug, extra] = pathname.split('/');
  if (!slug || extra) return null;
  if (namespace === 'discover') {
    return DISCOVER_ROUTES.find((route) => route.slug === slug) ?? null;
  }
  if (namespace === 'author') {
    return AUTHOR_ROUTES.find((route) => route.slug === slug) ?? null;
  }
  return null;
}
