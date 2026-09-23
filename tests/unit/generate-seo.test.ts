import { describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import {
  isAllowedAuthorSlug,
  isAllowedDiscoverSlug,
} from '../../functions/discover-slugs.ts';
import {
  buildOgBackdropSvg,
  buildOgSvg,
  buildSitemapChunk,
  buildSitemapEntries,
  formatPresetCountClaim,
  getSitemapRouteSpecs,
  layoutOgTiles,
  OG_FRAME_DIR,
  OG_FRAMES,
  renderOgPng,
} from '../../scripts/generate-seo.ts';

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

    expect(canonicalPaths).not.toContain('/milkdrop/');
    expect(canonicalPaths.slice(0, 2)).toEqual(['/', '/performance/']);
    // Curated /discover/ hubs join the sitemap; every one must be on the
    // middleware allowlist so the sitemap never advertises a slug the edge
    // won't rewrite.
    for (const path of canonicalPaths.slice(2)) {
      const allowed = path.startsWith('/discover/')
        ? isAllowedDiscoverSlug(path.slice('/discover/'.length))
        : path.startsWith('/author/') &&
          isAllowedAuthorSlug(path.slice('/author/'.length));
      expect(allowed).toBe(true);
    }
  });

  test('builds sitemap entries for the canonical route with the launch OG image', async () => {
    const entries = await buildSitemapEntries('/tmp/stims-test', {
      milkdrop,
      resolveLastmod: async () => '2026-04-04',
    });

    expect(entries.slice(0, 2)).toEqual([
      expect.objectContaining({
        loc: 'https://toil.fyi/',
        lastmod: '2026-04-04',
        imageLoc: 'https://toil.fyi/og/milkdrop.png',
        imageTitle: 'MilkDrop Visualizer | Stims',
      }),
      expect.objectContaining({
        loc: 'https://toil.fyi/performance/',
        lastmod: '2026-04-04',
        imageLoc: 'https://toil.fyi/og/performance.png',
        imageTitle: 'Compatibility and Performance | Stims',
      }),
    ]);
    expect(
      entries.some((entry) => entry.loc === 'https://toil.fyi/author/geiss'),
    ).toBe(true);
  });

  test('renders image metadata without listing the redirect alias', () => {
    const xml = buildSitemapChunk([
      {
        loc: 'https://toil.fyi/',
        lastmod: '2026-04-04',
        changefreq: 'weekly',
        priority: '1.0',
        imageLoc: 'https://toil.fyi/og/milkdrop.png',
        imageTitle: 'MilkDrop Visualizer | Stims',
        imageCaption: milkdrop.description,
      },
      {
        loc: 'https://toil.fyi/performance/',
        lastmod: '2026-04-04',
        changefreq: 'monthly',
        priority: '0.7',
        imageLoc: 'https://toil.fyi/og/performance.png',
        imageTitle: 'Compatibility and Performance | Stims',
        imageCaption:
          'Guide to browser support, lighter visual modes, and what to expect on older devices.',
      },
    ]);

    expect(xml).toContain('<loc>https://toil.fyi/</loc>');
    expect(xml).toContain('<loc>https://toil.fyi/performance/</loc>');
    expect(xml).toContain(
      '<image:loc>https://toil.fyi/og/milkdrop.png</image:loc>',
    );
    expect(xml).toContain(
      '<image:loc>https://toil.fyi/og/performance.png</image:loc>',
    );
    expect(xml).toContain(
      '<image:title>MilkDrop Visualizer | Stims</image:title>',
    );
    expect(xml).toContain(
      '<image:title>Compatibility and Performance | Stims</image:title>',
    );
    expect(xml).not.toContain('https://toil.fyi/milkdrop/');
  });
});

describe('generate-seo social cards', () => {
  test('every frame on the card wall exists on disk', () => {
    for (const frame of OG_FRAMES) {
      expect(existsSync(`${OG_FRAME_DIR}/${frame}.jpg`)).toBe(true);
    }
  });

  // Two copies of one frame side by side read as a rendering glitch.
  test('no tile repeats the frame of a neighbour beside or below it', () => {
    const tiles = layoutOgTiles();
    for (const a of tiles) {
      for (const b of tiles) {
        if (a === b || a.frame !== b.frame) continue;
        const adjacent =
          Math.abs(a.x - b.x) <= 300 && Math.abs(a.y - b.y) <= 200;
        expect(adjacent).toBe(false);
      }
    }
  });

  test('the committed SVG points at the frame files beside it', () => {
    const svg = buildOgSvg({
      headline: ['Your music,', 'visualized.'],
      subline: ['2,600+ MilkDrop visuals'],
      eyebrow: 'MilkDrop visualizer',
      ariaLabel: 'Your music, visualized.',
    });
    expect(svg).toContain('href="frames/');
    expect(svg).not.toContain('data:image');
    expect(svg).toContain('>Your music,<');
    expect(svg).toContain('toil.fyi');
  });

  test('floors the preset count so the card does not overclaim', () => {
    expect(formatPresetCountClaim(2679)).toBe('2,600+');
    expect(formatPresetCountClaim(900)).toBe('900+');
  });

  // WhatsApp and some other scrapers drop preview images much past 300KB.
  test('rendered cards stay small enough for every unfurler', async () => {
    const svg = buildOgBackdropSvg({ frameHref: () => '' });
    const png = await renderOgPng(svg);
    expect(png.length).toBeLessThan(300 * 1024);
    for (const file of ['milkdrop', 'default', 'performance']) {
      expect(statSync(`public/og/${file}.png`).size).toBeLessThan(300 * 1024);
    }
  });
});
