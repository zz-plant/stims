// The schema.org entities the site's pages share, so that JSON-LD written in
// three places (the edge, the learn pages, the /presets/ index) describes one
// graph. Pages used to name "Stims" with no @id, as a WebSite on one page and a
// SoftwareApplication on the next, so nothing tied them to the home page's
// nodes, and no page said what MilkDrop is. index.html writes the same @ids by
// hand; tests/unit/structured-data.test.ts holds the two together.

export type JsonLdNode = Record<string, unknown>;

/** A subject the wider web already identifies, named by its public records. */
const knownEntity = (
  type: string,
  name: string,
  ...sameAs: string[]
): JsonLdNode => ({ '@type': type, name, sameAs });

export const MILKDROP_ENTITY = knownEntity(
  'SoftwareApplication',
  'MilkDrop',
  'https://en.wikipedia.org/wiki/MilkDrop',
  'https://www.wikidata.org/wiki/Q4044271',
);

export const MUSIC_VISUALIZATION_ENTITY = knownEntity(
  'Thing',
  'Music visualization',
  'https://en.wikipedia.org/wiki/Music_visualization',
  'https://www.wikidata.org/wiki/Q758903',
);

export const BUTTERCHURN_ENTITY = knownEntity(
  'SoftwareApplication',
  'Butterchurn',
  'https://github.com/jberg/butterchurn',
);

export const PROJECTM_ENTITY = knownEntity(
  'SoftwareApplication',
  'projectM',
  'https://github.com/projectM-visualizer/projectm',
);

export const websiteId = (origin: string) => `${origin}/#website`;
export const applicationId = (origin: string) => `${origin}/#application`;
export const organizationId = (origin: string) => `${origin}/#organization`;

/** The site, as a page that is part of it names it. */
export function websiteNode(origin: string): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': websiteId(origin),
    name: 'Stims',
    url: `${origin}/`,
  };
}

/** The project behind the site, as an article's author or publisher. */
export function organizationNode(origin: string): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': organizationId(origin),
    name: 'Stims',
    url: `${origin}/`,
    logo: `${origin}/icons/icon-512.png`,
    sameAs: ['https://github.com/zz-plant/stims'],
  };
}

/**
 * A credited preset author. One with a curated page gets an @id there, so every
 * preset crediting them and their /author/ page name the same person.
 */
export function personNode(
  origin: string,
  name: string,
  href: string | null,
): JsonLdNode {
  return {
    '@type': 'Person',
    name,
    ...(href
      ? { '@id': `${origin}${href}#person`, url: `${origin}${href}` }
      : {}),
  };
}

export function breadcrumbList(
  crumbs: readonly { name: string; url: string }[],
): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/** How many presets a hub's ItemList names; its page links them all. */
export const ITEM_LIST_LIMIT = 24;

/** A hub's presets as an ItemList: their true count and the first few by name. */
export function presetItemList(
  origin: string,
  links: readonly { title: string; href: string }[],
): JsonLdNode {
  return {
    '@type': 'ItemList',
    numberOfItems: links.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: links.slice(0, ITEM_LIST_LIMIT).map((link, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: link.title,
      url: `${origin}${link.href}`,
    })),
  };
}

/** JSON safe inside a <script> element: a `<` cannot open or close a tag. */
export function serializeJsonLd(value: unknown, indent?: number): string {
  return JSON.stringify(value, null, indent).replace(/</gu, '\\u003c');
}
