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

export type VisualTermVocabulary = {
  version: 1;
  /** Must equal the preset manifest's model; see `scoreVisualQuery`. */
  model: string;
  dims: number;
  terms: string[];
  /** One int8 row per term, in `terms` order. */
  vectors: number[][];
};

function parseManifest(input: unknown): VisualVectorManifest {
  const doc = input as Partial<VisualVectorManifest> | null;
  if (
    !doc ||
    doc.version !== 1 ||
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
    !doc ||
    doc.version !== 1 ||
    typeof doc.model !== 'string' ||
    !Number.isInteger(doc.dims) ||
    !Array.isArray(doc.terms) ||
    !Array.isArray(doc.vectors) ||
    doc.terms.length !== doc.vectors.length ||
    !doc.terms.every((term) => typeof term === 'string') ||
    !doc.vectors.every((row) => Array.isArray(row) && row.length === doc.dims)
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
  private readonly rowOf: Map<string, number>;

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
    // Quantization rounds each value, so rows are no longer unit length;
    // cosine divides by the stored norm instead of assuming 1.
    this.norms = new Float32Array(manifest.ids.length);
    for (let row = 0; row < manifest.ids.length; row += 1) {
      let sum = 0;
      const offset = row * this.dims;
      for (let i = 0; i < this.dims; i += 1) {
        sum += data[offset + i] * data[offset + i];
      }
      this.norms[row] = Math.sqrt(sum) || 1;
    }
  }

  has(presetId: string): boolean {
    return this.rowOf.has(presetId);
  }

  private cosine(a: number, b: number): number {
    const { data, dims } = this;
    const offsetA = a * dims;
    const offsetB = b * dims;
    let dot = 0;
    for (let i = 0; i < dims; i += 1) {
      dot += data[offsetA + i] * data[offsetB + i];
    }
    return dot / (this.norms[a] * this.norms[b]);
  }

  /**
   * The presets whose previews look most like this one, best first, or null
   * when this preset has no vector.
   */
  neighbours(presetId: string, topK: number): VisualMatch[] | null {
    const row = this.rowOf.get(presetId);
    if (row === undefined) return null;
    const matches: VisualMatch[] = [];
    for (let other = 0; other < this.ids.length; other += 1) {
      if (other === row) continue;
      matches.push({
        presetId: this.ids[other],
        score: this.cosine(row, other),
      });
    }
    matches.sort((left, right) => right.score - left.score);
    return matches.slice(0, Math.max(0, topK));
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
    for (let row = 0; row < this.ids.length; row += 1) {
      let best = Number.NEGATIVE_INFINITY;
      for (const anchor of anchors) {
        const score = this.cosine(row, anchor);
        if (score > best) best = score;
      }
      scores.set(this.ids[row], best);
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
  termScores(
    termVectors: ReadonlyArray<ArrayLike<number>>,
  ): Map<string, number> {
    const { data, dims, ids, norms } = this;
    const scores = new Map<string, number>();
    const usable = termVectors.filter((vector) => vector.length === dims);
    if (usable.length === 0 || ids.length < 2) return scores;
    const totals = new Float64Array(ids.length);
    const cosines = new Float64Array(ids.length);
    for (const vector of usable) {
      let termNorm = 0;
      for (let i = 0; i < dims; i += 1) termNorm += vector[i] * vector[i];
      termNorm = Math.sqrt(termNorm) || 1;
      let mean = 0;
      for (let row = 0; row < ids.length; row += 1) {
        const offset = row * dims;
        let dot = 0;
        for (let i = 0; i < dims; i += 1) dot += data[offset + i] * vector[i];
        cosines[row] = dot / (norms[row] * termNorm);
        mean += cosines[row];
      }
      mean /= ids.length;
      let variance = 0;
      for (let row = 0; row < ids.length; row += 1) {
        variance += (cosines[row] - mean) ** 2;
      }
      const sd = Math.sqrt(variance / ids.length) || 1;
      for (let row = 0; row < ids.length; row += 1) {
        totals[row] += (cosines[row] - mean) / sd;
      }
    }
    for (let row = 0; row < ids.length; row += 1) {
      scores.set(ids[row], totals[row] / usable.length);
    }
    return scores;
  }
}

let loading: Promise<PresetVisualVectors | null> | null = null;
let loadingTerms: Promise<VisualTermVocabulary | null> | null = null;

/**
 * The shipped vectors, fetched once per page. Resolves null when the files
 * are missing or malformed so callers fall back rather than fail; a failed
 * fetch is not memoized, so the next call retries.
 */
export function loadPresetVisualVectors(): Promise<PresetVisualVectors | null> {
  loading ??= (async () => {
    try {
      const [manifestResponse, vectorsResponse] = await Promise.all([
        fetch(MANIFEST_URL),
        fetch(VECTORS_URL),
      ]);
      if (!manifestResponse.ok || !vectorsResponse.ok) {
        loading = null;
        return null;
      }
      const manifest = parseManifest(await manifestResponse.json());
      const data = new Int8Array(await vectorsResponse.arrayBuffer());
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
  return vectors.termScores(
    terms.map((term) => vocabulary.vectors[vocabulary.terms.indexOf(term)]),
  );
}

/**
 * The presets that look most like `presetId`, or null when there is no vector
 * for it (or no vector file at all) and the caller should describe the frame.
 */
export async function searchByPresetLook(
  presetId: string,
  topK: number,
): Promise<VisualMatch[] | null> {
  const vectors = await loadPresetVisualVectors();
  return vectors?.neighbours(presetId, topK) ?? null;
}
