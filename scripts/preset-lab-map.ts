/**
 * Preset lab — preset map: embeds every preset by how it moves and reacts to audio, for "more like this" by behaviour.
 *
 * Reads a lab:dataset directory (so the VM stepping is not repeated) and
 * describes each preset by its per-frame behaviour: for every scenario and
 * every state column, the mean, the spread, and the correlation with each
 * audio band. Those features are standardised across the corpus and reduced
 * with randomised PCA to a small embedding, whose cosine neighbours are
 * "presets that move like this one".
 *
 *   bun run lab:dataset -- --out output/dataset --scenarios bass-pulse,mid-pulse,treble-pulse,full-mix
 *   bun run lab:preset-map -- --dataset output/dataset [--dims 32] [--k 10] [--out output/preset-map]
 *
 * Writes under --out:
 *   embeddings.npy   float32 [presets, dims]
 *   presets.json     [{ id, title, family }] in embedding row order
 *   neighbors.json   { id: { neighbors: [{ id, score }], duplicates: [id] } }: the top
 *                    --k distinct presets by cosine similarity, and apart from
 *                    them the presets whose features are identical (the same
 *                    preset shipped twice, or presets that differ only where
 *                    the map cannot see), which "more like this" should not offer
 *   map2d.json       [{ id, x, y }] on the first two components, for plotting
 *   report.json      explained variance and the evaluation below
 *
 * Evaluation, printed and saved: a remix and its base work usually behave
 * alike, so for every preset whose remix family has a distinct member in
 * the map, how often one is its nearest neighbour (hit@1) or among its top
 * 10 (hit@10), against the rate random neighbours would give. Exact
 * behavioural duplicates are excluded on both sides: counted, they turn
 * "the same file twice" into easy perfect hits. It
 * checks the map finds relatives; what it adds is the other neighbours:
 * presets from different families and authors that move the same way,
 * which the lineage cannot find.
 *
 * This complements the app's "Find similar", which matches how a rendered
 * frame looks. This matches how a preset behaves over time and with music,
 * and needs no GPU. It sees VM variables, not shaders: two presets that
 * differ only in their warp/composite shaders look alike here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { encodeNpy } from './preset-lab-dataset.ts';

type NpyArray = { shape: number[]; data: Float32Array | Uint8Array };

function float16ToFloat32(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 0x1f) return mantissa ? Number.NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

/** Reads the .npy files lab:dataset writes: <f4, <f2 or |u1, C order. */
export function decodeNpy(bytes: Uint8Array): NpyArray {
  if (
    bytes[0] !== 0x93 ||
    String.fromCharCode(...bytes.slice(1, 6)) !== 'NUMPY'
  ) {
    throw new Error('not a .npy file');
  }
  const headerLength = (bytes[8] as number) | ((bytes[9] as number) << 8);
  const header = new TextDecoder().decode(bytes.slice(10, 10 + headerLength));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const shapeText = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '';
  if (/'fortran_order':\s*True/.test(header)) {
    throw new Error('Fortran-order .npy is not supported');
  }
  const shape = shapeText
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  const offset = 10 + headerLength;
  const count = shape.reduce((product, size) => product * size, 1);
  const body = bytes.slice(offset);
  if (descr === '<f4') {
    return { shape, data: new Float32Array(body.buffer, 0, count) };
  }
  if (descr === '<f2') {
    const bits = new Uint16Array(body.buffer, 0, count);
    const data = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      data[i] = float16ToFloat32(bits[i] as number);
    }
    return { shape, data };
  }
  if (descr === '|u1') {
    return { shape, data: new Uint8Array(body.buffer, 0, count) };
  }
  throw new Error(`unsupported .npy dtype ${descr}`);
}

/** The audio bands behaviour is correlated with, as lab:dataset names them. */
const BAND_SIGNALS = ['bass_att', 'mid_att', 'treb_att'] as const;
const STATS_PER_COLUMN = 2 + BAND_SIGNALS.length;

function pearson(
  a: ArrayLike<number>,
  aStride: number,
  aOffset: number,
  b: ArrayLike<number>,
  bStride: number,
  bOffset: number,
  n: number,
): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i * aStride + aOffset] as number;
    meanB += b[i * bStride + bOffset] as number;
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (a[i * aStride + aOffset] as number) - meanA;
    const db = (b[i * bStride + bOffset] as number) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  return varA > 1e-12 && varB > 1e-12 ? cov / Math.sqrt(varA * varB) : 0;
}

/**
 * Behaviour features for one preset: per scenario and state column, the
 * mean, the log-compressed spread, and the correlation with each band.
 * `states[s]` is [frames, columns]; `signals[s]` is [frames, signalColumns].
 */
export function behaviourFeatures(
  states: readonly Float32Array[],
  signals: readonly Float32Array[],
  columns: number,
  signalColumns: readonly string[],
): Float64Array {
  const out = new Float64Array(states.length * columns * STATS_PER_COLUMN);
  const bandIndex = BAND_SIGNALS.map((band) => signalColumns.indexOf(band));
  let at = 0;
  states.forEach((scenarioStates, scenario) => {
    const scenarioSignals = signals[scenario] as Float32Array;
    const frames = scenarioStates.length / columns;
    for (let column = 0; column < columns; column += 1) {
      let mean = 0;
      for (let f = 0; f < frames; f += 1) {
        mean += scenarioStates[f * columns + column] as number;
      }
      mean /= frames;
      let variance = 0;
      for (let f = 0; f < frames; f += 1) {
        const d = (scenarioStates[f * columns + column] as number) - mean;
        variance += d * d;
      }
      const std = Math.sqrt(variance / frames);
      // Means and spreads span orders of magnitude (q registers, zoom);
      // a signed log keeps one huge register from owning the standardised
      // space.
      out[at++] = Math.sign(mean) * Math.log1p(Math.abs(mean));
      out[at++] = Math.log1p(std);
      for (const band of bandIndex) {
        out[at++] =
          band < 0
            ? 0
            : pearson(
                scenarioStates,
                columns,
                column,
                scenarioSignals,
                signalColumns.length,
                band,
                frames,
              );
      }
    }
  });
  return out;
}

/**
 * Standardises columns in place (z-scores, clipped at ±5) and drops columns
 * that never vary. Returns the kept width.
 */
export function standardize(
  rows: Float64Array[],
  width: number,
): Float64Array[] {
  const n = rows.length;
  const keep: number[] = [];
  const means = new Float64Array(width);
  const stds = new Float64Array(width);
  for (let d = 0; d < width; d += 1) {
    let mean = 0;
    for (const row of rows) mean += row[d] as number;
    mean /= n;
    let variance = 0;
    for (const row of rows) variance += ((row[d] as number) - mean) ** 2;
    const std = Math.sqrt(variance / n);
    means[d] = mean;
    stds[d] = std;
    if (std > 1e-9) keep.push(d);
  }
  const out = rows.map((row) => {
    const z = new Float64Array(keep.length);
    keep.forEach((d, i) => {
      const value =
        ((row[d] as number) - (means[d] as number)) / (stds[d] as number);
      z[i] = Math.max(-5, Math.min(5, value));
    });
    return z;
  });
  // Clipping an outlier moves its column's mean off zero, and the PCA
  // assumes centred input (a leftover mean reads as variance), so recentre.
  for (let i = 0; i < keep.length; i += 1) {
    let mean = 0;
    for (const row of out) mean += row[i] as number;
    mean /= n;
    for (const row of out) row[i] = (row[i] as number) - mean;
  }
  return out;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Orthonormal basis for the span of `columns` (each a vector of length n).
 * Gram–Schmidt runs twice per column ("twice is enough"): once is not
 * orthogonal to working precision. Columns that are (numerically) in the
 * span of earlier ones are dropped rather than normalised: collinear
 * features are common, and a normalised round-off residue is a vector
 * pointing nowhere in particular, which silently corrupts the projection.
 */
function orthonormalize(columns: Float64Array[]): Float64Array[] {
  const basis: Float64Array[] = [];
  for (const column of columns) {
    const v = Float64Array.from(column);
    let original = 0;
    for (const x of v) original += x * x;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const u of basis) {
        let dot = 0;
        for (let r = 0; r < v.length; r += 1)
          dot += (u[r] as number) * (v[r] as number);
        for (let r = 0; r < v.length; r += 1)
          v[r] = (v[r] as number) - dot * (u[r] as number);
      }
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    if (norm <= 1e-20 * Math.max(original, 1e-300)) continue;
    norm = Math.sqrt(norm);
    for (let r = 0; r < v.length; r += 1) v[r] = (v[r] as number) / norm;
    basis.push(v);
  }
  return basis;
}

/** Eigen-decomposition of a small symmetric matrix by cyclic Jacobi. */
export function symmetricEigen(matrix: number[][]): {
  values: number[];
  vectors: number[][];
} {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1)
      for (let q = p + 1; q < n; q += 1) off += (a[p]?.[q] as number) ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p]?.[q] as number;
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p]?.[p] as number;
        const aqq = a[q]?.[q] as number;
        const theta = (aqq - app) / (2 * apq);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k]?.[p] as number;
          const akq = a[k]?.[q] as number;
          (a[k] as number[])[p] = c * akp - s * akq;
          (a[k] as number[])[q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p]?.[k] as number;
          const aqk = a[q]?.[k] as number;
          (a[p] as number[])[k] = c * apk - s * aqk;
          (a[q] as number[])[k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k]?.[p] as number;
          const vkq = v[k]?.[q] as number;
          (v[k] as number[])[p] = c * vkp - s * vkq;
          (v[k] as number[])[q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => (a[j]?.[j] as number) - (a[i]?.[i] as number),
  );
  return {
    values: order.map((i) => a[i]?.[i] as number),
    vectors: order.map((i) => v.map((row) => row[i] as number)),
  };
}

/**
 * Randomised PCA (Halko et al.): the top `dims` component scores of the
 * rows, which must already be centred (standardize does that). Returns the
 * scores and each component's share of the total variance.
 */
export function randomizedPca(
  rows: readonly Float64Array[],
  dims: number,
  seed = 1,
  powerIterations = 3,
): { scores: Float64Array[]; explained: number[] } {
  const n = rows.length;
  const width = rows[0]?.length ?? 0;
  const l = Math.min(dims + 10, n, width);
  const random = mulberry32(seed);
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(random() || 1e-12)) *
    Math.cos(2 * Math.PI * random());
  // Y = X·Ω, kept as l columns of length n.
  const omega = Array.from({ length: l }, () => {
    const column = new Float64Array(width);
    for (let d = 0; d < width; d += 1) column[d] = gaussian();
    return column;
  });
  const times = (w: Float64Array[]) =>
    w.map((column) => {
      const out = new Float64Array(n);
      rows.forEach((row, r) => {
        let dot = 0;
        for (let d = 0; d < width; d += 1)
          dot += (row[d] as number) * (column[d] as number);
        out[r] = dot;
      });
      return out;
    });
  const transposeTimes = (y: Float64Array[]) =>
    y.map((column) => {
      const out = new Float64Array(width);
      rows.forEach((row, r) => {
        const weight = column[r] as number;
        for (let d = 0; d < width; d += 1)
          out[d] = (out[d] as number) + weight * (row[d] as number);
      });
      return out;
    });
  let y = orthonormalize(times(omega));
  for (let i = 0; i < powerIterations; i += 1) {
    y = orthonormalize(times(orthonormalize(transposeTimes(y))));
  }
  // B = Qᵀ·X (l×width); eigen of B·Bᵀ gives the singular structure.
  const b = transposeTimes(y);
  const gram = b.map((bi) =>
    b.map((bj) => {
      let dot = 0;
      for (let d = 0; d < width; d += 1)
        dot += (bi[d] as number) * (bj[d] as number);
      return dot;
    }),
  );
  const { values, vectors } = symmetricEigen(gram);
  let total = 0;
  for (const row of rows)
    for (let d = 0; d < width; d += 1) total += (row[d] as number) ** 2;
  // A rank-deficient input yields fewer basis vectors than requested.
  const basisSize = y.length;
  const k = Math.min(dims, basisSize);
  // Scores = U·S = Q·W·S, and Q·W·S = Q·(B·Bᵀ eigvec)·sqrt(λ) = Q·W·√λ.
  const scores = Array.from({ length: n }, () => new Float64Array(k));
  for (let c = 0; c < k; c += 1) {
    const w = vectors[c] as number[];
    const s = Math.sqrt(Math.max(0, values[c] as number));
    for (let r = 0; r < n; r += 1) {
      let u = 0;
      for (let j = 0; j < basisSize; j += 1)
        u += (y[j]?.[r] as number) * (w[j] as number);
      (scores[r] as Float64Array)[c] = u * s;
    }
  }
  return {
    scores,
    explained: values
      .slice(0, k)
      .map((value) => (total > 0 ? Math.max(0, value) / total : 0)),
  };
}

/** Top-k cosine neighbours of every row (self excluded). */
export function nearestNeighbours(
  vectors: readonly Float64Array[],
  k: number,
): Array<Array<{ index: number; score: number }>> {
  const unit = vectors.map((v) => {
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
  });
  return unit.map((a, i) => {
    const best: Array<{ index: number; score: number }> = [];
    unit.forEach((b, j) => {
      if (i === j) return;
      let dot = 0;
      for (let d = 0; d < a.length; d += 1)
        dot += (a[d] as number) * (b[d] as number);
      if (best.length < k || dot > (best[best.length - 1]?.score ?? -2)) {
        best.push({ index: j, score: dot });
        best.sort((x, y) => y.score - x.score);
        if (best.length > k) best.pop();
      }
    });
    return best;
  });
}

export type FamilyRetrieval = {
  /** Presets with at least one family member elsewhere in the map. */
  queries: number;
  hitAt1: number;
  hitAt10: number;
  /** What random neighbours would score, averaged over the same queries. */
  randomAt1: number;
  randomAt10: number;
};

/**
 * Groups presets whose behaviour features are identical (to 1e-9), i.e.
 * presets this map cannot tell apart at all. Decided on the full feature
 * vectors, not the embedding: the embedding keeps only the leading
 * components, and presets differing along the dropped ones would collapse
 * to the same point and be mistaken for duplicates.
 */
export function duplicateGroups(features: readonly Float64Array[]): number[] {
  const groups = new Map<string, number>();
  return features.map((row) => {
    const key = Array.from(row, (value) => value.toPrecision(10)).join(',');
    const existing = groups.get(key);
    if (existing !== undefined) return existing;
    groups.set(key, groups.size);
    return groups.size - 1;
  });
}

/**
 * Splits neighbour lists into the presets identical in behaviour (same
 * group) and the `k` nearest distinct presets, which is what "more like
 * this" should show.
 */
export function separateDuplicates(
  raw: ReadonlyArray<ReadonlyArray<{ index: number; score: number }>>,
  k: number,
  groups: readonly number[],
): {
  duplicates: number[][];
  neighbours: Array<Array<{ index: number; score: number }>>;
} {
  const members = new Map<number, number[]>();
  groups.forEach((group, i) => {
    const list = members.get(group) ?? [];
    list.push(i);
    members.set(group, list);
  });
  return {
    duplicates: groups.map((group, i) =>
      (members.get(group) ?? []).filter((j) => j !== i),
    ),
    neighbours: raw.map((list, i) =>
      list.filter((entry) => groups[entry.index] !== groups[i]).slice(0, k),
    ),
  };
}

/**
 * Chance that `draws` distinct picks from `pool` items miss all `hits` of
 * them (hypergeometric, zero successes).
 */
function missAll(pool: number, hits: number, draws: number): number {
  let p = 1;
  for (let d = 0; d < draws; d += 1)
    p *= Math.max(0, pool - hits - d) / (pool - d);
  return p;
}

/**
 * How often a preset's nearest distinct neighbours include its remix
 * family. `duplicates[i]` (optional) lists presets identical in behaviour
 * to i (see duplicateGroups): they are neither hits nor relatives, so a preset whose only
 * relatives are its duplicates is not a query. Without that, a family that
 * is one file shipped twice scores a perfect hit and inflates the result.
 */
export function familyRetrieval(
  families: readonly string[],
  neighbours: ReadonlyArray<ReadonlyArray<{ index: number }>>,
  duplicates: ReadonlyArray<readonly number[]> = [],
): FamilyRetrieval {
  const sizes = new Map<string, number>();
  for (const family of families)
    sizes.set(family, (sizes.get(family) ?? 0) + 1);
  const n = families.length;
  let queries = 0;
  let hit1 = 0;
  let hit10 = 0;
  let random1 = 0;
  let random10 = 0;
  families.forEach((family, i) => {
    const sameFamilyDuplicates = (duplicates[i] ?? []).filter(
      (j) => families[j] === family,
    ).length;
    const relatives = (sizes.get(family) ?? 1) - 1 - sameFamilyDuplicates;
    if (relatives < 1) return;
    queries += 1;
    const list = neighbours[i] ?? [];
    if (families[list[0]?.index ?? -1] === family) hit1 += 1;
    if (list.slice(0, 10).some((entry) => families[entry.index] === family))
      hit10 += 1;
    // A random list draws without replacement from the presets a real list
    // could hold: everyone but the query and its duplicates.
    const pool = n - 1 - (duplicates[i]?.length ?? 0);
    random1 += relatives / pool;
    random10 += 1 - missAll(pool, relatives, Math.min(10, pool));
  });
  const rate = (value: number) => (queries ? value / queries : 0);
  return {
    queries,
    hitAt1: rate(hit1),
    hitAt10: rate(hit10),
    randomAt1: rate(random1),
    randomAt10: rate(random10),
  };
}

type IndexRow = {
  presetId: string;
  title: string;
  family: string;
  scenario: string;
  status: string;
  file: string | null;
};

function readJsonl<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const datasetDir = get('--dataset');
  if (!datasetDir) {
    throw new Error(
      'Usage: bun run lab:preset-map -- --dataset <lab:dataset dir> [--dims 32] [--k 10] [--out output/preset-map]',
    );
  }
  const dims = Number(get('--dims') ?? 32);
  const k = Number(get('--k') ?? 10);
  const outDir = path.resolve(get('--out') ?? 'output/preset-map');
  const root = path.resolve(datasetDir);
  const files = fs.readdirSync(root);
  const manifestFile = files.find((file) => /^manifest.*\.json$/.test(file));
  if (!manifestFile) throw new Error(`${root} has no manifest*.json`);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, manifestFile), 'utf8'),
  ) as {
    signals: { columns: string[] };
    states: { columns: string[] | string };
  };
  if (!Array.isArray(manifest.states.columns)) {
    throw new Error(
      'lab:preset-map needs a dataset written with the canonical columns (not --vars all).',
    );
  }
  const columns = manifest.states.columns.length;
  const rows = files
    .filter((file) => /^index.*\.jsonl$/.test(file))
    .flatMap((file) => readJsonl<IndexRow>(path.join(root, file)));
  const scenarios = [...new Set(rows.map((row) => row.scenario))].sort();
  const signals = scenarios.map(
    (scenario) =>
      decodeNpy(
        new Uint8Array(
          fs.readFileSync(path.join(root, 'signals', `${scenario}.npy`)),
        ),
      ).data as Float32Array,
  );
  const byPreset = new Map<string, IndexRow[]>();
  for (const row of rows) {
    const list = byPreset.get(row.presetId) ?? [];
    list.push(row);
    byPreset.set(row.presetId, list);
  }
  const presets: Array<{ id: string; title: string; family: string }> = [];
  const features: Float64Array[] = [];
  let skipped = 0;
  for (const [id, presetRows] of [...byPreset].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const usable = scenarios.map((scenario) =>
      presetRows.find((row) => row.scenario === scenario && row.file),
    );
    if (usable.some((row) => !row)) {
      skipped += 1; // errored or missing in some scenario
      continue;
    }
    const states = usable.map(
      (row) =>
        decodeNpy(
          new Uint8Array(fs.readFileSync(path.join(root, row?.file as string))),
        ).data as Float32Array,
    );
    features.push(
      behaviourFeatures(states, signals, columns, manifest.signals.columns),
    );
    const first = presetRows[0] as IndexRow;
    presets.push({ id, title: first.title, family: first.family });
  }
  if (presets.length < 3) throw new Error('Need at least 3 usable presets.');
  const standardized = standardize(features, features[0]?.length ?? 0);
  const { scores, explained } = randomizedPca(standardized, dims);
  // A preset's duplicates are removed from its list, so ask for enough
  // extra that k distinct neighbours survive even in the largest group.
  const groups = duplicateGroups(features);
  const groupSizes = new Map<number, number>();
  for (const group of groups) {
    groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1);
  }
  const largestGroup = Math.max(...groupSizes.values());
  const { duplicates, neighbours } = separateDuplicates(
    nearestNeighbours(scores, k + largestGroup - 1),
    k,
    groups,
  );
  const retrieval = familyRetrieval(
    presets.map((preset) => preset.family),
    neighbours,
    duplicates,
  );
  const duplicated = duplicates.filter((list) => list.length > 0).length;

  fs.mkdirSync(outDir, { recursive: true });
  const width = scores[0]?.length ?? 0;
  const flat = new Float32Array(presets.length * width);
  scores.forEach((row, r) => flat.set(row, r * width));
  fs.writeFileSync(
    path.join(outDir, 'embeddings.npy'),
    encodeNpy(flat, [presets.length, width]),
  );
  fs.writeFileSync(path.join(outDir, 'presets.json'), JSON.stringify(presets));
  fs.writeFileSync(
    path.join(outDir, 'neighbors.json'),
    JSON.stringify(
      Object.fromEntries(
        presets.map((preset, i) => [
          preset.id,
          {
            neighbors: (neighbours[i] ?? []).map((entry) => ({
              id: presets[entry.index]?.id,
              score: Math.round(entry.score * 1e4) / 1e4,
            })),
            duplicates: (duplicates[i] ?? []).map((j) => presets[j]?.id),
          },
        ]),
      ),
    ),
  );
  fs.writeFileSync(
    path.join(outDir, 'map2d.json'),
    JSON.stringify(
      presets.map((preset, i) => ({
        id: preset.id,
        x: scores[i]?.[0] ?? 0,
        y: scores[i]?.[1] ?? 0,
      })),
    ),
  );
  const report = {
    presets: presets.length,
    skipped,
    scenarios,
    featureWidth: standardized[0]?.length ?? 0,
    dims: width,
    explainedVariance: explained.reduce((a, b) => a + b, 0),
    presetsWithDuplicates: duplicated,
    familyRetrieval: retrieval,
  };
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Mapped ${presets.length} presets (${skipped} skipped) from ${scenarios.length} scenarios into ${width} dims (${(report.explainedVariance * 100).toFixed(1)}% of variance) → ${outDir}`,
  );
  console.log(
    `  ${duplicated} presets are indistinguishable from another by behaviour (listed apart, not counted as neighbours)`,
  );
  console.log(
    `  family retrieval over ${retrieval.queries} presets with a distinct relative: hit@1 ${(retrieval.hitAt1 * 100).toFixed(1)}% (random ${(retrieval.randomAt1 * 100).toFixed(1)}%), hit@10 ${(retrieval.hitAt10 * 100).toFixed(1)}% (random ${(retrieval.randomAt10 * 100).toFixed(1)}%)`,
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
