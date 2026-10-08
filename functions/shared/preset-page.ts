// What a /?preset=<id> page says about its preset, built once for both
// renderers: the edge middleware writes it into the <noscript> fallback for
// crawlers that run no JavaScript, and the workspace renders the same content
// below the stage once the preset plays. Search engines that render the page
// ignore <noscript>, so the rendered copy is the one they index; building
// both from this model keeps the two from describing different pages.

import { findAuthorRoute } from '../discover-slugs.ts';
import type { PresetMetaTable } from './preset-meta.ts';
import { relatedPresetIds } from './preset-related.ts';
import { presentTitle } from './preset-title.ts';

export type PresetPageContent = {
  id: string;
  /** Display title, with the author prefix stripped (see presentTitle). */
  title: string;
  /** Null when the catalog credits nobody, including the literal "Unknown". */
  author: string | null;
  /** Curated `/author/<slug>` page for the author, when one exists. */
  authorHref: string | null;
  /** Other presets by the same author, in relatedPresetIds order. */
  related: { id: string; title: string; href: string }[];
};

/** Topic hubs every preset page links to. */
export const PRESET_PAGE_HUB_LINKS: readonly { href: string; label: string }[] =
  [
    { href: '/discover/audio-reactive', label: 'Audio-reactive visualizers' },
    { href: '/discover/hall-of-fame', label: 'Hall of fame presets' },
    { href: '/learn/', label: 'Learn to write MilkDrop presets' },
  ];

/** The canonical URL path of a preset page, as the sitemap lists it. */
export function presetPageHref(presetId: string): string {
  return `/?preset=${encodeURIComponent(presetId)}`;
}

function namedAuthor(author: string | undefined): string | null {
  const trimmed = author?.trim();
  return trimmed && trimmed !== 'Unknown' ? trimmed : null;
}

export function buildPresetPageContent(
  table: PresetMetaTable,
  presetId: string,
): PresetPageContent | null {
  const entry = table[presetId];
  if (!entry) return null;
  const author = namedAuthor(entry[1]);
  const authorRoute = author ? findAuthorRoute(author) : null;
  return {
    id: presetId,
    title: presentTitle(entry[0], author ?? undefined),
    author,
    authorHref: authorRoute ? `/author/${authorRoute.slug}` : null,
    related: relatedPresetIds(table, presetId).map((id) => {
      const [relatedTitle = '', relatedAuthor] = table[id] ?? [];
      return {
        id,
        title: presentTitle(
          relatedTitle,
          namedAuthor(relatedAuthor) ?? undefined,
        ),
        href: presetPageHref(id),
      };
    }),
  };
}
