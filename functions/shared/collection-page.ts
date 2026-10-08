// What a curated hub page (/author/<slug>, /discover/<slug>) and the /presets/
// index list, built once for every renderer: the edge writes it into the raw
// HTML, the workspace renders it below the stage, and generate-seo renders
// /presets/ with it.
//
// Hubs used to list their presets only in Browse, which renders client-side
// and virtualized, so their HTML held no preset links and a rendering crawler
// saw 30-odd. Each hub now lists every preset in its collection, as links, in
// the HTML and on the page.

import type { SemanticDiscoveryRoute } from '../discover-slugs.ts';
import { DISCOVER_ROUTES } from '../discover-slugs.ts';
import type { PresetMetaEntry, PresetMetaTable } from './preset-meta.ts';
import { presetPageHref } from './preset-page.ts';
import { presetIdsCreditingHandle } from './preset-related.ts';
import { presentTitle } from './preset-title.ts';

/** A preset as a list needs it: the catalog's title and author fields. */
export type CollectionPreset = { id: string; title: string; author?: string };

export type CollectionLink = {
  id: string;
  /** Display title, with the author prefix stripped (see presentTitle). */
  title: string;
  /** The author field, when the list shows one; null otherwise. */
  credit: string | null;
  href: string;
};

export type CollectionGroup = {
  /** "A"–"Z", or "#" for titles that start with a digit or symbol. */
  letter: string;
  presets: CollectionLink[];
};

export type CollectionContent = {
  count: number;
  /** One group per starting letter, or a single unlabelled group. */
  groups: CollectionGroup[];
  /** True when the groups carry letter headings. */
  lettered: boolean;
};

/** Lists longer than this are split under letter headings. */
export const LETTER_GROUP_THRESHOLD = 40;

/** The id of a hub list's heading, in the edge's copy and the workspace's. */
export const COLLECTION_HEADING_ID = 'stims-collection-heading';

/** The heading over a list: "All 529 presets". */
export function collectionHeading(count: number): string {
  if (count === 1) return '1 preset';
  return `All ${String(count).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')} presets`;
}

/** The fragment id of a letter group, for the jump links above the list. */
export function collectionLetterId(letter: string): string {
  return letter === '#' ? 'presets-0-9' : `presets-${letter.toLowerCase()}`;
}

function namedAuthor(author: string | undefined): string | null {
  const trimmed = author?.trim();
  return trimmed && trimmed !== 'Unknown' ? trimmed : null;
}

// Plain code-unit comparison over folded text, not localeCompare: the edge,
// the browser and the build run three ICU builds, and the edge's list and the
// one rendered under the stage must come out in the same order.
function sortKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function letterOf(key: string): string {
  const first = key[0];
  return first && first >= 'a' && first <= 'z' ? first.toUpperCase() : '#';
}

/**
 * Sorts and groups a collection. Ids appear once; input order does not
 * matter, so two renderers given the same presets produce the same list.
 */
export function buildCollectionContent(
  presets: readonly CollectionPreset[],
  { showCredit }: { showCredit: boolean },
): CollectionContent {
  const seen = new Set<string>();
  const rows: { key: string; link: CollectionLink }[] = [];
  for (const preset of presets) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    const author = namedAuthor(preset.author);
    const title = presentTitle(preset.title, author ?? undefined);
    rows.push({
      key: sortKey(title),
      link: {
        id: preset.id,
        title,
        credit: showCredit ? author : null,
        href: presetPageHref(preset.id),
      },
    });
  }
  rows.sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.link.id < b.link.id ? -1 : a.link.id > b.link.id ? 1 : 0;
  });

  const lettered = rows.length > LETTER_GROUP_THRESHOLD;
  if (!lettered) {
    return {
      count: rows.length,
      lettered,
      groups:
        rows.length > 0
          ? [{ letter: '', presets: rows.map((row) => row.link) }]
          : [],
    };
  }
  const groups: CollectionGroup[] = [];
  for (const row of rows) {
    const letter = letterOf(row.key);
    const last = groups.at(-1);
    if (last?.letter === letter) last.presets.push(row.link);
    else groups.push({ letter, presets: [row.link] });
  }
  return { count: rows.length, lettered, groups };
}

function tableRows(table: PresetMetaTable, ids: string[]): CollectionPreset[] {
  return ids.map((id) => {
    const [title = '', author = ''] = (table[id] ?? []) as PresetMetaEntry;
    return { id, title, author };
  });
}

/**
 * Ids of the presets in a hub's collection, read from the table: by credited
 * handle for an author page, by the topic bit the build computed with Browse's
 * filter (discoveryRouteFilter) for a topic page.
 */
export function collectionPresetIds(
  table: PresetMetaTable,
  route: SemanticDiscoveryRoute,
): string[] {
  if (route.kind === 'author') {
    return presetIdsCreditingHandle(table, route.author ?? route.label);
  }
  const bit = DISCOVER_ROUTES.findIndex((topic) => topic.slug === route.slug);
  if (bit === -1) return [];
  return Object.keys(table).filter(
    (id) => (((table[id]?.[3] ?? 0) >>> bit) & 1) === 1,
  );
}

/** A hub's list as the edge writes it, from the catalog table. */
export function buildHubCollectionContent(
  table: PresetMetaTable,
  route: SemanticDiscoveryRoute,
): CollectionContent {
  return buildCollectionContent(
    tableRows(table, collectionPresetIds(table, route)),
    { showCredit: route.kind === 'topic' },
  );
}

/** The /presets/ index: every indexable preset, A–Z, with its credit. */
export function buildPresetIndexContent(
  table: PresetMetaTable,
  ids: string[],
): CollectionContent {
  return buildCollectionContent(tableRows(table, ids), { showCredit: true });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/**
 * The list as HTML, for the edge and the static /presets/ page; the workspace
 * renders the same content with CollectionPageDetails. Letter groups get a
 * row of jump links and an h3 each.
 */
export function collectionListHtml(
  content: CollectionContent,
  { headingLevel = 3 }: { headingLevel?: 2 | 3 } = {},
): string {
  const item = (link: CollectionLink) =>
    `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a>${
      link.credit ? ` <span>by ${escapeHtml(link.credit)}</span>` : ''
    }</li>`;
  const list = (links: CollectionLink[]) =>
    `<ul>${links.map(item).join('')}</ul>`;
  if (!content.lettered) {
    return content.groups.map((group) => list(group.presets)).join('');
  }
  const tag = `h${headingLevel}`;
  const jump = `<nav aria-label="Presets by letter"><ul>${content.groups
    .map(
      (group) =>
        `<li><a href="#${collectionLetterId(group.letter)}">${group.letter}</a></li>`,
    )
    .join('')}</ul></nav>`;
  return `${jump}${content.groups
    .map(
      (group) =>
        `<${tag} id="${collectionLetterId(group.letter)}">${group.letter}</${tag}>${list(group.presets)}`,
    )
    .join('')}`;
}

/**
 * A hub's list as the edge writes it into #app; CollectionPageDetails renders
 * the same section once the workspace mounts.
 */
export function collectionSectionHtml(content: CollectionContent): string {
  return `<section class="stims-collection" aria-labelledby="${COLLECTION_HEADING_ID}"><h2 id="${COLLECTION_HEADING_ID}">${escapeHtml(collectionHeading(content.count))}</h2>${collectionListHtml(content)}</section>`;
}
