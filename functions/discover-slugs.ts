/**
 * Allowlist for `/discover/<slug>` topic hubs.
 *
 * The middleware used to synthesize a unique, self-canonical page for ANY
 * slug — an unbounded space of near-duplicate thin pages (classic doorway
 * territory that risks the site's search standing). Only slugs on this
 * curated list, each backed by real catalog vocabulary, get the hub
 * treatment; everything else falls through to the app shell with its
 * default root-canonical metadata, the same consolidation used for unknown
 * `?preset=` ids.
 *
 * Keep this list in sync with the catalog's actual content categories —
 * every entry should answer to a real search for that kind of visualizer
 * with genuinely matching presets.
 */
export const DISCOVER_SLUGS: readonly string[] = [
  'audio-reactive',
  'ambient',
  'fractal',
  'geometric',
  'hall-of-fame',
  'neon',
  'particles',
  'psychedelic',
  'retro',
  'space',
  'trippy',
  'tunnel',
  'waveform',
  'webgpu-showcase',
];

const slugSet = new Set(DISCOVER_SLUGS);

export function isAllowedDiscoverSlug(slug: string): boolean {
  return slugSet.has(slug);
}
