import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTHOR_HUB_MIN_PRESETS,
  AUTHOR_ROUTES,
  DISCOVER_ROUTES,
} from '../../functions/discover-slugs.ts';
import { collectionPresetIds } from '../../functions/shared/collection-page.ts';
import {
  indexablePresetIds,
  type PresetMetaTable,
  presetFileDirIndex,
  presetIndexing,
} from '../../functions/shared/preset-meta.ts';
import { buildPresetPageContent } from '../../functions/shared/preset-page.ts';
import {
  buildPresetMetaMap,
  buildPresetSitemapEntries,
} from '../../scripts/generate-seo.ts';
import { renderPresetIndexPage } from '../../scripts/preset-index-page.ts';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { discoveryRouteFilter } from '../../src/js/frontend/workspace-helpers.ts';
import {
  creditedHandles,
  resolveHandleKey,
} from '../../src/js/milkdrop/preset-handles.ts';

// One catalog table drives the sitemap, /presets/, the hub lists and the
// related links. Before, the sitemap read the root catalog alone while related
// links read every library too, so 144 linked presets were missing from the
// sitemap and 72 sitemap presets had no inbound link. These tests read the
// real catalogs the way the build does.

const repoRoot = join(import.meta.dir, '../..');
const presetIdOf = (url: string) =>
  decodeURIComponent(
    new URL(url, 'https://toil.fyi').searchParams.get('preset') ?? '',
  );

let table: PresetMetaTable;
let sitemapIds: string[];
let indexPageIds: string[];

/** The bundled catalog as the workspace loads it: root first, then libraries. */
function loadMergedCatalog(): PresetCatalogEntry[] {
  const merged = new Map<string, PresetCatalogEntry>();
  for (const file of [
    'public/milkdrop-presets/catalog.json',
    'public/milkdrop-presets/libraries/projectm-cream-of-the-crop/catalog.json',
    'public/milkdrop-presets/libraries/projectm-upstream/catalog.json',
  ]) {
    const { presets } = JSON.parse(
      readFileSync(join(repoRoot, file), 'utf8'),
    ) as { presets: PresetCatalogEntry[] };
    for (const preset of presets) {
      if (!merged.has(preset.id)) merged.set(preset.id, preset);
    }
  }
  return [...merged.values()];
}

beforeAll(async () => {
  table = await buildPresetMetaMap(repoRoot);
  sitemapIds = (
    await buildPresetSitemapEntries(repoRoot, {
      lastmod: '2026-01-01',
      presetMeta: table,
    })
  ).map((entry) => presetIdOf(entry.loc));
  indexPageIds = [
    ...renderPresetIndexPage(table, 'https://toil.fyi').matchAll(
      /href="(\/\?preset=[^"]+)"/gu,
    ),
  ].map((match) => presetIdOf(match[1] as string));
});

describe('the sitemap and /presets/ come from one catalog table', () => {
  test('the shipped table is the one the build writes', () => {
    const shipped = readFileSync(
      join(repoRoot, 'public/preset-meta.json'),
      'utf8',
    );
    expect(shipped).toBe(JSON.stringify(table));
  });

  test('the sitemap lists exactly the presets /presets/ links, once each', () => {
    expect(new Set(sitemapIds).size).toBe(sitemapIds.length);
    expect(new Set(indexPageIds).size).toBe(indexPageIds.length);
    expect([...sitemapIds].sort()).toEqual([...indexPageIds].sort());
    expect(sitemapIds).toEqual(indexablePresetIds(table));
  });

  test('includes the library presets that preset pages link to', () => {
    const inSitemap = new Set(sitemapIds);
    const linkedIndexable = new Set<string>();
    for (const id of sitemapIds) {
      for (const group of buildPresetPageContent(table, id)?.related ?? []) {
        for (const preset of group.presets) {
          if (presetIndexing(table[preset.id] ?? ['', '']).kind === 'index') {
            linkedIndexable.add(preset.id);
          }
        }
      }
    }
    const missing = [...linkedIndexable].filter((id) => !inSitemap.has(id));
    expect(missing).toEqual([]);
    expect([...inSitemap].some((id) => id.startsWith('cotc-'))).toBe(true);
  });

  test('nameless presets and projectM fixtures carry noindex and stay out', () => {
    const inSitemap = new Set(sitemapIds);
    for (const id of ['11', '124', 'cotc-101', '000-empty', '200-wave']) {
      expect(presetIndexing(table[id] ?? ['', '']).kind).toBe('noindex');
      expect(inSitemap.has(id)).toBe(false);
    }
    // Still in the table, so the page keeps its title and plays.
    expect(table['11']?.[0]).toBe('11');
  });

  test('a library copy of a root preset names the root one as canonical', () => {
    const indexing = presetIndexing(
      table['cotc-geiss-skin-dots-10b'] ?? ['', ''],
    );
    expect(indexing).toEqual({ kind: 'canonical', id: 'geiss-skin-dots-10b' });
    expect(presetIndexing(table['geiss-skin-dots-10b'] ?? ['', '']).kind).toBe(
      'index',
    );
    expect(sitemapIds).not.toContain('cotc-geiss-skin-dots-10b');
    // Every canonical target is itself an indexable page.
    for (const id of Object.keys(table)) {
      const entry = presetIndexing(table[id] ?? ['', '']);
      if (entry.kind === 'canonical') {
        expect(presetIndexing(table[entry.id] ?? ['', '']).kind).toBe('index');
      }
    }
  });
});

describe('curated hubs', () => {
  test(`every hand with ${AUTHOR_HUB_MIN_PRESETS}+ indexable presets has an author page`, () => {
    const counts = new Map<string, { handle: string; count: number }>();
    for (const id of indexablePresetIds(table)) {
      for (const handle of creditedHandles(table[id]?.[1])) {
        const key = resolveHandleKey(handle);
        const entry = counts.get(key) ?? { handle, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
      }
    }
    const withPage = new Set(
      AUTHOR_ROUTES.map((route) =>
        resolveHandleKey(route.author ?? route.label),
      ),
    );
    const missing = [...counts.entries()]
      .filter(
        ([key, { count }]) =>
          count >= AUTHOR_HUB_MIN_PRESETS && !withPage.has(key),
      )
      .map(([, { handle, count }]) => `${handle} (${count})`);
    expect(missing).toEqual([]);
  });

  test('every hub lists at least one preset', () => {
    for (const route of [...DISCOVER_ROUTES, ...AUTHOR_ROUTES]) {
      expect({
        route: route.slug,
        count: collectionPresetIds(table, route).length,
      }).not.toEqual({ route: route.slug, count: 0 });
    }
  });

  test("the edge lists each hub's presets as Browse filters them", () => {
    const catalog = loadMergedCatalog().filter(
      (entry) => presetFileDirIndex(entry.file, entry.id) !== undefined,
    );
    for (const route of [...DISCOVER_ROUTES, ...AUTHOR_ROUTES]) {
      const browse = catalog
        .filter(discoveryRouteFilter(route))
        .map((entry) => entry.id)
        .sort();
      expect({
        route: route.slug,
        ids: collectionPresetIds(table, route).sort(),
      }).toEqual({ route: route.slug, ids: browse });
    }
  });
});
