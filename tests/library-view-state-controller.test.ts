import { expect, test } from 'bun:test';

import {
  applyQuery,
  clearState,
  computeFilteredToys,
  createToySearchMetadataMap,
  getQueryTokens,
  type LibraryToy,
  setSort,
  toggleFilter,
} from '../assets/js/library-view/state-controller.js';

const toys = [
  {
    slug: 'calm-flow',
    title: 'Calm Flow',
    description: 'Soft visuals for calm sessions.',
    requiresWebGPU: false,
    moods: ['calming'],
    tags: ['ambient'],
    capabilities: { demoAudio: true, microphone: true, motion: false },
  },
  {
    slug: 'tilt-wave',
    title: 'Tilt Wave',
    description: 'Mobile-first visuals driven by device motion.',
    requiresWebGPU: false,
    moods: ['energetic'],
    tags: ['mobile', 'motion'],
    capabilities: { demoAudio: false, microphone: false, motion: true },
  },
];

const getToyKey = (toy: LibraryToy) => String(toy.slug ?? '');

test('pure state transitions normalize filters and clear library state', () => {
  const withQuery = applyQuery(
    { query: '', filters: [], sort: 'featured' },
    'mobile',
  );
  expect(withQuery.query).toBe('mobile');

  const activated = toggleFilter(withQuery, 'mood:calm');
  expect(activated.isActive).toBe(true);
  expect(activated.state.filters).toEqual(['mood:calming']);

  const deactivated = toggleFilter(activated.state, 'mood:calming');
  expect(deactivated.isActive).toBe(false);
  expect(deactivated.state.filters).toEqual([]);

  const sorted = setSort(withQuery, 'az');
  expect(sorted.sort).toBe('az');

  const cleared = clearState(sorted);
  expect(cleared).toEqual({ query: '', filters: [], sort: 'featured' });
});

test('computeFilteredToys reuses metadata-driven query and filter matching', () => {
  const metadataByKey = createToySearchMetadataMap(toys, getToyKey);
  const originalOrder = new Map(toys.map((toy, index) => [toy.slug, index]));

  const filtered = computeFilteredToys({
    toys,
    state: { query: 'mobile', filters: ['tag:mobile'], sort: 'featured' },
    metadataByKey,
    getToyKey,
    originalOrder,
  });

  expect(getQueryTokens('mobile')).toEqual(['mobile']);
  expect(filtered.map((toy: { slug?: string }) => toy.slug)).toEqual([
    'tilt-wave',
  ]);
});
