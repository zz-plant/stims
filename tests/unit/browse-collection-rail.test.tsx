/**
 * The browse sheet's collection rail offers only collections that narrow the
 * list and do not repeat one another, and every chip it shows filters.
 */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { BrowseSheetPanel } from '../../src/js/frontend/BrowseSheetPanel.tsx';
import { getCollectionTags } from '../../src/js/frontend/workspace-helpers.ts';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';

const preset = (id: string, tags: string[]) =>
  makePresetEntry({ id, title: id, tags });

const catalog = [
  preset('glowsticks', [
    'collection:hall-of-fame',
    'collection:classic-milkdrop',
    'collection:rovastar-and-collaborators',
    'collection:butterchurn',
    'collection:audio-reactive',
  ]),
  preset('snakeskin', [
    'collection:hall-of-fame',
    'collection:classic-milkdrop',
    'collection:cream-of-the-crop',
  ]),
  preset('tokamak', ['collection:butterchurn', 'collection:audio-reactive']),
];
const engine = {
  catalog,
  filteredCatalog: catalog,
  collectionTags: getCollectionTags(catalog),
};

function railChips(container: HTMLElement) {
  const rail = container.querySelector('[aria-label="Preset collections"]');
  return [...(rail?.querySelectorAll('button') ?? [])].map((chip) =>
    (chip.textContent ?? '').replace(/[\d,]+$/u, '').trim(),
  );
}

describe('browse collection rail', () => {
  test('offers the selective collections, not the source pack or nested sets', () => {
    const rendered = renderWorkspace(createElement(BrowseSheetPanel), {
      engine,
    });

    expect(railChips(rendered.container)).toEqual([
      'All',
      '★ Saved',
      'Cream of the Crop',
      'Hall of Fame',
      'Audio-reactive',
    ]);

    rendered.dispose();
  });

  test.each([
    ['collection:hall-of-fame', '2 presets'],
    // the community gallery's tag: the sheet used to skip it and list all
    ['collection:community', '0 presets'],
  ])('a %s link lists only its members', (collectionTag, count) => {
    const rendered = renderWorkspace(createElement(BrowseSheetPanel), {
      engine,
      ui: {
        routeState: {
          presetId: null,
          collectionTag,
          panel: 'browse',
          audioSource: null,
          agentMode: false,
        },
      },
    });

    expect(
      rendered.container.querySelector('.ctl-browse-count')?.textContent,
    ).toBe(count);

    rendered.dispose();
  });
});
