// The site's index of pages: the footer every page ends with. The learn pages
// and /presets/ render it into their static HTML, generate-seo writes it into
// index.html, so the raw HTML of the home page, every hub and every preset
// page links /presets/ and every hub, and the workspace renders it below the
// stage (SiteIndexFooter.tsx).
//
// It replaces a nav in index.html that was clipped to one pixel and `inert`:
// crawlers read its links, nobody could see or follow them, and it named six
// of the thirteen topic hubs and none of the authors.

import { AUTHOR_ROUTES, DISCOVER_ROUTES } from '../discover-slugs.ts';

export type SiteIndexLink = { href: string; label: string };
export type SiteIndexSection = { heading: string; links: SiteIndexLink[] };

export const PRESET_INDEX_PATH = '/presets/';

export const SITE_INDEX_SECTIONS: readonly SiteIndexSection[] = [
  {
    heading: 'Stims',
    links: [
      { href: '/', label: 'Visualizer' },
      { href: PRESET_INDEX_PATH, label: 'All presets, A–Z' },
      { href: '/learn/', label: 'Learn to write presets' },
      { href: '/learn/milkdrop-online/', label: 'MilkDrop online' },
      {
        href: '/learn/milkdrop-vs-butterchurn-projectm/',
        label: 'Stims vs Butterchurn vs projectM',
      },
      { href: '/performance/', label: 'Compatibility and performance' },
      { href: 'https://github.com/zz-plant/stims', label: 'Source on GitHub' },
    ],
  },
  {
    heading: 'Browse presets by look',
    links: DISCOVER_ROUTES.map((route) => ({
      href: `/discover/${route.slug}`,
      label: route.label,
    })),
  },
  {
    heading: 'Browse presets by author',
    links: AUTHOR_ROUTES.map((route) => ({
      href: `/author/${route.slug}`,
      label: route.label,
    })),
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/** The footer as static HTML. */
export function siteIndexHtml(): string {
  return [
    '<footer class="site-footer">',
    ...SITE_INDEX_SECTIONS.flatMap((section) => [
      `<h2>${escapeHtml(section.heading)}</h2>`,
      `<ul>${section.links
        .map(
          (link) =>
            `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`,
        )
        .join('')}</ul>`,
    ]),
    '</footer>',
  ].join('\n');
}
