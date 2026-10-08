import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { resolveSemanticRoute } from '../../functions/discover-slugs.ts';
import {
  type CollectionContent,
  collectionSectionHtml,
} from '../../functions/shared/collection-page.ts';
import { siteIndexHtml } from '../../functions/shared/site-index.ts';
import {
  CollectionPageDetails,
  collectionContentFromCatalog,
} from '../../src/js/frontend/CollectionPageDetails.tsx';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { SiteIndexFooter } from '../../src/js/frontend/SiteIndexFooter.tsx';
import {
  makePresetEntry,
  mouseClick,
  renderWorkspace,
} from '../frontend-harness.tsx';

// A hub page (/author/<slug>, /discover/<slug>) lists its collection below the
// stage, and every page ends with the site index. Search engines index the
// rendered DOM, so these read what the workspace renders and compare it with
// the copy the edge and the static pages write.

const bundled = (id: string, title: string, author?: string) =>
  makePresetEntry({
    id,
    title,
    author,
    file: `/milkdrop-presets/${id}.milk`,
    tags: ['preset'],
  });

function route(path: string) {
  const resolved = resolveSemanticRoute(path);
  if (!resolved) throw new Error(`${path} is not a curated route`);
  return resolved;
}

function renderCollection(
  content: CollectionContent,
  onSelect: (id: string) => void = () => {},
) {
  return renderWorkspace(
    <CollectionPageDetails content={content} onSelectPreset={onSelect} />,
  );
}

const links = (root: ParentNode) =>
  [...root.querySelectorAll('a')].map((link) => ({
    href: link.getAttribute('href'),
    text: link.textContent,
  }));

const normalizedText = (root: Element | null) =>
  (root?.textContent ?? '').replace(/\s+/gu, ' ').trim();

describe('hub page list', () => {
  const catalog: PresetCatalogEntry[] = [
    bundled('fractal-zoom', 'Geiss - Fractal Zoom', 'Geiss'),
    bundled('another-fractal', 'Another Fractal', 'Unknown'),
    bundled('plain-tunnel', 'Plain Tunnel', 'Geiss'),
    // Imported by the visitor: no bundled file, so not part of the page.
    makePresetEntry({ id: 'my-fractal', title: 'My Fractal', author: 'Me' }),
  ];

  test('a topic page links every bundled preset in its collection, A–Z, with credits', () => {
    const content = collectionContentFromCatalog(
      catalog,
      route('/discover/fractal'),
    );
    const rendered = renderCollection(content);
    try {
      const { container } = rendered;
      expect(container.querySelector('h2')?.textContent).toBe('All 2 presets');
      expect(links(container)).toEqual([
        { href: '/?preset=another-fractal', text: 'Another Fractal' },
        { href: '/?preset=fractal-zoom', text: 'Fractal Zoom' },
      ]);
      // "Unknown" is no credit; a named author is.
      expect(
        [...container.querySelectorAll('li')].map((li) => normalizedText(li)),
      ).toEqual(['Another Fractal', 'Fractal Zoom by Geiss']);
    } finally {
      rendered.dispose();
    }
  });

  test('renders what the edge writes into the raw HTML', () => {
    const content = collectionContentFromCatalog(
      catalog,
      route('/discover/fractal'),
    );
    const edge = document.createElement('div');
    edge.innerHTML = collectionSectionHtml(content);
    const rendered = renderCollection(content);
    try {
      const section = rendered.container.querySelector('section');
      expect(links(section as Element)).toEqual(links(edge));
      expect(normalizedText(section)).toBe(
        normalizedText(edge.querySelector('section')),
      );
    } finally {
      rendered.dispose();
    }
  });

  test('a long list gets letter headings and jump links; an author page omits the credit', () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      bundled(
        `geiss-${index}`,
        `Geiss - ${String.fromCharCode(65 + (index % 3))}${index}`,
        'Geiss',
      ),
    );
    const content = collectionContentFromCatalog(many, route('/author/geiss'));
    const rendered = renderCollection(content);
    try {
      const { container } = rendered;
      expect(container.querySelector('h2')?.textContent).toBe('All 45 presets');
      expect(
        [...container.querySelectorAll('h3')].map((h) => [h.id, h.textContent]),
      ).toEqual([
        ['presets-a', 'A'],
        ['presets-b', 'B'],
        ['presets-c', 'C'],
      ]);
      expect(
        [...container.querySelectorAll('nav a')].map((a) =>
          a.getAttribute('href'),
        ),
      ).toEqual(['#presets-a', '#presets-b', '#presets-c']);
      expect(container.querySelectorAll('a[href^="/?preset="]').length).toBe(
        45,
      );
      expect(container.textContent).not.toContain('by Geiss');
    } finally {
      rendered.dispose();
    }
  });

  test('a preset link switches presets in place; a modified click is left to the browser', () => {
    const selected: string[] = [];
    const content = collectionContentFromCatalog(
      catalog,
      route('/discover/fractal'),
    );
    const rendered = renderCollection(content, (id) => selected.push(id));
    const scrollTo = window.scrollTo;
    window.scrollTo = (() => {}) as typeof window.scrollTo;
    try {
      const link = rendered.container.querySelector<HTMLAnchorElement>(
        'a[href="/?preset=fractal-zoom"]',
      );
      if (!link) throw new Error('missing preset link');
      const plain = mouseClick({});
      act(() => {
        link.dispatchEvent(plain);
      });
      expect(selected).toEqual(['fractal-zoom']);
      expect(plain.defaultPrevented).toBe(true);

      const newTab = mouseClick({ ctrlKey: true });
      act(() => {
        link.dispatchEvent(newTab);
      });
      expect(selected).toEqual(['fractal-zoom']);
      expect(newTab.defaultPrevented).toBe(false);
    } finally {
      window.scrollTo = scrollTo;
      rendered.dispose();
    }
  });
});

describe('site index footer', () => {
  test('links /presets/ and every hub, as the static pages do', () => {
    const rendered = renderWorkspace(<SiteIndexFooter />);
    const html = document.createElement('div');
    html.innerHTML = siteIndexHtml();
    try {
      const footer = rendered.container.querySelector('footer');
      expect(footer).not.toBeNull();
      expect(links(footer as Element)).toEqual(links(html));
      const hrefs = links(footer as Element).map((link) => link.href);
      expect(hrefs).toContain('/presets/');
      expect(hrefs).toContain('/discover/geometric');
      expect(hrefs).toContain('/author/luxxx');
      expect(hrefs).not.toContain('/discover/retro');
    } finally {
      rendered.dispose();
    }
  });
});
