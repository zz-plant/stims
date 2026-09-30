/**
 * lab:preset-map's pieces: reading lab:dataset's .npy files, behaviour
 * features, the randomised PCA, neighbours, and the family-retrieval score.
 */
import { describe, expect, test } from 'bun:test';
import { encodeNpy } from '../../scripts/preset-lab-dataset.ts';
import {
  behaviourFeatures,
  decodeNpy,
  duplicateGroups,
  familyRetrieval,
  nearestNeighbours,
  randomizedPca,
  separateDuplicates,
  standardize,
  symmetricEigen,
} from '../../scripts/preset-lab-map.ts';

describe('decodeNpy', () => {
  test('round-trips what lab:dataset writes', () => {
    const values = new Float32Array([1.5, -2, 3.25, 0, 7, 1e-3]);
    const decoded = decodeNpy(encodeNpy(values, [2, 3]));
    expect(decoded.shape).toEqual([2, 3]);
    expect([...decoded.data]).toEqual([...values]);
    const bytes = decodeNpy(encodeNpy(new Uint8Array([0, 128, 255]), [3]));
    expect(bytes.data).toBeInstanceOf(Uint8Array);
    expect([...bytes.data]).toEqual([0, 128, 255]);
  });

  test('decodes float16 payloads', () => {
    // 1.0, -2.0, 0.5, 65504 as IEEE binary16, behind a hand-built <f2 header.
    const bits = new Uint16Array([0x3c00, 0xc000, 0x3800, 0x7bff]);
    const template = encodeNpy(new Float32Array(4), [4]);
    const headerLength = template[8] as number;
    const header = new TextDecoder()
      .decode(template.slice(10, 10 + headerLength))
      .replace("'<f4'", "'<f2'");
    const bytes = new Uint8Array(10 + headerLength + bits.byteLength);
    bytes.set(template.slice(0, 10));
    bytes.set(new TextEncoder().encode(header), 10);
    bytes.set(new Uint8Array(bits.buffer), 10 + headerLength);
    expect([...decodeNpy(bytes).data]).toEqual([1, -2, 0.5, 65504]);
  });
});

describe('behaviourFeatures', () => {
  test('a bass-following column correlates with bass, not treble', () => {
    const frames = 64;
    const signalColumns = ['bass_att', 'mid_att', 'treb_att'];
    const signals = new Float32Array(frames * 3);
    const states = new Float32Array(frames * 2);
    for (let f = 0; f < frames; f += 1) {
      const bass = Math.sin(f / 3);
      const treb = Math.cos(f / 7);
      signals.set([bass, 0.5, treb], f * 3);
      states.set([1 + 0.1 * bass, 2], f * 2);
    }
    const features = behaviourFeatures([states], [signals], 2, signalColumns);
    // Per column: mean, spread, corr(bass), corr(mid), corr(treb).
    expect(features).toHaveLength(10);
    expect(features[2]).toBeCloseTo(1, 6);
    expect(Math.abs(features[4] as number)).toBeLessThan(0.3);
    // The constant column has no spread and no correlation.
    expect([...features.slice(6)]).toEqual([0, 0, 0, 0]);
  });
});

describe('standardize', () => {
  test('z-scores columns, clips outliers, and drops constants', () => {
    const rows = [
      new Float64Array([1, 7, 0]),
      new Float64Array([2, 7, 0]),
      new Float64Array([3, 7, 1000]),
    ];
    const out = standardize(rows, 3);
    expect(out[0]).toHaveLength(2); // the constant column is gone
    const mean = out.reduce((sum, row) => sum + (row[0] as number), 0) / 3;
    expect(mean).toBeCloseTo(0, 10);
    for (const row of out) {
      expect(Math.abs(row[1] as number)).toBeLessThanOrEqual(5);
    }
  });
});

describe('randomizedPca', () => {
  // Points along (1, 2) in the first two columns — identical after
  // standardising, so the data is rank-deficient, as collinear behaviour
  // features often are — plus independent noise columns.
  let seed = 3;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31 - 0.5;
  };
  const rows = standardize(
    Array.from({ length: 200 }, () => {
      const t = random() * 10;
      const row = new Float64Array(12);
      row[0] = t;
      row[1] = 2 * t;
      for (let d = 2; d < 12; d += 1) row[d] = random() * 0.1;
      return row;
    }),
    12,
  );

  test('matches the exact principal components on rank-deficient data', () => {
    const covariance = Array.from({ length: 12 }, (_, i) =>
      Array.from(
        { length: 12 },
        (_, j) =>
          rows.reduce(
            (sum, row) => sum + (row[i] as number) * (row[j] as number),
            0,
          ) / rows.length,
      ),
    );
    const exact = symmetricEigen(covariance);
    const total = exact.values.reduce((a, b) => a + b, 0);
    const { explained } = randomizedPca(rows, 3);
    explained.forEach((share, c) => {
      expect(share).toBeCloseTo((exact.values[c] as number) / total, 6);
    });
  });

  test('is stable across power iterations', () => {
    const first = randomizedPca(rows, 3, 1, 0).scores.map((row) => row[0]);
    const later = randomizedPca(rows, 3, 1, 5).scores.map((row) => row[0]);
    first.forEach((value, i) => {
      expect(Math.abs(value as number)).toBeCloseTo(
        Math.abs(later[i] as number),
        6,
      );
    });
  });
});

describe('neighbours and family retrieval', () => {
  const vectors = [
    new Float64Array([1, 0]),
    new Float64Array([0.9, 0.1]),
    new Float64Array([0, 1]),
    new Float64Array([0.1, 0.9]),
  ];

  test('nearest neighbours rank by cosine and exclude self', () => {
    const neighbours = nearestNeighbours(vectors, 2);
    expect(neighbours[0]?.map((entry) => entry.index)).toEqual([1, 3]);
    expect(neighbours[2]?.[0]?.index).toBe(3);
    expect(neighbours[0]?.[0]?.score).toBeGreaterThan(0.99);
  });

  test('scores how often a family member is the nearest neighbour', () => {
    const neighbours = nearestNeighbours(vectors, 3);
    const aligned = familyRetrieval(['a', 'a', 'b', 'b'], neighbours);
    expect(aligned).toMatchObject({ queries: 4, hitAt1: 1, hitAt10: 1 });
    expect(aligned.randomAt1).toBeCloseTo(1 / 3, 10);
    const crossed = familyRetrieval(['a', 'b', 'a', 'b'], neighbours);
    expect(crossed.hitAt1).toBe(0);
    // Presets with no relatives in the map are not queries.
    expect(familyRetrieval(['a', 'b', 'c', 'd'], neighbours).queries).toBe(0);
  });
});

describe('duplicates', () => {
  test('groups presets whose features are identical, not merely close', () => {
    const groups = duplicateGroups([
      new Float64Array([1, 2]),
      new Float64Array([1, 2]),
      new Float64Array([1, 2.000001]),
      new Float64Array([3, 4]),
    ]);
    expect(groups[0]).toBe(groups[1] as number);
    expect(groups[2]).not.toBe(groups[0] as number);
    expect(new Set(groups).size).toBe(3);
  });

  test("neighbour lists skip a preset's duplicates and list them apart", () => {
    const raw = [
      [
        { index: 1, score: 1 },
        { index: 2, score: 0.9 },
        { index: 3, score: 0.5 },
      ],
      [
        { index: 0, score: 1 },
        { index: 2, score: 0.9 },
      ],
      [{ index: 0, score: 0.9 }],
      [{ index: 2, score: 0.5 }],
    ];
    const { duplicates, neighbours } = separateDuplicates(raw, 1, [0, 0, 1, 2]);
    expect(duplicates[0]).toEqual([1]);
    expect(duplicates[2]).toEqual([]);
    expect(neighbours[0]?.map((entry) => entry.index)).toEqual([2]);
  });

  test('a preset whose only relative is its duplicate is not a query', () => {
    // 0 and 1 are the same file in family a; 2 and 3 are distinct members of b.
    const neighbours = [
      [{ index: 2 }],
      [{ index: 3 }],
      [{ index: 3 }],
      [{ index: 2 }],
    ];
    const retrieval = familyRetrieval(['a', 'a', 'b', 'b'], neighbours, [
      [1],
      [0],
      [],
      [],
    ]);
    expect(retrieval.queries).toBe(2);
    expect(retrieval.hitAt1).toBe(1);
  });
});
