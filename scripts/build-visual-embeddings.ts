/**
 * Turns the EmbeddingGemma 2 preview vectors into what the app ships, plus a review report.
 *
 * Reads the raw 768-d vectors that `experiments/visual-embeddings/embed.ts`
 * writes to output/visual-embeddings/ (run that first; it needs the
 * gitignored previews and its own install) and writes:
 *
 * - public/milkdrop-presets/visual-vectors.{json,bin}: each preset's vector
 *   cut to 256 dimensions (Matryoshka; near-lossless per the model card) and
 *   quantized to int8. The client answers "looks like this preset" and
 *   "like your saved" from these with no request (preset-visual-vectors.ts).
 * - `searchTerms` on catalog entries: the visual terms in
 *   experiments/visual-embeddings/terms.ts that stand out for a preset's
 *   preview, so typing "tunnel" in Browse finds tunnels whatever the title.
 *   This script owns that field: it rewrites it on every entry.
 * - public/milkdrop-presets/visual-terms.json: the same terms as vectors, cut
 *   and quantized like the previews, so Browse can rank every preset against
 *   a typed term on the device instead of only finding the ones it tagged.
 * - output/visual-embeddings/report.md: for a human, not the app. Look-alike
 *   pairs the source-text dedup missed, source near-duplicates that render
 *   differently, the unmeasured presets that most resemble a measured
 *   flasher (an order for `lab:flash-audit`, never a label), and how much
 *   neighbour ranking the 256-d int8 cut gives up against full precision.
 *
 * Usage: bun run catalog:visual-embeddings [--report-only | --terms-only]
 *
 * `--terms-only` rewrites visual-terms.json from the term vectors alone
 * (`embed.ts --terms-only`), for a terms.ts edit made without the previews.
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;
const CACHE = path.join(repoRoot, 'output/visual-embeddings');
const CATALOG = path.join(repoRoot, 'public/milkdrop-presets/catalog.json');
const OUT_MANIFEST = path.join(
  repoRoot,
  'public/milkdrop-presets/visual-vectors.json',
);
const OUT_VECTORS = path.join(
  repoRoot,
  'public/milkdrop-presets/visual-vectors.bin',
);
const OUT_TERMS = path.join(
  repoRoot,
  'public/milkdrop-presets/visual-terms.json',
);
const OUT_REPORT = path.join(CACHE, 'report.md');

/** Shipped dimensions. The model card puts 256-d within ~1.5 points of 768-d. */
const SHIPPED_DIMS = 256;

/**
 * Previews darker or brighter than these mean luminances carry too little to
 * compare: every near-black (or blown-out white) frame embeds alike, so they
 * would all be each other's "neighbours", and the white ones were the best
 * matches for figurative terms like "face". Those presets get no vector and
 * fall back to the frame path.
 */
const MIN_PREVIEW_LUMA = 0.03;
const MAX_PREVIEW_LUMA = 0.92;

/**
 * A term tags a preset only when the preview scores this many standard
 * deviations above that term's mean across the catalog. Raw cosines are not
 * comparable between terms (each phrase sits at its own distance from every
 * image), so each term is judged against its own spread. Checked by eye on
 * contact sheets: the top few per term mostly fit, and by z 2.5 most terms
 * were tagging presets they did not describe.
 */
const TERM_MIN_Z = 3.0;
const MAX_TERMS_PER_PRESET = 3;

type ImageIndex = {
  model: string;
  revision: string;
  dtype: string;
  dims: number;
  entries: Array<{ id: string; sha256: string; meanLuma: number }>;
};
type TermIndex = {
  model: string;
  revision: string;
  dtype: string;
  dims: number;
  terms: string[];
};
type CatalogEntry = {
  id: string;
  title: string;
  searchTerms?: string[];
  similarity?: { clusterId: string; duplicateOf?: string };
  sensoryProfile?: { flashRiskLevel?: string };
};

function readF32(file: string): Float32Array {
  const buffer = fs.readFileSync(file);
  return new Float32Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  );
}

function rows(data: Float32Array, dims: number, count: number): Float32Array[] {
  return Array.from({ length: count }, (_, row) =>
    data.slice(row * dims, (row + 1) * dims),
  );
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  return vector.map((value) => value / norm);
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function topK(scores: number[], k: number, skip: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((item) => item.index !== skip)
    .sort((left, right) => right.score - left.score)
    .slice(0, k)
    .map((item) => item.index);
}

/**
 * The provenance string both shipped files carry. The client compares the two
 * and refuses a mismatch: vectors from different models or quantizations sit
 * in different spaces, and their cosines would look valid while meaning
 * nothing.
 */
function shippedModel(index: {
  model: string;
  revision: string;
  dtype: string;
}): string {
  return `${index.model}@${index.revision} ${index.dtype}, ${SHIPPED_DIMS}-d int8`;
}

/** Each term cut to the shipped dimensions, renormalized and quantized. */
function writeVisualTerms(
  termIndex: TermIndex,
  termVectors: Float32Array[],
  stats?: Array<[mean: number, invSd: number]>,
) {
  const cut = termVectors.map((vector) =>
    normalize(vector.slice(0, SHIPPED_DIMS)),
  );
  let maxAbs = 0;
  for (const vector of cut) {
    for (const value of vector) maxAbs = Math.max(maxAbs, Math.abs(value));
  }
  fs.writeFileSync(
    OUT_TERMS,
    `${JSON.stringify({
      version: 1,
      model: shippedModel(termIndex),
      dims: SHIPPED_DIMS,
      terms: termIndex.terms,
      vectors: cut.map((vector) =>
        Array.from(vector, (value) => Math.round((value / maxAbs) * 127)),
      ),
      ...(stats ? { stats } : {}),
    })}\n`,
  );
  console.log(
    `wrote ${termIndex.terms.length} term vectors to ${path.relative(repoRoot, OUT_TERMS)}`,
  );
}

function main() {
  const reportOnly = process.argv.includes('--report-only');
  const termsOnly = process.argv.includes('--terms-only');
  const termsPath = path.join(CACHE, 'terms.json');
  const imagesPath = path.join(CACHE, 'images.json');
  if (!fs.existsSync(termsPath) || (!termsOnly && !fs.existsSync(imagesPath))) {
    console.error(
      'No vectors in output/visual-embeddings. Run experiments/visual-embeddings/embed.ts first (see its README).',
    );
    process.exit(1);
  }
  const termIndex = JSON.parse(fs.readFileSync(termsPath, 'utf8')) as TermIndex;
  const termVectors = rows(
    readF32(path.join(CACHE, 'terms.f32')),
    termIndex.dims,
    termIndex.terms.length,
  );
  if (termsOnly) {
    writeVisualTerms(termIndex, termVectors);
    return;
  }
  const imageIndex = JSON.parse(
    fs.readFileSync(imagesPath, 'utf8'),
  ) as ImageIndex;
  const fullImages = rows(
    readF32(path.join(CACHE, 'images.f32')),
    imageIndex.dims,
    imageIndex.entries.length,
  );

  const catalogDoc = JSON.parse(fs.readFileSync(CATALOG, 'utf8')) as {
    presets: CatalogEntry[];
  };
  const catalogById = new Map(
    catalogDoc.presets.map((entry) => [entry.id, entry]),
  );

  // Byte-identical previews of different presets: the thumbnailer captured
  // one preset's frame for another, so the vector describes the wrong preset.
  const presetsByHash = new Map<string, string[]>();
  for (const entry of imageIndex.entries) {
    presetsByHash.set(entry.sha256, [
      ...(presetsByHash.get(entry.sha256) ?? []),
      entry.id,
    ]);
  }
  const sharedPreviews = [...presetsByHash.values()].filter(
    (ids) => ids.length > 1,
  );

  // Only presets still in the catalog, with a preview of their own that is
  // neither near-black nor blown out.
  const kept = imageIndex.entries
    .map((entry, row) => ({ ...entry, full: fullImages[row] }))
    .filter(
      (entry) =>
        catalogById.has(entry.id) &&
        (presetsByHash.get(entry.sha256)?.length ?? 0) === 1 &&
        entry.meanLuma >= MIN_PREVIEW_LUMA &&
        entry.meanLuma <= MAX_PREVIEW_LUMA,
    );
  const blankCount = imageIndex.entries.filter(
    (entry) =>
      entry.meanLuma < MIN_PREVIEW_LUMA || entry.meanLuma > MAX_PREVIEW_LUMA,
  ).length;

  // --- Shipped vectors: Matryoshka cut, renormalize, per-vector int8 --------
  // Per-vector int8 scaling gives each 256-d vector its own full [-127, 127]
  // dynamic range. Cosine similarity divides by the row's stored norm, which
  // cancels any positive scalar multiple, so per-vector scaling costs zero
  // bytes while cutting quantization loss by ~3x vs a single global max.
  const cut = kept.map((entry) => normalize(entry.full.slice(0, SHIPPED_DIMS)));
  const quantized = new Int8Array(kept.length * SHIPPED_DIMS);
  cut.forEach((vector, row) => {
    let rowMax = 0;
    for (let i = 0; i < SHIPPED_DIMS; i += 1) {
      const abs = Math.abs(vector[i]);
      if (abs > rowMax) rowMax = abs;
    }
    const scale = rowMax > 0 ? 127 / rowMax : 0;
    for (let i = 0; i < SHIPPED_DIMS; i += 1) {
      quantized[row * SHIPPED_DIMS + i] = Math.round(vector[i] * scale);
    }
  });

  // --- Visual search terms --------------------------------------------------
  // Normalized cross-modal cosine similarity: raw dot products confound
  // activation norm with semantic relevance.
  const fullNormed = kept.map((entry) => normalize(entry.full));
  const termNormed = termVectors.map(normalize);
  const termScores = termNormed.map((term) =>
    fullNormed.map((image) => dot(image, term)),
  );
  const termZ = termScores.map((scores) => {
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const sd =
      Math.sqrt(
        scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          scores.length,
      ) || 1;
    return scores.map((value) => (value - mean) / sd);
  });
  const termsFor = new Map<string, string[]>();
  kept.forEach((entry, row) => {
    const picked = termIndex.terms
      .map((term, t) => ({ term, z: termZ[t][row] }))
      .filter((item) => item.z >= TERM_MIN_Z)
      .sort((left, right) => right.z - left.z)
      .slice(0, MAX_TERMS_PER_PRESET)
      .map((item) => item.term);
    if (picked.length) termsFor.set(entry.id, picked);
  });

  // --- Report -------------------------------------------------------------
  const quantRows = kept.map((_, row) =>
    quantized.subarray(row * SHIPPED_DIMS, (row + 1) * SHIPPED_DIMS),
  );
  const quantNorms = quantRows.map((row) => Math.sqrt(dot(row, row)) || 1);
  const fullSim = (a: number, b: number) => dot(fullNormed[a], fullNormed[b]);
  const quantSim = (a: number, b: number) =>
    dot(quantRows[a], quantRows[b]) / (quantNorms[a] * quantNorms[b]);

  // How much of each preset's full-precision top 10 survives the shipped cut.
  let overlap = 0;
  const pairScores: number[] = [];
  const nearest: number[][] = [];
  for (let a = 0; a < kept.length; a += 1) {
    const full: number[] = [];
    const quant: number[] = [];
    for (let b = 0; b < kept.length; b += 1) {
      full.push(a === b ? Number.NEGATIVE_INFINITY : fullSim(a, b));
      quant.push(a === b ? Number.NEGATIVE_INFINITY : quantSim(a, b));
      if (b > a) pairScores.push(quant[b]);
    }
    const fullTop = topK(full, 10, a);
    const quantTop = topK(quant, 10, a);
    nearest.push(quantTop);
    overlap += quantTop.filter((index) => fullTop.includes(index)).length / 10;
  }
  pairScores.sort((left, right) => left - right);
  const pct = (p: number) =>
    pairScores[Math.floor(p * (pairScores.length - 1))].toFixed(3);

  const idOf = (row: number) => kept[row].id;
  const clusterOf = (row: number) =>
    catalogById.get(idOf(row))?.similarity?.clusterId;

  // Look-alikes the source-text dedup did not group.
  const lookalikeFloor = Number(pct(0.9995));
  const lookalikes: Array<[string, string, number]> = [];
  for (let a = 0; a < kept.length; a += 1) {
    for (const b of nearest[a]) {
      if (b <= a) continue;
      const score = quantSim(a, b);
      const sameCluster =
        clusterOf(a) !== undefined && clusterOf(a) === clusterOf(b);
      if (score >= lookalikeFloor && !sameCluster) {
        lookalikes.push([idOf(a), idOf(b), score]);
      }
    }
  }
  lookalikes.sort((left, right) => right[2] - left[2]);

  // Source near-duplicates whose previews look unlike each other.
  const clusters = new Map<string, number[]>();
  for (const [row, entry] of kept.entries()) {
    const clusterId = catalogById.get(entry.id)?.similarity?.clusterId;
    if (!clusterId) continue;
    clusters.set(clusterId, [...(clusters.get(clusterId) ?? []), row]);
  }
  const divergentFloor = Number(pct(0.5));
  const divergent: Array<[string, string, number]> = [];
  for (const members of clusters.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const score = quantSim(members[i], members[j]);
        if (score < divergentFloor) {
          divergent.push([idOf(members[i]), idOf(members[j]), score]);
        }
      }
    }
  }
  divergent.sort((left, right) => left[2] - right[2]);

  // Unmeasured presets ordered by resemblance to a measured flasher.
  const flashers = kept
    .map((entry, row) => ({ entry, row }))
    .filter(({ entry }) => {
      const level = catalogById.get(entry.id)?.sensoryProfile?.flashRiskLevel;
      return level === 'medium' || level === 'high';
    })
    .map(({ row }) => row);
  const auditQueue = kept
    .map((entry, row) => ({
      id: entry.id,
      measured: Boolean(catalogById.get(entry.id)?.sensoryProfile),
      score: Math.max(
        Number.NEGATIVE_INFINITY,
        ...flashers.map((flasher) => quantSim(row, flasher)),
      ),
    }))
    .filter((item) => !item.measured && Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, 50);

  const termCounts = termIndex.terms
    .map((term) => ({
      term,
      ids: [...termsFor.entries()]
        .filter(([, terms]) => terms.includes(term))
        .map(([id]) => id),
    }))
    .sort((left, right) => right.ids.length - left.ids.length);

  const report = [
    '# Visual embeddings report',
    '',
    `Model: ${imageIndex.model} @ ${imageIndex.revision} (${imageIndex.dtype}).`,
    `${kept.length} presets shipped with vectors; ${blankCount} previews outside ${MIN_PREVIEW_LUMA}–${MAX_PREVIEW_LUMA} mean luminance left out.`,
    '',
    `${sharedPreviews.reduce((sum, ids) => sum + ids.length, 0)} presets share a byte-identical preview with another preset (a thumbnailer capture bug) and were left out; they are listed at the end.`,
    '',
    '## Shipped cut',
    '',
    `${SHIPPED_DIMS}-d int8 keeps ${((overlap / kept.length) * 100).toFixed(1)}% of each preset's full-precision 768-d top-10 neighbours on average.`,
    `Pairwise cosine (shipped): p5 ${pct(0.05)}, p50 ${pct(0.5)}, p95 ${pct(0.95)}, p99 ${pct(0.99)}, max ${pct(1)}.`,
    '',
    '## Visual search terms',
    '',
    `${termsFor.size} presets tagged (z ≥ ${TERM_MIN_Z}, at most ${MAX_TERMS_PER_PRESET} each).`,
    '',
    '| Term | Presets | Examples |',
    '| --- | --- | --- |',
    ...termCounts.map(
      ({ term, ids }) =>
        `| ${term} | ${ids.length} | ${ids.slice(0, 4).join(', ')} |`,
    ),
    '',
    `## Look-alikes the source dedup missed (cosine ≥ ${lookalikeFloor.toFixed(3)}, top 0.05% of pairs)`,
    '',
    ...lookalikes
      .slice(0, 60)
      .map(([a, b, score]) => `- ${score.toFixed(3)} ${a} ↔ ${b}`),
    '',
    `## Source near-duplicates that render differently (cosine < ${divergentFloor.toFixed(3)}, the median pair)`,
    '',
    'Either the variant really changes the look, or one preview caught a bad moment.',
    '',
    ...divergent
      .slice(0, 60)
      .map(([a, b, score]) => `- ${score.toFixed(3)} ${a} ↔ ${b}`),
    '',
    `## Flash-audit order: unmeasured presets most like the ${flashers.length} measured medium/high flashers`,
    '',
    'Resemblance is not risk. This only orders what `lab:flash-audit` should measure first.',
    '',
    ...auditQueue.map((item) => `- ${item.score.toFixed(3)} ${item.id}`),
    '',
    '## Presets sharing one preview image',
    '',
    'Regenerate these previews (`bun run generate:previews`); each group shows one frame for several presets.',
    '',
    ...sharedPreviews.map((ids) => `- ${ids.join(', ')}`),
    '',
  ].join('\n');
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(OUT_REPORT, report);
  console.log(`wrote ${path.relative(repoRoot, OUT_REPORT)}`);
  if (reportOnly) return;

  fs.writeFileSync(
    OUT_MANIFEST,
    `${JSON.stringify({
      version: 1,
      model: shippedModel(imageIndex),
      dims: SHIPPED_DIMS,
      ids: kept.map((entry) => entry.id),
    })}\n`,
  );
  fs.writeFileSync(OUT_VECTORS, quantized);

  const cutTerms = termVectors.map((vector) =>
    normalize(vector.slice(0, SHIPPED_DIMS)),
  );
  let termMaxAbs = 0;
  for (const vector of cutTerms) {
    for (const value of vector) {
      termMaxAbs = Math.max(termMaxAbs, Math.abs(value));
    }
  }
  const quantizedTerms = cutTerms.map((vector) =>
    Array.from(vector, (value) => Math.round((value / termMaxAbs) * 127)),
  );
  const shippedStats: Array<[number, number]> = quantizedTerms.map(
    (termVec) => {
      let termNormSq = 0;
      for (let i = 0; i < SHIPPED_DIMS; i += 1) {
        termNormSq += termVec[i] * termVec[i];
      }
      const invTermNorm = termNormSq > 0 ? 1 / Math.sqrt(termNormSq) : 0;
      let sum = 0;
      let sumSq = 0;
      for (let r = 0; r < kept.length; r += 1) {
        const cos =
          dot(quantRows[r], termVec) / (quantNorms[r] * (1 / invTermNorm));
        sum += cos;
        sumSq += cos * cos;
      }
      const mean = sum / kept.length;
      const variance = Math.max(0, sumSq / kept.length - mean * mean);
      const invSd = variance > 0 ? 1 / Math.sqrt(variance) : 1;
      return [Number(mean.toFixed(5)), Number(invSd.toFixed(5))];
    },
  );
  writeVisualTerms(termIndex, termVectors, shippedStats);

  for (const entry of catalogDoc.presets) {
    const terms = termsFor.get(entry.id);
    if (terms) entry.searchTerms = terms;
    else delete entry.searchTerms;
  }
  fs.writeFileSync(CATALOG, `${JSON.stringify(catalogDoc, null, 2)}\n`);
  console.log(
    `wrote ${kept.length} vectors (${quantized.byteLength} bytes) and visual terms on ${termsFor.size} presets`,
  );
}

main();
