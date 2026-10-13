import { afterEach, expect, test } from 'bun:test';
import {
  loadPresetVisualVectors,
  PresetVisualVectors,
  resetPresetVisualVectors,
} from '../../src/js/core/services/preset-visual-vectors.ts';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import { sortBrowseEntries } from '../../src/js/frontend/workspace-helpers.ts';

// Three directions in 4-d: `fire` and `embers` point almost the same way,
// `lattice` is orthogonal to both, `grid` is close to `lattice`.
const IDS = ['fire', 'embers', 'lattice', 'grid'];
const ROWS = [
  [100, 10, 0, 0],
  [90, 20, 0, 0],
  [0, 0, 100, 10],
  [0, 5, 90, 20],
];

function vectors() {
  return new PresetVisualVectors(
    { version: 1, model: 'test', dims: 4, ids: IDS },
    Int8Array.from(ROWS.flat()),
  );
}

afterEach(() => {
  resetPresetVisualVectors();
});

test('neighbours rank by resemblance and leave out the preset itself', () => {
  const matches = vectors().neighbours('fire', 3) ?? [];

  expect(matches.map((match) => match.presetId)).toEqual([
    'embers',
    'grid',
    'lattice',
  ]);
  expect(matches[0].score).toBeGreaterThan(0.95);
});

test('a preset with no vector has no neighbours, so callers can fall back', () => {
  expect(vectors().neighbours('generated-just-now', 5)).toBeNull();
});

test('affinity takes the closest anchor, so two unlike favourites both count', () => {
  const affinity = vectors().affinity(['fire', 'lattice']);

  // Each of these is near one anchor and far from the other. A mean of the
  // anchors would score both poorly.
  expect(affinity.get('embers')).toBeGreaterThan(0.95);
  expect(affinity.get('grid')).toBeGreaterThan(0.95);
});

test('a file that disagrees with its manifest is refused', () => {
  expect(
    () =>
      new PresetVisualVectors(
        { version: 1, model: 'test', dims: 4, ids: IDS },
        new Int8Array(7),
      ),
  ).toThrow();
});

test('missing vector files resolve to null instead of failing the caller', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('not found', { status: 404 })) as unknown as typeof fetch;
  try {
    expect(await loadPresetVisualVectors()).toBeNull();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('like-saved puts what resembles the saved presets first', () => {
  const entries: PresetCatalogEntry[] = IDS.map((id) => ({ id, title: id }));
  const affinity = vectors().affinity(['lattice']);

  const sorted = sortBrowseEntries(entries, 'like-saved', 0, '', affinity);

  expect(sorted.map((entry) => entry.id).slice(0, 2)).toEqual([
    'lattice',
    'grid',
  ]);
});

test('like-saved keeps the incoming order until there is something to rank by', () => {
  const entries: PresetCatalogEntry[] = IDS.map((id) => ({ id, title: id }));

  expect(
    sortBrowseEntries(entries, 'like-saved', 0, '').map((entry) => entry.id),
  ).toEqual(IDS);
});
