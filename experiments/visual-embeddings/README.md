# Visual embeddings

Embeds every catalog preview, plus a vocabulary of visual search terms, with
[EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) through
transformers.js. Images and text share one 768-d space, so a preview can be
compared with another preview or with a word like "tunnel".

This folder has its own `package.json` on purpose. transformers.js brings
about 430 MB of ONNX runtimes, and nothing in the app build or CI needs them.

## Run

```bash
cd experiments/visual-embeddings
bun install
bun run embed.ts --previews <dir with catalog previews>
cd ../..
bun run catalog:visual-embeddings
```

- **Previews** are gitignored and live in R2. Run `bun run generate:previews`
  first, or point `--previews` at a checkout that already has them.
- **Weights** (about 510 MB, 8-bit text and vision towers) download once to
  `~/.cache/stims-visual-embeddings`. Override the location with
  `STIMS_EMBEDDING_CACHE`.
- **Device** defaults to WebGPU. On an M1 Max it measured 0.8 s per preview,
  10x faster than `--device cpu`, with identical vectors (cosine 1.0000 on a
  16-preview check). A full catalog takes about 25 minutes.
- **Reruns** embed only previews whose bytes changed, because vectors are
  cached by content hash in `output/visual-embeddings/`. The cache is
  checkpointed every 200 previews, so an interrupted run resumes.

`catalog:visual-embeddings` turns the cache into the shipped
`public/milkdrop-presets/visual-vectors.{json,bin}`, the term vectors in
`public/milkdrop-presets/visual-terms.json` that Browse ranks visual-term
searches with, and the catalog's `searchTerms`. It also writes
`output/visual-embeddings/report.md` for review. To change which words can be
tagged, edit `terms.ts` and rerun both steps; term vectors are cheap, and image
vectors come from the cache.

Without the previews, `bun run embed.ts --terms-only` followed by
`bun run catalog:visual-embeddings -- --terms-only` rewrites
`visual-terms.json` alone. New terms then rank in Browse, but `searchTerms`
tags wait for a full run.
