# MilkDrop projectM parity plan

This document turns the current preset-fidelity gap into an implementation roadmap.

For milestone-by-milestone execution details, see [`MILKDROP_PROJECTM_PARITY_BACKLOG.md`](./MILKDROP_PROJECTM_PARITY_BACKLOG.md).

The immediate goal is not to claim broad `projectM` parity. It is to build a repeatable visual oracle, downgrade over-optimistic compatibility labels, and then close the largest rendering gaps in order of impact.

## Current state

- Upstream `projectM` fixtures are used for parser/compiler/VM compatibility coverage, not frame-by-frame render parity.
- The certified local parity corpus validates runtime summaries and selected post fields, but it does not diff rendered frames against `projectM`.
- The compiler compatibility tables are currently optimistic enough that many presets can be classified as supported while still rendering differently.

## Phase 1: build a real visual oracle

1. Capture deterministic Stims artifacts for specific preset ids.
2. Capture matching reference renders from `projectM` for the same presets, resolution, and frame window.
3. Compare images or framebuffer outputs with explicit tolerances.
4. Store visual-parity expectations separately from compiler-compatibility expectations.

### First tooling slice in this repo

Use the launcher to request a specific preset and persist debug metadata:

```bash
bun scripts/play-toy.ts milkdrop \
  --preset eos-glowsticks-v2-03-music \
  --duration 1500 \
  --debug-snapshot \
  --no-vibe-mode \
  --output ./screenshots/parity
```

This produces:

- a screenshot for the requested preset,
- a `milkdrop` agent debug snapshot JSON alongside it,
- a stable enough capture path to start building parity fixtures,
- a local `parity-artifacts.manifest.json` entry describing the capture.

Import a reference render into the same directory:

```bash
bun scripts/import-projectm-reference.ts \
  --preset eos-glowsticks-v2-03-music \
  --image /absolute/path/to/projectm-frame.png \
  --meta /absolute/path/to/projectm-frame.json \
  --output ./screenshots/parity
```

That import copies the reference files into the parity output directory and appends provenance metadata to the same manifest.

Diff the latest Stims/reference pair for a preset:

```bash
bun run parity:diff -- --output ./screenshots/parity --preset eos-glowsticks-v2-03-music
```

This writes a diff report, an optional diff PNG, and a `parity-diff` entry into the same manifest so follow-on tooling can reason about historical results.

Promote an imported `projectM` reference into the checked-in fixture corpus:

```bash
bun run parity:promote-reference -- \
  --output ./screenshots/parity \
  --preset eos-glowsticks-v2-03-music \
  --strata feedback,shader-supported
```

That flow copies the selected projectM artifact into `tests/fixtures/milkdrop/projectm-reference/` and updates `assets/data/milkdrop-parity/visual-reference-manifest.json`, which becomes the source of truth for certified visual references.

Run the certified suite against that checked-in manifest:

```bash
bun run parity:suite -- --output ./screenshots/parity --write-diff-images
```

That suite resolves the latest Stims capture per certified preset, compares it to the checked-in projectM reference image, writes per-preset reports under `./screenshots/parity/suite/`, and ranks results by worst mismatch first.

Promote an individual suite result into the checked-in measured-results manifest:

```bash
bun run parity:promote-result -- \
  --output ./screenshots/parity \
  --preset eos-glowsticks-v2-03-music
```

That step writes to `assets/data/milkdrop-parity/measured-results.json`, which is the first manifest used by runtime/catalog analysis to prefer measured visual fidelity over compiler-only inference.

Sync the shipped bundled catalog metadata from that measured-results manifest:

```bash
bun run parity:sync-catalog
```

That rewrite keeps `public/milkdrop-presets/catalog.json` aligned with measured evidence: certified presets keep their measured labels, and unmeasured bundled presets are downgraded to `partial` / `runtime` instead of shipping as visually certified.

## Phase 2: make compatibility reporting honest

1. Populate hard-unsupported feature tables instead of leaving them empty.
2. Populate backend partial-gap tables where WebGL or WebGPU are known to diverge.
3. Derive shipped fidelity labels from measured visual parity, not just successful compilation.
4. Use the allowlist only for explicitly accepted visual differences.

## Phase 3: close the biggest rendering gaps

### Feedback and video echo

- Replace heuristic composite state with projectM-matching pass ordering and math.
- Verify `video_echo_*`, feedback mix, zoom, orientation, wrap, and post effects against reference renders.
- Eliminate backend-specific shortcuts that change visible output.

### Shader text

- Expand direct warp/comp shader support.
- Reduce heuristic lowering into scalar control extraction.
- Track unsupported shader constructs as explicit compatibility failures until they are truly implemented.

### Texture and sampler semantics

- Implement fuller aux-texture coverage.
- Close `tex3D`/volume-sampler gaps rather than approximating non-volume samplers from 2D textures.
- Verify shape-texture, overlay-texture, and warp-texture behavior visually.

### Waves, shapes, and mesh rasterization

- Match draw order, blending, smoothing, borders, and texture behavior.
- Validate custom-wave and custom-shape output with visual baselines, not just object counts.
- Verify legacy aliases and instance-local behavior with render fixtures.

## Phase 4: re-qualify WebGPU

1. Prove descriptor-plan output matches the compatibility WebGL path for certified presets.
2. Keep unsupported presets on WebGL fallback until equivalence is measured.
3. Only mark WebGPU presets as exact when their output matches both the reference oracle and the WebGL path.

## Suggested implementation order

1. Deterministic capture workflow.
2. Reference render ingest and image diffing.
3. Honest compatibility reclassification.
4. Feedback/video-echo parity.
5. Shader-text parity.
6. Texture/sampler parity.
7. Wave/shape rasterization parity.
8. WebGPU re-certification.
