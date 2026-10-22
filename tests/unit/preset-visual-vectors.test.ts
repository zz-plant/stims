import { afterEach, expect, test } from 'bun:test';
import {
  loadPresetVisualVectors,
  matchesVisualQuery,
  PresetVisualVectors,
  resetPresetVisualVectors,
  scoreVisualQuery,
  VISUAL_MATCH_MIN_SCORE,
  visualTermsInQuery,
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

test('neighbours filter by minScore when provided', () => {
  const all = vectors().neighbours('fire', 3) ?? [];
  expect(all.length).toBe(3);

  // Only `embers` is above 0.9 similarity with `fire`
  const filtered = vectors().neighbours('fire', 3, 0.9) ?? [];
  expect(filtered.map((match) => match.presetId)).toEqual(['embers']);
});

test('VISUAL_MATCH_MIN_SCORE provides a calibrated noise-floor cutoff', () => {
  expect(VISUAL_MATCH_MIN_SCORE).toBeGreaterThan(0.8);
  expect(VISUAL_MATCH_MIN_SCORE).toBeLessThan(0.95);
});

test('similarity returns cosine score between two presets or null', () => {
  expect(vectors().similarity('fire', 'embers')).toBeGreaterThan(0.95);
  expect(vectors().similarity('fire', 'lattice')).toBeLessThan(0.2);
  expect(vectors().similarity('fire', 'unknown')).toBeNull();
});

test('getVector returns normalized Float32Array or null', () => {
  const v = vectors().getVector('fire');
  expect(v).not.toBeNull();
  if (!v) throw new Error('expected vector');
  expect(v.length).toBe(4);
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  expect(Math.abs(Math.sqrt(sumSq) - 1)).toBeLessThan(1e-4);

  expect(vectors().getVector('unknown')).toBeNull();
});

test('searchByVector finds matches closest to an arbitrary vector', () => {
  const query = [1, 0, 0, 0]; // Points purely along fire/embers
  const matches = vectors().searchByVector(query, 2);
  expect(matches.map((m) => m.presetId)).toEqual(['fire', 'embers']);
  expect(matches[0].score).toBeGreaterThan(0.98);

  // With exclusion
  const withExclusion = vectors().searchByVector(query, 2, -Infinity, 'fire');
  expect(withExclusion[0].presetId).toBe('embers');
});

test('blend computes visual centroid between presets', () => {
  const blended = vectors().blend(['fire', 'lattice']);
  expect(blended).not.toBeNull();
  if (!blended) throw new Error('expected blended vector');
  expect(blended.length).toBe(4);

  // Blended vector sits between fire and lattice
  const matches = vectors().searchByVector(blended, 4);
  expect(matches.length).toBe(4);

  expect(vectors().blend(['unknown'])).toBeNull();
});

test('diverseNeighbours avoids near-duplicate dominance using MMR', () => {
  const v = vectors();
  // Fire and embers are near duplicates (~0.98 similarity).
  // Lattice and grid are orthogonal direction.
  const normal = v.neighbours('fire', 3) ?? [];
  expect(normal[0].presetId).toBe('embers');

  const diverse = v.diverseNeighbours('fire', 2, 0.5, 0.0) ?? [];
  expect(diverse.length).toBe(2);
  expect(diverse[0].presetId).toBe('embers');
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

// Two visual directions, x and y. `both` leans into each; `x-only` and
// `y-only` are extreme in one and absent from the other.
const TERM_IDS = ['x-only', 'y-only', 'both', 'neither-a', 'neither-b'];
const TERM_ROWS = [
  [100, 0, 0, 0],
  [0, 100, 0, 0],
  [80, 80, 0, 0],
  [0, 0, 100, 0],
  [0, 0, 0, 100],
];
const MODEL = 'test-model, 4-d int8';

function termVectors() {
  return new PresetVisualVectors(
    { version: 1, model: MODEL, dims: 4, ids: TERM_IDS },
    Int8Array.from(TERM_ROWS.flat()),
  );
}

test('a term ranks every preview by how far it stands out for that term', () => {
  const scores = termVectors().termScores([[127, 0, 0, 0]]);

  expect(scores.get('x-only')).toBeGreaterThan(scores.get('both') ?? 0);
  expect(scores.get('both')).toBeGreaterThan(scores.get('y-only') ?? 0);
  // z-scores: what the term does not describe lands below the mean.
  expect(scores.get('neither-a')).toBeLessThan(0);
});

test('several terms rank what is both above what is only very much one', () => {
  const scores = termVectors().termScores([
    [127, 0, 0, 0],
    [0, 127, 0, 0],
  ]);
  const ranked = [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([id]) => id);

  expect(ranked[0]).toBe('both');
});

test('a term vector of the wrong width scores nothing rather than garbage', () => {
  expect(termVectors().termScores([[127, 0, 0]]).size).toBe(0);
});

test('a query counts as visual only when every word belongs to a term', () => {
  const terms = ['tunnel', 'blue', 'black and white'];

  expect(visualTermsInQuery('blue tunnel', terms)).toEqual(['blue', 'tunnel']);
  expect(visualTermsInQuery('black and white', terms)).toEqual([
    'black and white',
  ]);
  expect(visualTermsInQuery('tunnel tunnel', terms)).toEqual(['tunnel']);
  // An author or title word means the text is the point.
  expect(visualTermsInQuery('geiss tunnel', terms)).toBeNull();
  expect(visualTermsInQuery('and', terms)).toBeNull();
  expect(visualTermsInQuery('', terms)).toBeNull();
});

test('only a preview that clearly matches the term widens the browse filter', () => {
  const scores = new Map([
    ['clear', 3.1],
    ['faint', 1.2],
  ]);

  expect(matchesVisualQuery('clear', scores)).toBe(true);
  expect(matchesVisualQuery('faint', scores)).toBe(false);
  expect(matchesVisualQuery('no-vector', scores)).toBe(false);
});

function serveVisualFiles(termsModel: string) {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('visual-terms.json')) {
      return Response.json({
        version: 1,
        model: termsModel,
        dims: 4,
        terms: ['x', 'y'],
        vectors: [
          [127, 0, 0, 0],
          [0, 127, 0, 0],
        ],
      });
    }
    if (url.endsWith('visual-vectors.json')) {
      return Response.json({
        version: 1,
        model: MODEL,
        dims: 4,
        ids: TERM_IDS,
      });
    }
    if (url.endsWith('visual-vectors.bin')) {
      return new Response(Int8Array.from(TERM_ROWS.flat()));
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return {
    requested,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

test('a visual query is scored on the device from the shipped files', async () => {
  const served = serveVisualFiles(MODEL);
  try {
    const scores = await scoreVisualQuery('x y');
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(best[0]).toBe('both');
  } finally {
    served.restore();
  }
});

test('a text query never fetches the preset vectors', async () => {
  const served = serveVisualFiles(MODEL);
  try {
    expect((await scoreVisualQuery('geiss')).size).toBe(0);
    expect(
      served.requested.some((url) => url.endsWith('visual-vectors.bin')),
    ).toBe(false);
  } finally {
    served.restore();
  }
});

test('term vectors from another model are refused, not compared', async () => {
  const served = serveVisualFiles('some-other-model, 4-d int8');
  try {
    expect((await scoreVisualQuery('x')).size).toBe(0);
  } finally {
    served.restore();
  }
});

test('relevance lists presets that name the term first, then by resemblance', () => {
  const entries: PresetCatalogEntry[] = [
    { id: 'looks-faintly', title: 'Untitled 7' },
    { id: 'named', title: 'Neon Tunnel Run' },
    { id: 'looks-strongly', title: 'Untitled 3' },
  ];
  const visualScores = new Map([
    ['looks-faintly', 2.6],
    ['named', 0.4],
    ['looks-strongly', 4.2],
  ]);

  const sorted = sortBrowseEntries(
    entries,
    'relevance',
    0,
    'tunnel',
    new Map(),
    visualScores,
  );

  expect(sorted.map((entry) => entry.id)).toEqual([
    'named',
    'looks-strongly',
    'looks-faintly',
  ]);
});
