import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { PresetMetaTable } from '../../functions/shared/preset-meta.ts';
import { buildPresetPageContent } from '../../functions/shared/preset-page.ts';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import {
  PresetPageDetails,
  presetMetaTableFromCatalog,
  usePresetPageContent,
} from '../../src/js/frontend/PresetPageDetails.tsx';
import {
  makePresetEntry,
  mouseClick,
  renderWorkspace,
} from '../frontend-harness.tsx';

// The section under the stage is what search engines index for a /?preset=
// page: they render the page and skip the <noscript> copy the edge writes.
// These render it through the workspace harness and read the DOM a visitor
// gets.

const CATALOG: PresetCatalogEntry[] = [
  makePresetEntry({
    id: 'geiss-one',
    title: 'Geiss - One',
    author: 'Geiss',
    file: '/milkdrop-presets/geiss-one.milk',
  }),
  makePresetEntry({
    id: 'geiss-two',
    title: 'Geiss - Two',
    author: 'Geiss',
    file: '/milkdrop-presets/butterchurn/geiss-two.milk',
  }),
  makePresetEntry({
    id: 'geiss-three',
    title: 'Geiss - Three',
    author: 'Geiss',
  }),
  makePresetEntry({ id: 'flexi-one', title: 'Flexi - One', author: 'Flexi' }),
  makePresetEntry({
    id: 'stahlregen-geiss-pair',
    title: 'Stahlregen + Geiss - Pair',
    author: 'Stahlregen + Geiss',
  }),
  makePresetEntry({
    id: 'stahlregen-solo',
    title: 'Stahlregen - Solo',
    author: 'Stahlregen',
  }),
  makePresetEntry({ id: 'nobody', title: 'Nobody', author: 'Unknown' }),
];

function Harness({
  presetId,
  onSelect,
}: {
  presetId: string;
  onSelect: (id: string) => void;
}) {
  const content = usePresetPageContent(CATALOG, presetId);
  return content ? (
    <PresetPageDetails content={content} onSelectPreset={onSelect} />
  ) : null;
}

function renderDetails(presetId: string, onSelect: (id: string) => void) {
  return renderWorkspace(<Harness presetId={presetId} onSelect={onSelect} />);
}

describe('preset page details', () => {
  test('names the preset in an h1, credits its author and links the siblings', () => {
    const rendered = renderDetails('geiss-one', () => {});
    try {
      const { container } = rendered;
      const headings = container.querySelectorAll('h1');
      expect(headings.length).toBe(1);
      expect(headings[0]?.textContent).toBe('One');
      expect(container.querySelector('p')?.textContent).toBe(
        'A MilkDrop preset by Geiss.',
      );
      const hrefs = [...container.querySelectorAll('a')].map((link) =>
        link.getAttribute('href'),
      );
      expect(hrefs).toContain('/author/geiss');
      expect(hrefs).toContain('/?preset=geiss-two');
      expect(hrefs).toContain('/?preset=geiss-three');
      const download = container.querySelector('a[download]');
      expect(download?.textContent).toBe('Download .milk');
      expect(download?.getAttribute('href')).toBe(
        '/milkdrop-presets/geiss-one.milk',
      );
      // Same author only, and never itself.
      expect(hrefs).not.toContain('/?preset=flexi-one');
      expect(hrefs).not.toContain('/?preset=geiss-one');
      expect(container.querySelector('h2')?.textContent).toBe(
        'More presets by Geiss',
      );
    } finally {
      rendered.dispose();
    }
  });

  test('picks the same siblings the edge writes for crawlers', () => {
    const fromCatalog = buildPresetPageContent(
      presetMetaTableFromCatalog(CATALOG),
      'geiss-two',
    );
    // What scripts/generate-seo.ts ships as /preset-meta.json for the same
    // catalog: "Unknown" is stored as no author, and the file as the index of
    // its directory.
    const fromEdgeTable = buildPresetPageContent(
      Object.fromEntries(
        CATALOG.map((entry) => [
          entry.id,
          [
            entry.title,
            entry.author === 'Unknown' ? '' : (entry.author ?? ''),
            entry.id === 'geiss-two' ? 1 : entry.id === 'geiss-one' ? 0 : -1,
          ],
        ]),
      ) as PresetMetaTable,
      'geiss-two',
    );
    expect(fromCatalog).toEqual(fromEdgeTable);
    expect(fromCatalog?.download).toBe(
      '/milkdrop-presets/butterchurn/geiss-two.milk',
    );
  });

  test('a credit chain links each hand to its own page and lists more by each', () => {
    const rendered = renderDetails('stahlregen-geiss-pair', () => {});
    try {
      const { container } = rendered;
      const byline = container.querySelector('p');
      expect(byline?.textContent).toBe(
        'A MilkDrop preset by Stahlregen + Geiss.',
      );
      expect(
        [...(byline?.querySelectorAll('a') ?? [])].map(
          (link) => `${link.textContent} ${link.getAttribute('href')}`,
        ),
      ).toEqual(['Stahlregen /author/stahlregen', 'Geiss /author/geiss']);
      // One sibling group per hand, in chain order.
      expect(
        [...container.querySelectorAll('h2')].map((h) => h.textContent),
      ).toEqual(['More presets by Stahlregen', 'More presets by Geiss']);
      const hrefs = [...container.querySelectorAll('ul a')].map((link) =>
        link.getAttribute('href'),
      );
      expect(hrefs).toContain('/?preset=geiss-one');
      expect(hrefs).not.toContain('/?preset=stahlregen-geiss-pair');
    } finally {
      rendered.dispose();
    }
  });

  test('an uncredited preset says so without "by Unknown" or a sibling list', () => {
    const rendered = renderDetails('nobody', () => {});
    try {
      expect(rendered.container.querySelector('p')?.textContent).toBe(
        'A MilkDrop preset.',
      );
      expect(rendered.container.querySelectorAll('h2').length).toBe(0);
    } finally {
      rendered.dispose();
    }
  });

  test('a sibling link switches presets in place; a modified click is left to the browser', () => {
    const selected: string[] = [];
    const rendered = renderDetails('geiss-one', (id) => selected.push(id));
    const scrollTo = window.scrollTo;
    window.scrollTo = (() => {}) as typeof window.scrollTo;
    try {
      const link = rendered.container.querySelector<HTMLAnchorElement>(
        'a[href="/?preset=geiss-two"]',
      );
      if (!link) throw new Error('missing sibling link');

      const plain = mouseClick({});
      act(() => {
        link.dispatchEvent(plain);
      });
      expect(selected).toEqual(['geiss-two']);
      expect(plain.defaultPrevented).toBe(true);

      const newTab = mouseClick({ metaKey: true });
      act(() => {
        link.dispatchEvent(newTab);
      });
      expect(selected).toEqual(['geiss-two']);
      expect(newTab.defaultPrevented).toBe(false);
    } finally {
      window.scrollTo = scrollTo;
      rendered.dispose();
    }
  });

  test('renders nothing for an id the catalog does not hold', () => {
    const rendered = renderDetails('not-in-catalog', () => {});
    try {
      expect(rendered.container.innerHTML).toBe('');
    } finally {
      rendered.dispose();
    }
  });
});
