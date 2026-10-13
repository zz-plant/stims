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
 */

const MANIFEST_URL = '/milkdrop-presets/visual-vectors.json';
const VECTORS_URL = '/milkdrop-presets/visual-vectors.bin';

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

export class PresetVisualVectors {
  readonly ids: readonly string[];
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
}

let loading: Promise<PresetVisualVectors | null> | null = null;

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

/** Test seam: forget the memoized load between cases. */
export function resetPresetVisualVectors(): void {
  loading = null;
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
