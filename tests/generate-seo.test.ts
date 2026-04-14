import { describe, expect, test } from 'bun:test';
import {
  buildSitemapChunk,
  buildSitemapEntries,
  getSitemapRouteSpecs,
} from '../scripts/generate-seo.ts';

const milkdrop = {
  slug: 'milkdrop',
  title: 'MilkDrop Visualizer',
  description:
    'MilkDrop-inspired browser visualizer with demo audio, hand-picked presets, live editing, and preset import/export.',
};

describe('generate-seo sitemap routes', () => {
  test('keeps the compatibility alias out of the sitemap route set', () => {
    const routes = getSitemapRouteSpecs(milkdrop);
    const canonicalPaths = routes
      .filter((route) => route.includeInSitemap)
      .map((route) => route.path);

    expect(canonicalPaths).toEqual(['/', '/performance/']);
  });

  test('builds sitemap entries for the canonical route with the launch OG image', async () => {
    const entries = await buildSitemapEntries('/tmp/stims-test', {
      milkdrop,
      resolveLastmod: async () => '2026-04-04',
    });

    expect(entries).toEqual([
      expect.objectContaining({
        loc: 'https://toil.fyi/',
        lastmod: '2026-04-04',
        imageLoc: 'https://toil.fyi/og/milkdrop.svg',
        imageTitle: 'MilkDrop Visualizer | Stims',
      }),
      expect.objectContaining({
        loc: 'https://toil.fyi/performance/',
        lastmod: '2026-04-04',
        imageLoc: 'https://toil.fyi/og/milkdrop.svg',
        imageTitle: 'Compatibility and Performance | Stims',
      }),
    ]);
  });

  test('renders image metadata without listing the redirect alias', () => {
    const xml = buildSitemapChunk([
      {
        loc: 'https://toil.fyi/',
        lastmod: '2026-04-04',
        changefreq: 'weekly',
        priority: '1.0',
        imageLoc: 'https://toil.fyi/og/milkdrop.svg',
        imageTitle: 'MilkDrop Visualizer | Stims',
        imageCaption: milkdrop.description,
      },
      {
        loc: 'https://toil.fyi/performance/',
        lastmod: '2026-04-04',
        changefreq: 'monthly',
        priority: '0.7',
        imageLoc: 'https://toil.fyi/og/milkdrop.svg',
        imageTitle: 'Compatibility and Performance | Stims',
        imageCaption:
          'Guide to browser support, lighter visual modes, and what to expect on older devices.',
      },
    ]);

    expect(xml).toContain('<loc>https://toil.fyi/</loc>');
    expect(xml).toContain('<loc>https://toil.fyi/performance/</loc>');
    expect(xml).toContain(
      '<image:loc>https://toil.fyi/og/milkdrop.svg</image:loc>',
    );
    expect(xml).toContain(
      '<image:title>MilkDrop Visualizer | Stims</image:title>',
    );
    expect(xml).not.toContain('https://toil.fyi/milkdrop/');
  });
});
