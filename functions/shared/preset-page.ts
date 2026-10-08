// What a /?preset=<id> page says about its preset, built once for both
// renderers: the edge middleware writes it into the <noscript> fallback for
// crawlers that run no JavaScript, and the workspace renders the same content
// below the stage once the preset plays. Search engines that render the page
// ignore <noscript>, so the rendered copy is the one they index; building
// both from this model keeps the two from describing different pages.

import { creditedHandles } from '../../src/js/milkdrop/preset-handles.ts';
import { findAuthorRoute } from '../discover-slugs.ts';
import type { PresetMetaTable } from './preset-meta.ts';
import { relatedPresetGroups } from './preset-related.ts';
import { presentTitle } from './preset-title.ts';

/** One credited hand, linked to its curated author page when it has one. */
export type PresetPageCredit = { name: string; href: string | null };

export type PresetPageLink = { id: string; title: string; href: string };

export type PresetPageContent = {
  id: string;
  /** Display title, with the author prefix stripped (see presentTitle). */
  title: string;
  /**
   * The author field as the catalog stores it, for the page title and
   * description. Null when the catalog credits nobody, including the literal
   * "Unknown".
   */
  author: string | null;
  /**
   * The byline: each hand in the credit chain, earliest first. "Stahlregen +
   * Geiss" is two credits, each linked to its own author page.
   */
  credits: PresetPageCredit[];
  /** Other presets by the same hands, one group per credited handle. */
  related: { author: string; presets: PresetPageLink[] }[];
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

/** How the byline joins a chain, as the dock and Browse rows do. */
export const CREDIT_SEPARATOR = ' + ';

function namedAuthor(author: string | undefined): string | null {
  const trimmed = author?.trim();
  return trimmed && trimmed !== 'Unknown' ? trimmed : null;
}

function authorHref(handle: string): string | null {
  const route = findAuthorRoute(handle);
  return route ? `/author/${route.slug}` : null;
}

export function buildPresetPageContent(
  table: PresetMetaTable,
  presetId: string,
): PresetPageContent | null {
  const entry = table[presetId];
  if (!entry) return null;
  const author = namedAuthor(entry[1]);
  const handles = author ? creditedHandles(author) : [];
  // A field the handle parser cannot split is still a credit; show it whole.
  const credits = (handles.length > 0 ? handles : author ? [author] : []).map(
    (name) => ({ name, href: authorHref(name) }),
  );
  return {
    id: presetId,
    title: presentTitle(entry[0], author ?? undefined),
    author,
    credits,
    related: relatedPresetGroups(table, presetId).map((group) => ({
      author: group.handle,
      presets: group.ids.map((id) => {
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
    })),
  };
}
