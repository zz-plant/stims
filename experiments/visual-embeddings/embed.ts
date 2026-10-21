/**
 * Embeds every catalog preview, and a vocabulary of visual search terms, with
 * EmbeddingGemma 2 (onnx-community/embeddinggemma-2-ONNX, 768 dimensions).
 *
 * Images and text land in one space, so a preview can be compared with
 * another preview ("looks like") or with a phrase ("tunnel"). This writes the
 * raw vectors only; `bun run catalog:visual-embeddings` in the repo root turns
 * them into the shipped artifacts.
 *
 * Runs outside the root workspace on purpose: transformers.js brings ~430 MB
 * of ONNX runtimes that no app build or CI job needs.
 *
 *   cd experiments/visual-embeddings && bun install
 *   bun run embed.ts [--previews <dir>] [--out <dir>] [--device webgpu|cpu]
 *   bun run embed.ts --terms-only   # re-embed terms.ts alone; no previews needed
 *
 * Previews are gitignored (they live in R2); generate them with
 * `bun run generate:previews` or point --previews at a checkout that has them.
 * Vectors are cached by preview content hash, so a rerun embeds only previews
 * that changed. Node's WebGPU path matched CPU output to cosine 1.0000 on a
 * 16-preview check and ran 10x faster (0.75 s vs 7.4 s per image on an M1 Max).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AutoConfig,
  AutoModel,
  AutoProcessor,
  env,
  RawImage,
} from '@huggingface/transformers';
import sharp from 'sharp';
import { VISUAL_TERMS } from './terms.ts';

const MODEL_ID = 'onnx-community/embeddinggemma-2-ONNX';
const MODEL_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
const DTYPE = 'q8';
const DIMS = 768;
const BATCH = 8;
const CHECKPOINT_BATCHES = 25;

const repoRoot = path.resolve(import.meta.dir, '../..');

// Outside node_modules, so a reinstall does not re-download ~510 MB of weights.
env.cacheDir =
  process.env.STIMS_EMBEDDING_CACHE ??
  path.join(os.homedir(), '.cache', 'stims-visual-embeddings');

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

const previewsDir = path.resolve(
  arg('previews', path.join(repoRoot, 'public/milkdrop-presets/previews')),
);
const outDir = path.resolve(
  arg('out', path.join(repoRoot, 'output/visual-embeddings')),
);
const device = arg('device', 'webgpu') as 'webgpu' | 'cpu';

type ImageRecord = { id: string; sha256: string; meanLuma: number };
type ImageIndex = {
  model: string;
  revision: string;
  dtype: string;
  dims: number;
  entries: ImageRecord[];
};

function readCatalogIds(): string[] {
  const doc = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'public/milkdrop-presets/catalog.json'),
      'utf8',
    ),
  );
  return (doc.presets as Array<{ id: string }>).map((entry) => entry.id);
}

/** Presets whose preview the thumbnailer itself recorded as a failed render. */
function readFailedPreviewIds(catalogIds: Set<string>): Set<string> {
  const failures = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'public/milkdrop-presets/preview-failures.json'),
      'utf8',
    ),
  ) as Array<{ presetId: string }>;
  return new Set(
    failures
      .map((failure) => failure.presetId)
      .filter((id) => catalogIds.has(id)),
  );
}

function readCache(): Map<string, CachedImage> {
  const cache = new Map<string, CachedImage>();
  const indexPath = path.join(outDir, 'images.json');
  const vectorsPath = path.join(outDir, 'images.f32');
  if (!fs.existsSync(indexPath) || !fs.existsSync(vectorsPath)) return cache;
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as ImageIndex;
  if (index.model !== MODEL_ID || index.revision !== MODEL_REVISION) {
    return cache;
  }
  const buffer = fs.readFileSync(vectorsPath);
  const all = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / 4,
  );
  index.entries.forEach((record, row) => {
    cache.set(record.id, {
      record,
      vector: all.slice(row * DIMS, (row + 1) * DIMS),
    });
  });
  return cache;
}

async function meanLuma(file: string): Promise<number> {
  const { channels } = await sharp(file).removeAlpha().stats();
  const [r, g, b] = channels.map((channel) => channel.mean / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

type CachedImage = { record: ImageRecord; vector: Float32Array };

/** Writes in catalog order, so a rerun with no changes is byte-identical. */
function writeImages(ids: string[], records: Map<string, CachedImage>) {
  const ordered = ids
    .map((id) => records.get(id))
    .filter((item): item is CachedImage => item !== undefined);
  const vectors = new Float32Array(ordered.length * DIMS);
  ordered.forEach((item, row) => vectors.set(item.vector, row * DIMS));
  const index: ImageIndex = {
    model: MODEL_ID,
    revision: MODEL_REVISION,
    dtype: DTYPE,
    dims: DIMS,
    entries: ordered.map((item) => item.record),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'images.json'),
    `${JSON.stringify(index)}\n`,
  );
  fs.writeFileSync(
    path.join(outDir, 'images.f32'),
    Buffer.from(vectors.buffer),
  );
}

async function main() {
  // Term vectors are what `catalog:visual-terms` ships, and they need no
  // previews: editing terms.ts should not require the R2 preview set.
  const termsOnly = process.argv.includes('--terms-only');
  const catalogIds = termsOnly ? [] : readCatalogIds();
  const failed = readFailedPreviewIds(new Set(catalogIds));
  const ids = catalogIds.filter((id) => {
    if (failed.has(id)) return false;
    return fs.existsSync(path.join(previewsDir, `${id}.png`));
  });
  const cache = readCache();

  const todo: Array<{ id: string; file: string; sha256: string }> = [];
  const records = new Map<string, CachedImage>();
  for (const id of ids) {
    const file = path.join(previewsDir, `${id}.png`);
    const sha256 = createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
    const cached = cache.get(id);
    if (cached && cached.record.sha256 === sha256) {
      records.set(id, cached);
    } else {
      todo.push({ id, file, sha256 });
    }
  }
  console.log(
    `${ids.length} previews (${failed.size} failed renders skipped): ${records.size} cached, ${todo.length} to embed on ${device}`,
  );

  const config = await AutoConfig.from_pretrained(MODEL_ID, {
    revision: MODEL_REVISION,
  });
  // Video frames would need the vision tower too; audio is never used here.
  (config as { audio_config?: unknown }).audio_config = null;
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    revision: MODEL_REVISION,
  });
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    config,
    revision: MODEL_REVISION,
    device,
    dtype: DTYPE,
  });

  const started = performance.now();
  for (let start = 0; start < todo.length; start += BATCH) {
    const batch = todo.slice(start, start + BATCH);
    const images = await Promise.all(
      batch.map((item) => RawImage.read(item.file)),
    );
    // One list per input: a flat list would be a single input of every image.
    const inputs = await processor(
      null,
      images.map((image) => [image]),
    );
    const { sentence_embedding } = await model(inputs);
    const data = sentence_embedding.data as Float32Array;
    for (const [row, item] of batch.entries()) {
      records.set(item.id, {
        record: {
          id: item.id,
          sha256: item.sha256,
          meanLuma: await meanLuma(item.file),
        },
        vector: data.slice(row * DIMS, (row + 1) * DIMS),
      });
    }
    const done = Math.min(start + BATCH, todo.length);
    // Checkpoint, so an interrupted run resumes from the cache instead of
    // starting over (a full catalog is ~25 minutes).
    if ((start / BATCH) % CHECKPOINT_BATCHES === CHECKPOINT_BATCHES - 1) {
      writeImages(ids, records);
    }
    const perImage = (performance.now() - started) / done;
    process.stdout.write(
      `\r${done}/${todo.length} (${(perImage / 1000).toFixed(2)} s/image)`,
    );
  }
  if (todo.length) process.stdout.write('\n');

  if (!termsOnly) writeImages(ids, records);

  // Phrases are queries against images, so they take the retrieval query
  // prefix; images take none (model card, "Task Instruction Prefixes").
  const termTexts = VISUAL_TERMS.map(
    (term) => `task: search result | query: ${term.query}`,
  );
  const { sentence_embedding: termEmbedding } = await model(
    await processor(termTexts),
  );
  const termVectors = termEmbedding.data as Float32Array;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'terms.json'),
    `${JSON.stringify({
      model: MODEL_ID,
      revision: MODEL_REVISION,
      dtype: DTYPE,
      dims: DIMS,
      terms: VISUAL_TERMS.map((term) => term.term),
    })}\n`,
  );
  fs.writeFileSync(
    path.join(outDir, 'terms.f32'),
    Buffer.from(
      termVectors.buffer,
      termVectors.byteOffset,
      termVectors.byteLength,
    ),
  );
  console.log(
    termsOnly
      ? `wrote ${VISUAL_TERMS.length} term vectors to ${path.relative(repoRoot, outDir)}`
      : `wrote ${records.size} image vectors and ${VISUAL_TERMS.length} term vectors to ${path.relative(repoRoot, outDir)}`,
  );
}

await main();
