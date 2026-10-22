/**
 * What each catalog preset looks like, as a vector, answered on the device.
 *
 * `scripts/build-visual-embeddings.ts` embeds every rendered preview with
 * EmbeddingGemma 2 and ships the vectors as a static file: 256 int8 values
 * per preset. "Looks like this preset" then needs no request beyond that file,
 * and it works on the Vite dev server, which has no visual-search index.
 *
 * The bge index behind `/api/visual-search` matched 81 distinct template
 * descriptions ("dominant monochrome green, smooth gradients, moderate
 * motion") across 1,786 presets, so most of a preset's "neighbours" were ties
 * inside one bucket. These vectors are the preview's pixels, not a sentence
 * about them.
 *
 * Presets without a vector (generated, imported, or a preview the thumbnailer
 * recorded as a black frame) return null, and callers fall back to describing
 * the live frame.
 *
 * The visual search terms ("tunnel", "fire") ship as vectors in the same
 * space (visual-terms.json), so a typed term ranks every preset by how much
 * its preview looks like that word, not only the few the build tagged with it.
 */

const MANIFEST_URL = '/milkdrop-presets/visual-vectors.json';
const VECTORS_URL = '/milkdrop-presets/visual-vectors.bin';
// The build ships a gzip-compressed twin of the vectors file: the raw binary
// is application/octet-stream, which the CDN does not compress, so without
// this the browser downloads all 409 KiB. The .gz twin is 292 KiB, and
// DecompressionStream('gzip') works in every engine since 2023.
const VECTORS_GZIP_URL = `${VECTORS_URL}.gz`;
const TERMS_URL = '/milkdrop-presets/visual-terms.json';

/**
 * Upper bound on rows read from the manifest; the catalog is ~1,800. Also the
 * bound `check-cache-bounds.ts` looks for on the id→row index below.
 */
export const MAX_VISUAL_VECTOR_ROWS = 8192;

/**
 * At most this many anchors feed an affinity ranking. Saved presets are
 * unbounded in principle; the most recent ones say the most about taste now,
 * and each anchor costs a pass over the catalog.
 */
export const MAX_AFFINITY_ANCHORS = 64;

/**
 * Minimum cosine similarity for a visual match to be considered meaningful.
 * Calibrated against EmbeddingGemma 2 representations: random unrelated
 * preset pairs have a median cosine similarity around 0.80 (p90 ~0.86).
 * Pairs below 0.86 are within the random noise floor and indicate no visual
 * resemblance.
 */
export const VISUAL_MATCH_MIN_SCORE = 0.86;

export type VisualVectorManifest = {
  version: 1;
  /** Which model and revision produced the vectors, for provenance. */
  model: string;
  dims: number;
  /** Row order of the binary file. */
  ids: string[];
};

export type VisualMatch = { presetId: string; score: number };

/**
 * How far above the catalog's mean for a term (in standard deviations) a
 * preview must score to count as a match. The build tags at 3.0 against
 * full-precision vectors; on the shipped 256-d int8 cut the presets it tagged
 * score 2.5 or more (436 of 448 on the 2026-10 catalog). Below this a ranked
 * list fills with frames the term does not describe.
 */
const VISUAL_TERM_MATCH_Z = 2.5;

/**
 * True when a preset's preview matches a visual-term query strongly enough to
 * list even though no text field names the term. `visualScores` comes from
 * `scoreVisualQuery` and is empty for any other query, so this adds nothing
 * until the vectors load and never widens a text search.
 */
export function matchesVisualQuery(
  presetId: string,
  visualScores: ReadonlyMap<string, number>,
): boolean {
  return (
    (visualScores.get(presetId) ?? Number.NEGATIVE_INFINITY) >=
    VISUAL_TERM_MATCH_Z
  );
}

export type VisualTermStat =
  | [mean: number, invSd: number]
  | { mean: number; invSd: number };

export type VisualTermVocabulary = {
  version: 1;
  /** Must equal the preset manifest's model; see `scoreVisualQuery`. */
  model: string;
  dims: number;
  terms: string[];
  /** One int8 row per term, in `terms` order. */
  vectors: number[][];
  /** Precomputed catalog mean and inverse standard deviation for each term, in `terms` order. */
  stats?: Array<[mean: number, invSd: number]>;
};

function parseManifest(input: unknown): VisualVectorManifest {
  const doc = input as Partial<VisualVectorManifest> | null;
  if (
    doc?.version !== 1 ||
    typeof doc.model !== 'string' ||
    !Number.isInteger(doc.dims) ||
    (doc.dims ?? 0) <= 0 ||
    !Array.isArray(doc.ids) ||
    doc.ids.length > MAX_VISUAL_VECTOR_ROWS ||
    !doc.ids.every((id) => typeof id === 'string')
  ) {
    throw new Error('Malformed visual-vectors manifest');
  }
  return doc as VisualVectorManifest;
}

function parseTermVocabulary(input: unknown): VisualTermVocabulary {
  const doc = input as Partial<VisualTermVocabulary> | null;
  if (
    doc?.version !== 1 ||
    typeof doc.model !== 'string' ||
    !Number.isInteger(doc.dims) ||
    !Array.isArray(doc.terms) ||
    !Array.isArray(doc.vectors) ||
    doc.terms.length !== doc.vectors.length ||
    !doc.terms.every((term) => typeof term === 'string') ||
    !doc.vectors.every(
      (row) => Array.isArray(row) && row.length === doc.dims,
    ) ||
    (doc.stats !== undefined &&
      (!Array.isArray(doc.stats) ||
        doc.stats.length !== doc.terms.length ||
        !doc.stats.every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            typeof pair[0] === 'number' &&
            typeof pair[1] === 'number',
        )))
  ) {
    throw new Error('Malformed visual-terms vocabulary');
  }
  return doc as VisualTermVocabulary;
}

/**
 * The vocabulary terms a typed query consists of, or null when any part of it
 * is not one. `normalizedQuery` must already be folded the way Browse folds
 * text (lowercase words separated by single spaces). Longest term first, so
 * "black and white" is one term rather than an unknown "and" between two.
 *
 * All-or-nothing on purpose: in "geiss tunnel" the author is the point, and
 * ranking the whole catalog by tunnel-ness would bury the text match.
 */
export function visualTermsInQuery(
  normalizedQuery: string,
  terms: readonly string[],
): string[] | null {
  const words = normalizedQuery.split(' ').filter(Boolean);
  if (words.length === 0 || terms.length === 0) return null;
  const known = new Set(terms);
  const longest = Math.max(...terms.map((term) => term.split(' ').length));
  const found: string[] = [];
  let at = 0;
  while (at < words.length) {
    let span = Math.min(longest, words.length - at);
    while (span > 0 && !known.has(words.slice(at, at + span).join(' '))) {
      span -= 1;
    }
    if (span === 0) return null;
    const term = words.slice(at, at + span).join(' ');
    if (!found.includes(term)) found.push(term);
    at += span;
  }
  return found;
}

export class PresetVisualVectors {
  readonly ids: readonly string[];
  /** Provenance from the manifest; term vectors must carry the same. */
  readonly model: string;
  readonly dims: number;
  private readonly data: Int8Array;
  private readonly norms: Float32Array;
  private readonly invNorms: Float32Array;
  private readonly rowOf: Map<string, number>;
  private readonly scratchTotals: Float64Array;
  private readonly scratchCosines: Float64Array;

  constructor(manifest: VisualVectorManifest, data: Int8Array) {
    if (data.length !== manifest.ids.length * manifest.dims) {
      throw new Error(
        `visual-vectors.bin holds ${data.length} values; the manifest describes ${manifest.ids.length}×${manifest.dims}`,
      );
    }
    this.ids = manifest.ids;
    this.model = manifest.model;
    this.dims = manifest.dims;
    this.data = data;
    this.rowOf = new Map(manifest.ids.map((id, row) => [id, row]));
    this.scratchTotals = new Float64Array(manifest.ids.length);
    this.scratchCosines = new Float64Array(manifest.ids.length);
    // Quantization rounds each value, so rows are no longer unit length;
    // cosine divides by the stored norm instead of assuming 1. Precomputing
    // reciprocal norms avoids division in the similarity inner loops.
    this.norms = new Float32Array(manifest.ids.length);
    this.invNorms = new Float32Array(manifest.ids.length);
    for (let row = 0; row < manifest.ids.length; row += 1) {
      let sum = 0;
      const offset = row * this.dims;
      for (let i = 0; i < this.dims; i += 1) {
        sum += data[offset + i] * data[offset + i];
      }
      const norm = Math.sqrt(sum);
      this.norms[row] = norm || 1;
      this.invNorms[row] = norm > 0 ? 1 / norm : 0;
    }
  }

  has(presetId: string): boolean {
    return this.rowOf.has(presetId);
  }

  /**
   * The normalized Float32Array vector (in 256-d space) for a preset, or null
   * if this preset has no vector.
   */
  getVector(presetId: string): Float32Array | null {
    const row = this.rowOf.get(presetId);
    if (row === undefined) return null;
    const { data, dims, invNorms } = this;
    const offset = row * dims;
    const invNorm = invNorms[row];
    const vector = new Float32Array(dims);
    for (let i = 0; i < dims; i += 1) {
      vector[i] = data[offset + i] * invNorm;
    }
    return vector;
  }

  /**
   * Cosine similarity between two catalog rows by row index.
   */
  private rowSimilarity(rowA: number, rowB: number): number {
    const { data, dims, invNorms } = this;
    const offsetA = rowA * dims;
    const offsetB = rowB * dims;
    let dot = 0;
    for (let i = 0; i < dims; i += 1) {
      dot += data[offsetA + i] * data[offsetB + i];
    }
    return dot * (invNorms[rowA] * invNorms[rowB]);
  }

  /**
   * Cosine similarity between two catalog presets by ID, or null when either
   * preset has no vector.
   */
  similarity(aId: string, bId: string): number | null {
    const a = this.rowOf.get(aId);
    const b = this.rowOf.get(bId);
    if (a === undefined || b === undefined) return null;
    return this.rowSimilarity(a, b);
  }

  /**
   * The presets whose preview vectors are closest to an arbitrary vector
   * query (e.g. an interpolated blend, a cluster centroid, or an on-device
   * query vector), best first.
   */
  searchByVector(
    queryVector: ArrayLike<number>,
    topK: number,
    minScore = Number.NEGATIVE_INFINITY,
    excludeId?: string,
  ): VisualMatch[] {
    if (topK <= 0 || queryVector.length !== this.dims) return [];

    let qNormSum = 0;
    for (let i = 0; i < this.dims; i += 1) {
      qNormSum += queryVector[i] * queryVector[i];
    }
    const qInvNorm = qNormSum > 0 ? 1 / Math.sqrt(qNormSum) : 0;
    if (qInvNorm === 0) return [];

    const { data, dims, ids, invNorms } = this;
    const count = ids.length;
    const excludeRow =
      excludeId !== undefined ? this.rowOf.get(excludeId) : undefined;

    const matches: VisualMatch[] = [];
    let minTopScore = minScore;

    for (let r = 0; r < count; r += 1) {
      if (r === excludeRow) continue;
      const offset = r * dims;
      let dot = 0;
      for (let i = 0; i < dims; i += 1) {
        dot += data[offset + i] * queryVector[i];
      }
      const score = dot * (qInvNorm * invNorms[r]);
      if (score < minTopScore) continue;

      if (matches.length < topK) {
        matches.push({ presetId: ids[r], score });
        if (matches.length === topK) {
          matches.sort((left, right) => right.score - left.score);
          minTopScore = Math.max(minScore, matches[topK - 1].score);
        }
      } else {
        let i = topK - 1;
        while (i > 0 && matches[i - 1].score < score) {
          matches[i] = matches[i - 1];
          i -= 1;
        }
        matches[i] = { presetId: ids[r], score };
        minTopScore = Math.max(minScore, matches[topK - 1].score);
      }
    }

    if (matches.length < topK) {
      matches.sort((left, right) => right.score - left.score);
    }
    return matches;
  }

  /**
   * The normalized centroid or weighted blend vector of multiple presets in
   * visual space, or null if none of the specified presets have vectors.
   */
  blend(
    presetIds: readonly string[],
    weights?: readonly number[],
  ): Float32Array | null {
    const rows: number[] = [];
    const validWeights: number[] = [];
    for (let i = 0; i < presetIds.length; i += 1) {
      const row = this.rowOf.get(presetIds[i]);
      if (row !== undefined) {
        rows.push(row);
        validWeights.push(weights?.[i] ?? 1);
      }
    }
    if (rows.length === 0) return null;

    const { data, dims, invNorms } = this;
    const blended = new Float32Array(dims);
    let totalWeight = 0;

    for (let j = 0; j < rows.length; j += 1) {
      const r = rows[j];
      const w = validWeights[j];
      if (w <= 0) continue;
      const offset = r * dims;
      const factor = w * invNorms[r];
      totalWeight += w;
      for (let i = 0; i < dims; i += 1) {
        blended[i] += data[offset + i] * factor;
      }
    }
    if (totalWeight === 0) return null;

    let sumSq = 0;
    for (let i = 0; i < dims; i += 1) {
      sumSq += blended[i] * blended[i];
    }
    const invLen = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0;
    if (invLen === 0) return null;

    for (let i = 0; i < dims; i += 1) {
      blended[i] *= invLen;
    }
    return blended;
  }

  /**
   * Visually similar presets chosen with Maximal Marginal Relevance (MMR)
   * to balance similarity to `presetId` against visual diversity among the
   * results, avoiding clusters of slight near-duplicate variations.
   *
   * @param lambda 1.0 = pure nearest neighbors, 0.0 = maximal diversity. Defaults to 0.7.
   */
  diverseNeighbours(
    presetId: string,
    topK: number,
    lambda = 0.7,
    minScore = VISUAL_MATCH_MIN_SCORE,
  ): VisualMatch[] | null {
    if (!this.has(presetId)) return null;
    if (topK <= 0) return [];

    const candidates = this.neighbours(presetId, topK * 4, minScore);
    if (!candidates || candidates.length === 0) return [];

    const selected: VisualMatch[] = [];
    const pool = [...candidates];
    const poolRows = pool.map((cand) => this.rowOf.get(cand.presetId) ?? -1);
    const selectedRows: number[] = [];
    const clampedLambda = Math.max(0, Math.min(1, lambda));

    while (selected.length < topK && pool.length > 0) {
      let bestIndex = -1;
      let bestMmr = Number.NEGATIVE_INFINITY;

      for (let i = 0; i < pool.length; i += 1) {
        const cand = pool[i];
        const candRow = poolRows[i];
        let maxSimToSelected = 0;
        for (let s = 0; s < selected.length; s += 1) {
          const selRow = selectedRows[s];
          const sim =
            candRow >= 0 && selRow >= 0
              ? this.rowSimilarity(candRow, selRow)
              : (this.similarity(cand.presetId, selected[s].presetId) ?? 0);
          if (sim > maxSimToSelected) maxSimToSelected = sim;
        }

        const mmrScore =
          clampedLambda * cand.score - (1 - clampedLambda) * maxSimToSelected;
        if (mmrScore > bestMmr) {
          bestMmr = mmrScore;
          bestIndex = i;
        }
      }

      if (bestIndex === -1) break;
      selected.push(pool[bestIndex]);
      selectedRows.push(poolRows[bestIndex]);
      pool.splice(bestIndex, 1);
      poolRows.splice(bestIndex, 1);
    }

    return selected;
  }

  /**
   * The presets whose previews look most like this one, best first, or null
   * when this preset has no vector.
   *
   * Maintains a bounded top-K list to avoid allocating 1,600+ objects and
   * sorting the full catalog on every lookup.
   */
  neighbours(
    presetId: string,
    topK: number,
    minScore = Number.NEGATIVE_INFINITY,
  ): VisualMatch[] | null {
    const row = this.rowOf.get(presetId);
    if (row === undefined) return null;
    if (topK <= 0) return [];

    const { data, dims, ids, invNorms } = this;
    const offsetRow = row * dims;
    const invNormRow = invNorms[row];
    const count = ids.length;

    const matches: VisualMatch[] = [];
    let minTopScore = minScore;

    for (let other = 0; other < count; other += 1) {
      if (other === row) continue;
      const offsetOther = other * dims;
      let dot = 0;
      for (let i = 0; i < dims; i += 1) {
        dot += data[offsetRow + i] * data[offsetOther + i];
      }
      const score = dot * (invNormRow * invNorms[other]);
      if (score < minTopScore) continue;

      if (matches.length < topK) {
        matches.push({ presetId: ids[other], score });
        if (matches.length === topK) {
          matches.sort((left, right) => right.score - left.score);
          minTopScore = Math.max(minScore, matches[topK - 1].score);
        }
      } else {
        let i = topK - 1;
        while (i > 0 && matches[i - 1].score < score) {
          matches[i] = matches[i - 1];
          i -= 1;
        }
        matches[i] = { presetId: ids[other], score };
        minTopScore = Math.max(minScore, matches[topK - 1].score);
      }
    }

    if (matches.length < topK) {
      matches.sort((left, right) => right.score - left.score);
    }
    return matches;
  }

  /**
   * For every preset with a vector, its similarity to the closest anchor.
   *
   * The closest anchor rather than the mean of all of them: someone who saved
   * both fire tunnels and pastel lattices wants more of each, and the average
   * of those two looks like neither.
   */
  affinity(anchorIds: readonly string[]): Map<string, number> {
    const anchors = anchorIds
      .slice(0, MAX_AFFINITY_ANCHORS)
      .map((id) => this.rowOf.get(id))
      .filter((row): row is number => row !== undefined);
    const scores = new Map<string, number>();
    if (anchors.length === 0) return scores;

    const { data, dims, ids, invNorms } = this;
    const count = ids.length;
    const numAnchors = anchors.length;
    const anchorOffsets = new Int32Array(numAnchors);
    const anchorInvs = new Float32Array(numAnchors);
    for (let a = 0; a < numAnchors; a += 1) {
      anchorOffsets[a] = anchors[a] * dims;
      anchorInvs[a] = invNorms[anchors[a]];
    }

    for (let row = 0; row < count; row += 1) {
      const offsetRow = row * dims;
      const invNormRow = invNorms[row];
      let best = Number.NEGATIVE_INFINITY;
      for (let a = 0; a < numAnchors; a += 1) {
        const offsetAnchor = anchorOffsets[a];
        let dot = 0;
        for (let i = 0; i < dims; i += 1) {
          dot += data[offsetRow + i] * data[offsetAnchor + i];
        }
        const score = dot * (invNormRow * anchorInvs[a]);
        if (score > best) best = score;
      }
      scores.set(ids[row], best);
    }
    return scores;
  }

  /**
   * For every preset with a vector, how strongly its preview matches the
   * given term vectors: per term, the cosine in standard deviations above the
   * catalog's mean for that term, then the mean across terms.
   *
   * Raw cosines are not comparable between terms (each phrase sits at its own
   * distance from every image), which is why the build tags by z-score too.
   * The mean is what lets "blue tunnel" rank presets that are both above
   * presets that are only very much one.
   */
  /**
   * For every preset with a vector, how strongly its preview matches the
   * given term vectors: per term, the cosine in standard deviations above the
   * catalog's mean for that term, then the mean across terms.
   *
   * Raw cosines are not comparable between terms (each phrase sits at its own
   * distance from every image), which is why the build tags by z-score too.
   * The mean is what lets "blue tunnel" rank presets that are both above
   * presets that are only very much one.
   *
   * When optional precomputed `termStats` (`[mean, invSd]` or `{ mean, invSd }`)
   * are provided (e.g. from `visual-terms.json`), scores are accumulated in a
   * single pass of dot products without variance calculations.
   */
  termScores(
    termVectors: ReadonlyArray<ArrayLike<number>>,
    termStats?: ReadonlyArray<VisualTermStat | undefined | null>,
  ): Map<string, number> {
    const { data, dims, ids, invNorms, scratchTotals, scratchCosines } = this;
    const scores = new Map<string, number>();
    const count = ids.length;
    if (count < 2) return scores;

    type UsableTerm = {
      vector: ArrayLike<number>;
      stat?: { mean: number; invSd: number };
    };
    const usable: UsableTerm[] = [];
    for (let i = 0; i < termVectors.length; i += 1) {
      const vec = termVectors[i];
      if (vec.length !== dims) continue;
      const rawStat = termStats?.[i];
      let stat: { mean: number; invSd: number } | undefined;
      if (Array.isArray(rawStat) && rawStat.length === 2) {
        stat = { mean: rawStat[0], invSd: rawStat[1] };
      } else if (
        rawStat &&
        typeof rawStat === 'object' &&
        'mean' in rawStat &&
        'invSd' in rawStat
      ) {
        stat = { mean: rawStat.mean, invSd: rawStat.invSd };
      }
      usable.push({ vector: vec, stat });
    }
    if (usable.length === 0) return scores;

    scratchTotals.fill(0);

    for (let u = 0; u < usable.length; u += 1) {
      const { vector, stat } = usable[u];
      let termNormSq = 0;
      for (let i = 0; i < dims; i += 1) termNormSq += vector[i] * vector[i];
      const invTermNorm = termNormSq > 0 ? 1 / Math.sqrt(termNormSq) : 0;

      if (stat) {
        const { mean, invSd } = stat;
        for (let row = 0; row < count; row += 1) {
          const offset = row * dims;
          let dot = 0;
          for (let i = 0; i < dims; i += 1) {
            dot += data[offset + i] * vector[i];
          }
          const cos = dot * (invNorms[row] * invTermNorm);
          scratchTotals[row] += (cos - mean) * invSd;
        }
      } else {
        let sum = 0;
        let sumSq = 0;
        for (let row = 0; row < count; row += 1) {
          const offset = row * dims;
          let dot = 0;
          for (let i = 0; i < dims; i += 1) {
            dot += data[offset + i] * vector[i];
          }
          const cos = dot * (invNorms[row] * invTermNorm);
          scratchCosines[row] = cos;
          sum += cos;
          sumSq += cos * cos;
        }
        const mean = sum / count;
        const variance = Math.max(0, sumSq / count - mean * mean);
        const invSd = variance > 0 ? 1 / Math.sqrt(variance) : 1;

        for (let row = 0; row < count; row += 1) {
          scratchTotals[row] += (scratchCosines[row] - mean) * invSd;
        }
      }
    }

    const invUsable = 1 / usable.length;
    for (let row = 0; row < count; row += 1) {
      scores.set(ids[row], scratchTotals[row] * invUsable);
    }
    return scores;
  }
}

let loading: Promise<PresetVisualVectors | null> | null = null;
let loadingTerms: Promise<VisualTermVocabulary | null> | null = null;

function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer]).stream().pipeThrough(
    // DecompressionStream accepts 'gzip' in every engine that has the API at
    // all; the fallback below covers engines without it.
    new DecompressionStream('gzip'),
  );
  return new Response(stream).arrayBuffer();
}

/**
 * Fetches the vector payload, preferring the gzip-compressed twin and
 * falling back to the raw file when the twin is missing or cannot be
 * decompressed locally.
 */
async function fetchVectorsData(): Promise<Int8Array> {
  if (typeof DecompressionStream === 'function') {
    try {
      const response = await fetch(VECTORS_GZIP_URL);
      if (response.ok) {
        return new Int8Array(await gunzip(await response.arrayBuffer()));
      }
    } catch {
      // Fall through to the raw file: a partial or corrupt .gz must not take
      // the whole feature down when the uncompressed twin is right there.
    }
  }
  const response = await fetch(VECTORS_URL);
  if (!response.ok) {
    throw new Error(`${VECTORS_URL} responded ${response.status}`);
  }
  return new Int8Array(await response.arrayBuffer());
}

/**
 * The shipped vectors, fetched once per page. Resolves null when the files
 * are missing or malformed so callers fall back rather than fail; a failed
 * fetch is not memoized, so the next call retries.
 */
export function loadPresetVisualVectors(): Promise<PresetVisualVectors | null> {
  loading ??= (async () => {
    try {
      const [manifestResponse, data] = await Promise.all([
        fetch(MANIFEST_URL),
        fetchVectorsData(),
      ]);
      if (!manifestResponse.ok) {
        loading = null;
        return null;
      }
      const manifest = parseManifest(await manifestResponse.json());
      return new PresetVisualVectors(manifest, data);
    } catch (error) {
      console.debug('Preset visual vectors unavailable', error);
      loading = null;
      return null;
    }
  })();
  return loading;
}

/**
 * The shipped term vocabulary, fetched once per page. Same contract as
 * `loadPresetVisualVectors`: null on a missing or malformed file, and a
 * failure is not memoized.
 */
export function loadVisualTermVocabulary(): Promise<VisualTermVocabulary | null> {
  loadingTerms ??= (async () => {
    try {
      const response = await fetch(TERMS_URL);
      if (!response.ok) {
        loadingTerms = null;
        return null;
      }
      return parseTermVocabulary(await response.json());
    } catch (error) {
      console.debug('Visual term vocabulary unavailable', error);
      loadingTerms = null;
      return null;
    }
  })();
  return loadingTerms;
}

/** Test seam: forget the memoized loads between cases. */
export function resetPresetVisualVectors(): void {
  loading = null;
  loadingTerms = null;
}

/**
 * Per-preset match strength for a query made only of visual terms (see
 * `visualTermsInQuery`). Empty when it is not one, when either file is
 * missing, or when the two files come from different models.
 *
 * The term vocabulary is small (about 20 KB gzip) and fetched on the first
 * search; the preset vectors only once a query turns out to be all visual
 * terms.
 */
export async function scoreVisualQuery(
  normalizedQuery: string,
): Promise<Map<string, number>> {
  const vocabulary = await loadVisualTermVocabulary();
  if (!vocabulary) return new Map();
  const terms = visualTermsInQuery(normalizedQuery, vocabulary.terms);
  if (!terms) return new Map();
  const vectors = await loadPresetVisualVectors();
  if (!vectors || vectors.model !== vocabulary.model) return new Map();
  const indices = terms.map((term) => vocabulary.terms.indexOf(term));
  return vectors.termScores(
    indices.map((idx) => vocabulary.vectors[idx]),
    indices.map((idx) => vocabulary.stats?.[idx]),
  );
}

/**
 * The presets that look most like `presetId`, or null when there is no vector
 * for it (or no vector file at all) and the caller should describe the frame.
 */
export async function searchByPresetLook(
  presetId: string,
  topK: number,
  minScore = Number.NEGATIVE_INFINITY,
  options?: { diverse?: boolean; lambda?: number },
): Promise<VisualMatch[] | null> {
  const vectors = await loadPresetVisualVectors();
  if (!vectors) return null;
  return options?.diverse
    ? vectors.diverseNeighbours(presetId, topK, options.lambda, minScore)
    : vectors.neighbours(presetId, topK, minScore);
}
