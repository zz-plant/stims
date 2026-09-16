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

function renderGrid(
  entries: PresetCatalogEntry[],
  { showQuickSelectKeys = true }: { showQuickSelectKeys?: boolean } = {},
) {
  return renderToStaticMarkup(
    createElement(PresetGrid, {
      catalogEntries: entries,
      presetPreviews: {},
      requestPresetPreviews: () => {},
      routeState: { presetId: null, audioSource: null },
      setRouteState: () => {},
      onToggleFavorite: () => {},
      showQuickSelectKeys,
    }),
  );
}

describe('PresetGrid', () => {
  test('wears the quick-select digits only when the panel says they answer', () => {
    // The panel hides them while its search field has focus — a digit typed
    // there is a search, not a pick — so a badge is never a promise the
    // keyboard cannot keep.
    const live = renderGrid([entry('one'), entry('two')]);
    expect(live).toContain('stims-preset-grid__quick-key');
    expect(live).toContain('aria-keyshortcuts="1"');

    const typing = renderGrid([entry('one'), entry('two')], {
      showQuickSelectKeys: false,
    });
    expect(typing).not.toContain('stims-preset-grid__quick-key');
    expect(typing).not.toContain('aria-keyshortcuts');
  });

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

  // Supersedes "renders every entry it is given": the grid is virtualized,
  // so rendering all 200 is now the bug, not the contract. What still has to
  // hold is that nothing is *lost* — every entry is reachable by scrolling,
  // which shows up as the container reserving height for all of them rather
  // than only for the tiles currently mounted.
  test('mounts a bounded window instead of the whole result set', () => {
    const many = Array.from({ length: 200 }, (_, i) => entry(`p${i}`));
    const html = renderGrid(many);
    const count = [...html.matchAll(/data-preset-id="/gu)].length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(200);
  });

  test('reserves scroll height for every entry, not just the mounted ones', () => {
    const html = renderGrid(
      Array.from({ length: 200 }, (_, i) => entry(`p${i}`)),
    );
    const mounted = [...html.matchAll(/data-preset-id="/gu)].length;
    // The virtualizer writes the full content height inline on the list.
    const height = html.match(/height:\s*(\d+(?:\.\d+)?)px/u);
    expect(height).not.toBeNull();
    const totalPx = Number(height?.[1]);
    // 200 single-column rows at ~212px each dwarf whatever is mounted; the
    // exact figure depends on the seed row height, so assert the property
    // (all entries accounted for) rather than a magic number.
    expect(totalPx).toBeGreaterThan(mounted * 212);
    expect(totalPx).toBeGreaterThanOrEqual(200 * 100);
  });
});
