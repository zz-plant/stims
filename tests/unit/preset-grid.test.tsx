import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { PresetGrid } from '../../src/js/frontend/PresetGrid.tsx';

function entry(
  id: string,
  extra: Partial<PresetCatalogEntry> = {},
): PresetCatalogEntry {
  return { id, title: id, file: `/milkdrop-presets/${id}.milk`, ...extra };
}

function renderGrid(entries: PresetCatalogEntry[]) {
  return renderToStaticMarkup(
    createElement(PresetGrid, {
      catalogEntries: entries,
      presetPreviews: {},
      requestPresetPreviews: () => {},
      routeState: { presetId: null, audioSource: null },
      setRouteState: () => {},
    }),
  );
}

describe('PresetGrid', () => {
  test('renders tiles in the order given (sort parity with the list view)', () => {
    const html = renderGrid([entry('zeta'), entry('alpha'), entry('mid')]);
    const order = [...html.matchAll(/data-preset-id="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(order).toEqual(['zeta', 'alpha', 'mid']);
  });

  test('collapses near-duplicates into the representative with a variant badge', () => {
    const html = renderGrid([
      entry('rep', { similarity: { clusterId: 'dup-rep' } }),
      entry('dup-a', {
        similarity: { clusterId: 'dup-rep', duplicateOf: 'rep' },
      }),
      entry('dup-b', {
        similarity: { clusterId: 'dup-rep', duplicateOf: 'rep' },
      }),
      entry('other'),
    ]);
    const ids = [...html.matchAll(/data-preset-id="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(ids).toEqual(['rep', 'other']);
    expect(html).toContain('+2');
  });

  test('keeps a duplicate whose representative is filtered out of the results', () => {
    const html = renderGrid([
      entry('dup-a', {
        similarity: { clusterId: 'dup-rep', duplicateOf: 'rep-not-present' },
      }),
    ]);
    expect(html).toContain('data-preset-id="dup-a"');
  });

  test('renders every entry it is given (no pagination inside the grid)', () => {
    const many = Array.from({ length: 200 }, (_, i) => entry(`p${i}`));
    const html = renderGrid(many);
    const count = [...html.matchAll(/data-preset-id="/gu)].length;
    expect(count).toBe(200);
  });
});
