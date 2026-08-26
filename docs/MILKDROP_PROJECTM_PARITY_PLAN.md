# MilkDrop projectM parity plan

This document turns the current preset-fidelity gap into an implementation roadmap.

For milestone-by-milestone execution details, see [`MILKDROP_PROJECTM_PARITY_BACKLOG.md`](./MILKDROP_PROJECTM_PARITY_BACKLOG.md).
For how parity work fits alongside runtime, browser UX, and proof/release work, see [`MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./MILKDROP_SUCCESSOR_WORKSTREAMS.md).

The immediate goal is not to claim broad `projectM` parity. It is to build a repeatable visual oracle, downgrade over-optimistic compatibility labels, and then close the largest rendering gaps in order of impact.

Before visual parity claims, the first requirement is simpler: Stims must be able to compile and run `.milk` presets imported from the projectM ecosystem inside the browser runtime. External `projectM` captures are proof inputs for comparison, not a shipped dependency or client runtime requirement.

For upstream fixture oracle captures on macOS, use `bun run parity:capture:projectm-native -- --preset <id> --output <review-dir>`. This route validates that the safe preset ID and fixture root remain inside the repository, compiles the checked-in native harness against Homebrew `libprojectM` and SDL2, calls native `projectM::renderFrame` for the configured frame count in a hidden OpenGL context without adding another throttle, and writes a hash-bound provenance sidecar. Promotion recomputes the current upstream fixture and harness hashes; projectM/SDL/macOS/OpenGL details remain capture-host-only external provenance. The command publishes no partial image/sidecar pair when render or teardown fails. Review and repeat the output before running `parity:promote-reference`; browser/Stims screenshots and legacy `checked-in output/playwright projectM capture` files are not native projectM evidence.

The first bundled shipped presets to carry through that flow are:

- `eos-glowsticks-v2-03-music`
- `rovastar-parallel-universe`
- `eos-phat-cubetrace-v2`
- `krash-rovastar-cerebral-demons-stars`

These four IDs are the smallest evidence loop that can move the shipped catalog from inferred runtime labels to checked-in `projectM` references and measured results without expanding the corpus prematurely.

## Current state (2026-08-26)

Frame-by-frame diffing against native projectM exists and runs: `parity:capture`
walks the certified manifest on one reused browser, `parity:suite` diffs each
capture against a checked-in projectM reference, and per-preset noise bands
(`parity:noise`, stored in `src/data/milkdrop-parity/parity-noise-bands.json`)
decide whether a delta is real.

- Nine presets are certified, all judged on WebGPU. References are projectM
  3.1.12 at frame 300, rendered against per-preset audio (`silence` or the
  generated tone signal in `src/js/core/testing/reference-audio.ts`, which the
  C++ harness mirrors via a generated header).
- The capture path is deterministic: `renderFrames({ startTime: 0 })` resets
  the clock, clears the GPU feedback chain, and re-initialises the VM. Bands
  are 0.000-2.4pp on every preset; 260-compshader-noise_lq repeats exactly.
- Honest scoreboard, 3-repeat medians: 100-square 1.20% PASS, glowsticks
  1.08% PASS, 300-beatdetect 5.79%, 250-wavecode 7.36%, 260 33.72%,
  cubetrace 64.59%, 261 75.55%, rovastar-parallel-universe 82.21%,
  krash 86.29%. Two of nine pass.
- krash and glowsticks are certified via `--allow-weak-reference`: projectM
  renders both near-black under every audio condition tried, so their
  references cannot discriminate. Use butterchurn (vendored) as the oracle for
  krash; its remaining defect is the textured-shape multiply
  (`texture(prev, uv) * vertexColor`), with a secondary resolution-dependent
  feedback attractor.
- WebGL has no parity coverage. The 39 `renderer: 'stims'` manifest entries
  are placeholders with no image files.

## Measurement rules (learned the expensive way)

1. **Never trust a single capture on a preset whose band is wide.** Check
   `parity-noise-bands.json` first. To attribute a delta to a change: capture
   with it, revert, capture again — if reverting does not restore the old
   number, the delta was noise.
2. **A better score on one preset is not evidence.** Two errors cancelling
   produce beautiful numbers: defaulting `gammaadj` to 1 put 260's mean at
   exactly the reference's 127.7 while taking 100-square from 1.43% to 85.74%.
   Always re-measure 100-square (band 0.015pp) alongside any tonal change.
3. **Measure transfers, don't derive them.** The present path applies
   `out = in^(1/gammaAdj)` with gammaAdj defaulting to 2 — established by
   rendering a constant-output comp shader via
   `__STIMS_AGENT_BRIDGE__.applyEditorSource` and reading the canvas back,
   after three source-reading attempts got it wrong. projectM's
   `fGammaAdj = 1.0` init line is overwritten by the parser; do not "fix" our
   default to match it.
4. **Reference implementations tell you what to try, not what to ship.** The
   shape `a2 = 0` semantics are verifiably butterchurn's, and applying them
   alone took krash from 47% to ~90% — they are only correct together with the
   textured-shape multiply.
5. **Captures must not supersample.** The suite passes `--native-resolution`
   so frames render at capture size like the reference does. Do not get native
   resolution by locking the `full` quality step: that also drops mesh density
   and takes 100-square to 15.85%.

## Certification scope

Visual certification is proof of method on a bounded sample, not a path to full-catalog certification. The 71-preset corpus in `src/data/milkdrop-parity/certification-corpus.json` is chosen by stratum — representatives per known divergence class (feedback, shader text, samplers, rasterization, motion) plus the bundled-shipped lane — so each certified preset stands in for a class of presets, not one more data point.

The standing claim for everything outside the corpus is "compiles and runs." Unmeasured presets stay labeled `runtime`/`partial`, and the corpus grows only to cover a new divergence stratum — never to chase per-preset coverage of the 1,787-entry catalog.

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

That flow copies the selected projectM artifact into `tests/fixtures/milkdrop/projectm-reference/` and updates `src/data/milkdrop-parity/visual-reference-manifest.json`, which becomes the source of truth for certified visual references.
The bounded preset universe for that work is tracked separately in `src/data/milkdrop-parity/certification-corpus.json`, so reference images and measured results stay scoped to an explicit WebGPU certification corpus instead of open-ended imports.

For the bundled shipped presets, repeat the same capture/import/promote sequence one preset at a time and do not move to `measured-results.json` until the corresponding `projectM` reference is checked in for that same preset id.

Run the certified suite against that checked-in manifest:

```bash
bun run parity:suite -- --output ./screenshots/parity --write-diff-images
```

That suite resolves the latest Stims capture per certified preset, compares it to the checked-in projectM reference image, writes per-preset reports under `./screenshots/parity/suite/`, and ranks results by worst mismatch first.

### Two things that make a parity number a lie

**Captures must run one at a time.** `parity:capture` is serial by default and warns if `--concurrency` is raised. Parallel captures are not merely slower: Chromium instances contend for the GPU and lose their device, and the pre-capture transition settle loop burns a variable number of frames so the pump lands somewhere else in the preset's evolution. Measured over three passes of the nine certified presets, `100-square` scored 1.30/1.31/1.81% serially and 1.30/17.24/34.97% at concurrency 4, and every serial capture settled in 0 extra frames against up to 180 at concurrency 4.

**A single capture is not evidence.** Even serially, the same build scores differently run to run, because the capture runs with live audio while the projectM reference was captured under silence, and because the frame count before the deterministic pump varies. Calibrate the spread before quoting a delta:

```bash
bun run parity:noise -- --all --repeats 10 --write
```

That writes `src/data/milkdrop-parity/parity-noise-bands.json`, and `parity:suite` then judges every result against its band and the previous summary: a delta no larger than the band is reported as `no-measurable-change` rather than as an improvement or a regression. Presets differ by two orders of magnitude here — `260-compshader-noise_lq` moves by 0.02 percentage points between runs while `rovastar-parallel-universe` moves by 20 — so a 5-point "improvement" is a result on one preset and a coin flip on the other. A preset with no band gets the verdict `noise-band-unmeasured`, which is the suite refusing to pretend the delta means something.

### References that certify nothing

A reference frame that is almost entirely background cannot carry parity signal: a renderer that draws nothing already scores under the fail threshold, so the preset passes whatever happens.

```bash
bun run parity:check-references
```

That scores each certified reference against a solid-black frame using the preset's own diff threshold and reports the headroom over its fail threshold. `parity:promote-reference` runs the same check and refuses to certify a reference a blank frame would pass, unless `--allow-weak-reference` is given.

For the four bundled shipped presets, a successful suite result should be promoted only after the checked-in reference is present and the report points at the same preset id.

Promote an individual suite result into the checked-in measured-results manifest:

```bash
bun run parity:promote-result -- \
  --output ./screenshots/parity \
  --preset eos-glowsticks-v2-03-music
```

That step writes to `src/data/milkdrop-parity/measured-results.json`, which is the first manifest used by runtime/catalog analysis to prefer measured visual fidelity over compiler-only inference.

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
