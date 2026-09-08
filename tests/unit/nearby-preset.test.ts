import { expect, mock, test } from 'bun:test';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import {
  NEARBY_RECENT_EXCLUSION_LIMIT,
  NEARBY_SEARCH_RESULTS,
  playNearbyPreset,
} from '../../src/js/frontend/workspace-actions.ts';
import { recentlyOpenedPresetIds } from '../../src/js/frontend/workspace-helpers.ts';

function entry(id: string, lastOpenedAt?: number): PresetCatalogEntry {
  return { id, title: id, lastOpenedAt };
}

test('the recency trail is most-recent-first and stops at the window', () => {
  const now = 1_000_000;
  const ids = recentlyOpenedPresetIds(
    [
      entry('old', now - 400_000),
      entry('a', now - 1_000),
      entry('never'),
      entry('b', now - 10_000),
    ],
    { now },
  );

  expect(ids).toEqual(['a', 'b']);
});

test('the trail is long enough to break a two-preset ping-pong', () => {
  const now = 1_000_000;
  const many = Array.from({ length: 20 }, (_, index) =>
    entry(`p${index}`, now - index),
  );

  // pickRecentPresets caps at 3, which is too short: the nearest neighbour of
  // B is usually A, so a 3-deep exclusion still walks back within two presses.
  expect(recentlyOpenedPresetIds(many, { now }).length).toBe(8);
});

test('a nearby jump skips the current preset and the recent trail', async () => {
  const played: string[] = [];
  const announcements: string[] = [];

  await playNearbyPreset({
    canvas: {} as HTMLCanvasElement,
    currentPresetId: 'current',
    recentPresetIds: ['just-played'],
    isKnownPreset: () => true,
    play: (id) => played.push(id),
    announce: (message) => announcements.push(message),
    // Injected rather than reaching the network: the point under test is the
    // filtering, not the index.
    searchByFrame: async () => [
      { presetId: 'current', score: 0.99 },
      { presetId: 'just-played', score: 0.95 },
      { presetId: 'fresh', score: 0.9 },
    ],
  });

  expect(played).toEqual(['fresh']);
});

test('an id the index knows but this build does not is skipped, not played', async () => {
  const played: string[] = [];

  await playNearbyPreset({
    canvas: {} as HTMLCanvasElement,
    currentPresetId: null,
    recentPresetIds: [],
    isKnownPreset: (id) => id === 'bundled',
    play: (id) => played.push(id),
    announce: () => {},
    searchByFrame: async () => [
      { presetId: 'retired-from-the-catalog', score: 0.99 },
      { presetId: 'bundled', score: 0.8 },
    ],
  });

  expect(played).toEqual(['bundled']);
});

test('an exhausted neighbourhood says so and points at the control that still moves', async () => {
  const played: string[] = [];
  const announcements: string[] = [];

  await playNearbyPreset({
    canvas: {} as HTMLCanvasElement,
    currentPresetId: 'current',
    recentPresetIds: ['a'],
    isKnownPreset: () => true,
    play: (id) => played.push(id),
    announce: (message) => announcements.push(message),
    searchByFrame: async () => [
      { presetId: 'current', score: 0.99 },
      { presetId: 'a', score: 0.9 },
    ],
  });

  expect(played).toEqual([]);
  expect(announcements.at(-1)).toContain('Surprise me');
});

test('the dev server having no index is explained, not reported as a failure', async () => {
  const announcements: string[] = [];

  await playNearbyPreset({
    canvas: {} as HTMLCanvasElement,
    currentPresetId: null,
    recentPresetIds: [],
    isKnownPreset: () => true,
    play: () => {},
    announce: (message) => announcements.push(message),
    searchByFrame: async () => {
      throw new Error(
        'Visual search API is unavailable in the Vite dev server.',
      );
    },
  });

  expect(announcements.at(-1)).toContain('deployed site');
});

test('a blank stage does not reach for the index at all', async () => {
  const search = mock(async () => []);
  const announcements: string[] = [];

  await playNearbyPreset({
    canvas: null,
    currentPresetId: null,
    recentPresetIds: [],
    isKnownPreset: () => true,
    play: () => {},
    announce: (message) => announcements.push(message),
    searchByFrame: search,
  });

  expect(search).not.toHaveBeenCalled();
  expect(announcements.at(-1)).toContain('Nothing on the stage');
});

test('nearby asks for a deeper list than it will exclude', () => {
  // The invariant that keeps the control from exhausting: measured on the
  // deployed index, the endpoint's default of 5 against an 8-deep exclusion
  // ran dry after four presses.
  expect(NEARBY_SEARCH_RESULTS).toBeGreaterThan(NEARBY_RECENT_EXCLUSION_LIMIT);
});

test('the requested depth is passed to the index, not silently defaulted', async () => {
  let requestedTopK: number | undefined = -1;

  await playNearbyPreset({
    canvas: {} as HTMLCanvasElement,
    currentPresetId: null,
    recentPresetIds: [],
    isKnownPreset: () => true,
    play: () => {},
    announce: () => {},
    searchByFrame: async (_canvas, _signal, topK) => {
      requestedTopK = topK;
      return [{ presetId: 'anything', score: 0.9 }];
    },
  });

  expect(requestedTopK).toBe(NEARBY_SEARCH_RESULTS);
});
