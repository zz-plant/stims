/**
 * Renders /presets/, the index of every indexable preset, for generate-seo.
 *
 * Search engines reached most preset pages only through the sitemap: hub
 * pages listed their presets client-side, and 72 sitemap presets had no link
 * from anywhere. This page links each indexable preset once, A–Z, and every
 * hub with its count, from static HTML in the /learn/ shell. It reads the same
 * catalog table as the sitemap, so the two list the same presets.
 */
import {
  AUTHOR_ROUTES,
  DISCOVER_ROUTES,
  type SemanticDiscoveryRoute,
} from '../functions/discover-slugs.ts';
import {
  buildPresetIndexContent,
  collectionListHtml,
  collectionPresetIds,
} from '../functions/shared/collection-page.ts';
import {
  indexablePresetIds,
  type PresetMetaTable,
} from '../functions/shared/preset-meta.ts';
import { PRESET_INDEX_PATH } from '../functions/shared/site-index.ts';
import { renderStaticPage } from './generate-learn-pages.ts';

export const PRESET_INDEX_OUT_FILE = 'public/presets/index.html';

const formatCount = (count: number) =>
  String(count).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');

const escapeHtml = (value: string) =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

const EXTRA_STYLE = `
.hub-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 20px}
.hub-list span,.preset-list li span{color:var(--muted)}
.preset-list ul{list-style:none;margin:0;padding:0;columns:16rem;column-gap:28px}
.preset-list li{break-inside:avoid;max-width:none;overflow-wrap:anywhere}
.preset-list nav ul{columns:auto;display:flex;flex-wrap:wrap;gap:2px 14px;margin:0 0 .5em}
.preset-list h3{border-bottom:1px solid var(--line);padding-bottom:.2em}
`
  .replace(/\s*\n\s*/gu, '')
  .trim();

export function renderPresetIndexPage(
  table: PresetMetaTable,
  baseUrl: string,
): string {
  const ids = indexablePresetIds(table);
  const content = buildPresetIndexContent(table, ids);
  const count = formatCount(content.count);
  const url = `${baseUrl}${PRESET_INDEX_PATH}`;
  const title = 'MilkDrop Presets, A–Z | Stims';
  const description = `${count} MilkDrop presets on Stims, by collection, by author and A–Z. Each one plays in your browser, and its page links the .milk file.`;

  const hubList = (routes: readonly SemanticDiscoveryRoute[], base: string) =>
    `<ul class="hub-list">${routes
      .map(
        (route) =>
          `<li><a href="${base}${route.slug}">${escapeHtml(route.label)}</a> <span>${formatCount(collectionPresetIds(table, route).length)}</span></li>`,
      )
      .join('')}</ul>`;

  const jsonLd = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          name: 'MilkDrop presets',
          description,
          url,
          inLanguage: 'en',
          isPartOf: { '@type': 'WebSite', name: 'Stims', url: `${baseUrl}/` },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Stims',
              item: `${baseUrl}/`,
            },
            { '@type': 'ListItem', position: 2, name: 'Presets', item: url },
          ],
        },
      ],
    },
    null,
    2,
  ).replace(/</gu, '\\u003c');

  return renderStaticPage({
    title,
    description,
    url,
    ogType: 'website',
    jsonLd,
    extraStyle: EXTRA_STYLE,
    main: [
      '<h1>MilkDrop presets</h1>',
      `<p>Browse ${count} presets by collection, by author, or A–Z.</p>`,
      '<p>Each one plays live in your browser and reacts to any song, your microphone, or audio from another tab. Its page links the .milk file.</p>',
      '<h2 id="collections">Collections</h2>',
      hubList(DISCOVER_ROUTES, '/discover/'),
      '<h2 id="authors">Authors</h2>',
      hubList(AUTHOR_ROUTES, '/author/'),
      '<h2 id="a-z">A–Z</h2>',
      `<div class="preset-list">${collectionListHtml(content)}</div>`,
    ].join('\n'),
  });
}
