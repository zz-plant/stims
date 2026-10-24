import { afterEach, describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import {
  resetPresetVisualVectors,
  scoreVisualQuery,
  VISUAL_TERM_MATCH_Z,
} from '../../src/js/core/services/preset-visual-vectors.ts';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import {
  chooseReferenceWithClef,
  REFERENCE_MAX_CANDIDATES,
  type ReferenceCandidate,
  retrieveReferenceCandidates,
} from '../../src/js/frontend/reference-retrieval.ts';

const MODEL = 'test@rev f32, 4-d int8';

// Preview vectors in 4-d: `tunnel` and `fire` point along the first two axes,
// matching the term vectors served below. Sixteen neutral presets keep the
// catalog mean cosine low, so the tunnel-like presets really clear the
// 2.5-standard-deviation term threshold (the threshold was calibrated on the
// real ~1,800-preset catalog; a four-row fixture cannot reproduce that tail).
const INTERESTING: Array<[string, string, number[]]> = [
  ['geiss-tunnel', 'Geiss Tunnel', [110, 10, 0, 0]],
  ['tunnel-of-fire', 'Tunnel of Fire', [100, 90, 0, 0]],
  ['ember-drift', 'Ember Drift', [120, 20, 0, 0]],
  ['fire-lattice', 'Fire Lattice', [10, 110, 0, 0]],
  ['pastel-waves', 'Pastel Waves', [0, 0, 110, 10]],
];

const NEUTRAL_COUNT = 40;
const ROWS: Record<string, number[]> = {};
const CATALOG: PresetCatalogEntry[] = INTERESTING.map(([id, title, vector]) => {
  ROWS[id] = vector;
  return {
    id,
    title,
    ...(id === 'tunnel-of-fire' || id === 'fire-lattice'
      ? { searchTerms: ['fire'] }
      : {}),
  };
});
for (let index = 0; index < NEUTRAL_COUNT; index += 1) {
  const id = `neutral-${index}`;
  ROWS[id] = [0, 0, 100, 10];
  CATALOG.push({ id, title: `Neutral ${index}` });
}

/** Serve the shipped visual-term files so scoreVisualQuery ranks on-device. */
function serveVisualFiles() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('visual-terms.json')) {
      return Response.json({
        version: 1,
        model: MODEL,
        dims: 4,
        terms: ['tunnel', 'fire'],
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
        ids: Object.keys(ROWS),
      });
    }
    if (url.endsWith('visual-vectors.bin.gz')) {
      return new Response(
        gzipSync(Buffer.from(Int8Array.from(Object.values(ROWS).flat())), {
          level: 9,
        }) as unknown as BodyInit,
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

function candidateOf(
  shortlist: ReturnType<typeof retrieveReferenceCandidates> extends Promise<
    infer T
  >
    ? T
    : never,
  id: string,
): ReferenceCandidate | undefined {
  return shortlist.candidates.find((candidate) => candidate.presetId === id);
}

afterEach(() => {
  resetPresetVisualVectors();
});

describe('on-device description retrieval', () => {
  test('a pure text query ranks literal hits and carries no visual scores', async () => {
    const restore = serveVisualFiles();
    try {
      const shortlist = await retrieveReferenceCandidates(
        'pastel waves',
        CATALOG,
      );
      expect(shortlist.empty).toBe(false);
      const ids = shortlist.candidates.map((candidate) => candidate.presetId);
      expect(ids[0]).toBe('pastel-waves');
      for (const candidate of shortlist.candidates) {
        expect(candidate.visualZ).toBeNull();
        expect(candidate.reason).toBe('text');
      }
    } finally {
      restore();
    }
  });

  test('a visual-term query fuses terms: presets that name the term first, then visual resemblance', async () => {
    const restore = serveVisualFiles();
    try {
      // Sanity: the served files really do score tunnel-likeness on device.
      const visual = await scoreVisualQuery('tunnel');
      expect(visual.get('geiss-tunnel') ?? 0).toBeGreaterThan(
        VISUAL_TERM_MATCH_Z,
      );
      const shortlist = await retrieveReferenceCandidates('tunnel', CATALOG);
      const ranked = shortlist.candidates;
      expect(ranked.length).toBeGreaterThan(1);
      // Text hits (title contains "tunnel") come before any visual-only hit.
      const firstText = ranked.findIndex(
        (candidate) => candidate.reason !== 'visual',
      );
      const firstVisualOnly = ranked.findIndex(
        (candidate) => candidate.reason === 'visual',
      );
      if (firstVisualOnly >= 0) {
        expect(firstText).toBeGreaterThanOrEqual(0);
        expect(firstText).toBeLessThan(firstVisualOnly);
      }
      // Every visual-only candidate cleared the term threshold.
      for (const candidate of ranked) {
        if (candidate.visualZ !== null) {
          expect(candidate.visualZ).toBeGreaterThanOrEqual(VISUAL_TERM_MATCH_Z);
        }
      }
      // Component scores are preserved, never averaged away.
      const tunnel = candidateOf(shortlist, 'tunnel-of-fire');
      expect(tunnel?.textScore).toBeTypeOf('number');
      expect(tunnel?.visualZ).toBeTypeOf('number');
      expect(tunnel?.reason).toBe('both');
    } finally {
      restore();
    }
  });

  test('a query with a non-term word gets no visual scores (all-or-nothing)', async () => {
    const restore = serveVisualFiles();
    try {
      const shortlist = await retrieveReferenceCandidates(
        'geiss tunnel',
        CATALOG,
      );
      for (const candidate of shortlist.candidates) {
        expect(candidate.visualZ).toBeNull();
      }
    } finally {
      restore();
    }
  });

  test('a nonsense query returns an empty shortlist, not the whole catalog', async () => {
    const restore = serveVisualFiles();
    try {
      const shortlist = await retrieveReferenceCandidates(
        'purple accountancy spreadsheet filing',
        CATALOG,
      );
      expect(shortlist.empty).toBe(true);
      expect(shortlist.candidates).toEqual([]);
    } finally {
      restore();
    }
  });

  test('an empty query and an empty catalog are both empty results', async () => {
    const shortlist = await retrieveReferenceCandidates('', CATALOG);
    expect(shortlist.empty).toBe(true);
    const emptyCatalog = await retrieveReferenceCandidates('tunnel', []);
    expect(emptyCatalog.empty).toBe(true);
  });

  test('topK is bounded by the server cap', async () => {
    const restore = serveVisualFiles();
    try {
      const many = Array.from({ length: 40 }, (_, index) => ({
        id: `preset-${index}`,
        title: `Tunnel ${index}`,
      })) as PresetCatalogEntry[];
      const shortlist = await retrieveReferenceCandidates('tunnel', many, {
        topK: 100,
      });
      expect(shortlist.candidates.length).toBeLessThanOrEqual(
        REFERENCE_MAX_CANDIDATES,
      );
    } finally {
      restore();
    }
  });
});

describe('Clef reference selection', () => {
  const candidates: ReferenceCandidate[] = [
    {
      presetId: 'preset-a',
      textScore: 5,
      visualZ: 3,
      reason: 'both',
      entry: CATALOG[0] ?? null,
    },
    {
      presetId: 'preset-b',
      textScore: 2,
      visualZ: null,
      reason: 'text',
      entry: CATALOG[1] ?? null,
    },
  ];

  function cannedResult(choice: 'preset-a' | 'preset-b' | 'hold' | 'none') {
    const probabilities: Record<string, number> = {
      'preset-a': 0.05,
      'preset-b': 0.05,
      hold: 0.05,
      none: 0.05,
    };
    probabilities[choice] = 0.85;
    return {
      version: 1,
      task: 'reference-choice',
      model: 'clef-flash',
      answers: {
        candidate: { type: 'choice', choice, probabilities, confidence: 0.9 },
        sufficient_evidence: { type: 'noul', noul: 0.95 },
      },
      disposition:
        choice === 'preset-a' || choice === 'preset-b' ? 'accepted' : 'review',
      provenance: {
        questionVersion: 'stims-reference-choice-v1',
        evaluatedAt: '2026-10-23T00:00:00.000Z',
        inputHash: 'a'.repeat(64),
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }

  test('chooses an offered candidate and records the model receipt', async () => {
    const outcome = await chooseReferenceWithClef({
      image: 'data:image/png;base64,iVBORw0KGgo=',
      description: 'a slow neon tunnel',
      candidates,
      endpoint: 'https://example.com/api/decide',
      fetcher: async () => Response.json(cannedResult('preset-a')),
    });
    expect(outcome.kind).toBe('chosen');
    if (outcome.kind === 'chosen') {
      expect(outcome.presetId).toBe('preset-a');
      expect(outcome.result.provenance.questionVersion).toBe(
        'stims-reference-choice-v1',
      );
    }
  });

  test('hold abstains without selecting anything', async () => {
    const outcome = await chooseReferenceWithClef({
      image: 'data:image/png;base64,iVBORw0KGgo=',
      candidates,
      endpoint: 'https://example.com/api/decide',
      fetcher: async () => Response.json(cannedResult('hold')),
    });
    expect(outcome.kind).toBe('abstained');
  });

  test('an empty shortlist abstains without a hosted call', async () => {
    let sent = false;
    const outcome = await chooseReferenceWithClef({
      image: 'data:image/png;base64,iVBORw0KGgo=',
      candidates: [],
      endpoint: 'https://example.com/api/decide',
      fetcher: async () => {
        sent = true;
        return Response.json(cannedResult('preset-a'));
      },
    });
    expect(outcome.kind).toBe('abstained');
    expect(sent).toBe(false);
  });

  test('a failed hosted call degrades to unavailable, not a crash', async () => {
    const outcome = await chooseReferenceWithClef({
      image: 'data:image/png;base64,iVBORw0KGgo=',
      candidates,
      endpoint: 'https://example.com/api/decide',
      fetcher: async () => new Response('down', { status: 503 }),
    });
    expect(outcome.kind).toBe('unavailable');
  });
});
