# MilkDrop projectM parity backlog

This backlog turns the parity roadmap into concrete milestones for the repository.

Use [`MILKDROP_PROJECTM_PARITY_PLAN.md`](./MILKDROP_PROJECTM_PARITY_PLAN.md) for the high-level direction. Use this file for implementation order, ownership boundaries, concrete file targets, and acceptance criteria.
Use [`MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./MILKDROP_SUCCESSOR_WORKSTREAMS.md) when you need to see how parity work is coordinated with runtime, product, and proof tracks.

## Operating rule

Semantic compatibility remains necessary, but it is no longer sufficient for claiming preset fidelity.

Every milestone in this backlog should move at least one preset class from:

- "compiles and renders plausibly"

to:

- "matches projectM within an explicit visual tolerance"

## Current status snapshot

Completed foundation:
- Milestones 0 through 3 are implemented in the repo: deterministic parity artifacts, checked-in certification manifests, measured-result promotion, and honest fidelity labeling are all wired.

Bundled shipped preset lane:
- The four shipped bundled IDs in `public/milkdrop-presets/catalog.json` are the first corpus to push through reference import and measured-result promotion:
  - `eos-glowsticks-v2-03-music`
  - `rovastar-parallel-universe`
  - `eos-phat-cubetrace-v2`
  - `krash-rovastar-cerebral-demons-stars`
- Each of those presets should move through the same sequence:
  - capture a Stims artifact,
  - import the matching `projectM` reference,
  - promote the reference into `tests/fixtures/milkdrop/projectm-reference/`,
  - run `bun run parity:suite`,
  - promote the suite result into `assets/data/milkdrop-parity/measured-results.json`,
  - sync `public/milkdrop-presets/catalog.json`.
- Do not treat any of the four as measured or certified in prose until both the checked-in reference and the measured suite report exist for that preset id.

Completed parity slices:
- Milestone 4 has partial completion: feedback blur/boost alignment, explicit separation of video-echo state from generic comp-shader mixing, and removal of stale blanket WebGPU fallback cases are in place.
- Milestone 6 has partial completion: unsupported `tex3D(sampler_main, ...)` and non-volume aux `tex3D(...)` paths are now downgraded instead of silently treated as full support, overlay replace mode is distinct from overlay mix mode, textured-shape sampling now wraps instead of clamping, warp textures now sample in warp-stage UV space instead of raw screen UV space, and textured custom shapes can now stay on the native WebGPU batched path when a shape texture is available instead of forcing an unconditional fallback.
- Milestone 7 has partial completion: the native WebGPU shape batcher now preserves two-color custom-shape gradients instead of flattening them to one averaged fill color, procedural custom-wave thickness survives the GPU path, WebGPU shape-outline thickness is normalized in world space instead of growing with shape radius, CPU/WebGL line-wave fallbacks now preserve explicit preset `thick` values in their line materials, and styled border accents now keep their attenuated alpha on first render instead of being promoted to full outline alpha.

Primary remaining roadmap:
1. Expand direct shader-text execution so richer `warp` and `comp` programs stop relying on scalar approximations or soft semantic-only success.
2. Close the remaining texture and sampler behavior gaps, especially overlay, warp, and shape texture semantics that still differ from `projectM`.
3. Match wave, shape, border, and mesh rasterization more closely in draw ordering, thickness, smoothing, and blend semantics.
4. Re-certify WebGPU against both checked-in `projectM` references and the Stims compatibility WebGL path before allowing stronger fidelity claims.
5. Deepen the measured certification corpus for shader-heavy, sampler-heavy, and rasterization-heavy presets.

## Milestone 0: tooling baseline

Status:
- In progress

Goal:
- Make parity artifacts deterministic, importable, and diffable.

Current repo pieces:
- [`scripts/play-toy.ts`](../scripts/play-toy.ts)
- [`scripts/import-projectm-reference.ts`](../scripts/import-projectm-reference.ts)
- [`scripts/diff-parity-artifacts.ts`](../scripts/diff-parity-artifacts.ts)
- [`scripts/parity-artifacts.ts`](../scripts/parity-artifacts.ts)

Deliverables:
- Stable Stims capture for a requested preset id
- Imported projectM reference images in the same artifact directory
- Diff report and diff image generation
- Manifest entries linking Stims captures, projectM references, and diff outputs

Exit criteria:
- A contributor can capture, import, and diff a preset with documented commands only.
- The output directory always contains a machine-readable manifest.

## Milestone 1: certified visual corpus

Goal:
- Replace ad hoc visual inspection with a small, versioned, certified preset/reference corpus.

Files to add or change:
- `assets/data/milkdrop-parity/visual-reference-manifest.json`
- `tests/fixtures/milkdrop/projectm-reference/`
- `scripts/visual-reference-manifest.ts`
- `scripts/promote-projectm-reference.ts`
- [`tests/milkdrop-parity.test.ts`](../tests/milkdrop-parity.test.ts)
- [`tests/milkdrop-projectm-compat.test.ts`](../tests/milkdrop-projectm-compat.test.ts)

Implementation tasks:
1. Define a manifest schema for reference renders.
2. Add a first certified preset set, grouped by subsystem:
   - feedback/video echo
   - shader text
   - per-pixel warp
   - custom waves
   - custom shapes
   - textured shapes and sampler-heavy presets
3. Store per-reference metadata:
   - preset id
   - reference image path
   - source commit or build identifier
   - frame time or capture timing
   - resolution
   - tolerance profile
4. Add tests that validate manifest integrity and file presence.

Acceptance criteria:
- The repo contains a checked-in certified visual corpus.
- Each certified preset has an explicit tolerance profile.
- CI can validate that the corpus metadata and referenced files are in sync.

## Milestone 2: visual diff gate

Goal:
- Make visual parity an automated test target instead of a manual audit.

Files to add or change:
- `scripts/run-parity-diff-suite.ts`
- [`scripts/run-tests.ts`](../scripts/run-tests.ts)
- `tests/milkdrop-visual-parity.test.ts`
- [`package.json`](../package.json)

Implementation tasks:
1. Add a script that resolves certified pairs and produces aggregate results.
2. Define result classes:
   - pass
   - tolerated drift
   - fail
3. Add a dedicated compat sub-profile for visual parity.
4. Emit a summary sorted by worst mismatch ratio first.
5. Support a strict mode for CI and a report mode for local investigation.

Acceptance criteria:
- `bun run test:compat` or an adjacent parity command can run certified visual checks end-to-end.
- The output ranks worst presets first with explicit metrics.
- CI can fail on visual regressions for certified presets.

## Milestone 3: honest fidelity classification

Goal:
- Stop inferring fidelity from compiler optimism and make measured visual results authoritative.

Primary files to change:
- [`assets/js/milkdrop/compiler/core.ts`](../assets/js/milkdrop/compiler/core.ts)
- [`assets/js/milkdrop/compiler/ir.ts`](../assets/js/milkdrop/compiler/ir.ts)
- [`assets/js/milkdrop/compiler/compatibility.ts`](../assets/js/milkdrop/compiler/compatibility.ts)
- [`assets/js/milkdrop/catalog-store-analysis.ts`](../assets/js/milkdrop/catalog-store-analysis.ts)
- [`public/milkdrop-presets/catalog.json`](../public/milkdrop-presets/catalog.json)

Implementation tasks:
1. Separate semantic compatibility from visual fidelity.
2. Change fidelity derivation:
   - `exact` requires measured visual pass
   - `near-exact` requires measured drift within a looser threshold
   - `fallback` covers known approximation paths or visual failures
3. Populate hard-unsupported and partial-gap tables based on measured evidence.
4. Restrict allowlist use to explicitly accepted visual gaps.

Acceptance criteria:
- No shipped preset is marked `exact` without measured visual evidence.
- Compiler-derived support no longer implies visual fidelity by itself.
- Catalog fidelity labels align with measured parity state.

## Milestone 4: feedback and video echo parity

Goal:
- Eliminate the largest visible drift source first.

Primary files to change:
- [`assets/js/milkdrop/renderer-helpers/feedback-composite.ts`](../assets/js/milkdrop/renderer-helpers/feedback-composite.ts)
- [`assets/js/milkdrop/feedback-manager-shared.ts`](../assets/js/milkdrop/feedback-manager-shared.ts)
- [`assets/js/milkdrop/feedback-manager-webgpu.ts`](../assets/js/milkdrop/feedback-manager-webgpu.ts)
- [`assets/js/milkdrop/compiler/gpu-descriptor-plan.ts`](../assets/js/milkdrop/compiler/gpu-descriptor-plan.ts)
- [`tests/milkdrop-renderer-adapter.test.ts`](../tests/milkdrop-renderer-adapter.test.ts)

Implementation tasks:
1. Remove heuristic state fusion where projectM has distinct passes.
2. Match pass ordering for:
   - feedback
   - video echo
   - warp shader
   - comp shader
   - brighten/darken/solarize/invert
   - gamma
3. Certify a feedback-heavy preset set after each change.
4. Gate WebGPU fallback more conservatively until output matches the WebGL compatibility path.

Acceptance criteria:
- Certified feedback/video-echo presets move from fail to pass or tolerated drift.
- Heuristic-only visual adjustments are either removed or justified by parity data.

## Milestone 5: shader-text parity

Status:
- In progress

Goal:
- Shrink the gap between translated controls and actual projectM shader behavior.

Primary files to change:
- [`assets/js/milkdrop/compiler/shader-analysis.ts`](../assets/js/milkdrop/compiler/shader-analysis.ts)
- [`assets/js/milkdrop/compiler/ir.ts`](../assets/js/milkdrop/compiler/ir.ts)
- [`assets/js/milkdrop/compiler/parity.ts`](../assets/js/milkdrop/compiler/parity.ts)
- [`tests/milkdrop-compiler-shader-analysis.test.ts`](../tests/milkdrop-compiler-shader-analysis.test.ts)
- [`tests/milkdrop-projectm-compat.test.ts`](../tests/milkdrop-projectm-compat.test.ts)

Implementation tasks:
1. Expand direct warp/comp shader subset support.
2. Reduce lowering into scalar control approximations.
3. Mark unsupported constructs as explicit parity failures rather than soft optimism.
4. Add shader-heavy certified presets to the visual corpus.

Current remaining focus:
- Prioritize richer direct `shader_body` / `ret` execution paths before adding more control-translation heuristics.
- Audit presets that still compile as semantically supported while carrying non-trivial approximated shader lines.
- Promote at least one shader-heavy certified preset from semantic-only success to measured visual pass after each execution-path expansion.

Acceptance criteria:
- Shader-heavy certified presets no longer pass only on semantic grounds.
- Unsupported shader constructs are visible in diagnostics and reflected in fidelity labels.

## Milestone 6: texture and sampler parity

Status:
- In progress

Goal:
- Remove known sampler approximations that visibly change output.

Primary files to change:
- [`assets/js/milkdrop/compiler/shader-analysis.ts`](../assets/js/milkdrop/compiler/shader-analysis.ts)
- [`assets/js/milkdrop/feedback-manager-shared.ts`](../assets/js/milkdrop/feedback-manager-shared.ts)
- [`assets/js/milkdrop/feedback-manager-webgpu.ts`](../assets/js/milkdrop/feedback-manager-webgpu.ts)
- [`tests/milkdrop-shader-sampler-aliases.test.ts`](../tests/milkdrop-shader-sampler-aliases.test.ts)

Implementation tasks:
1. Expand aux-texture coverage.
2. Close or explicitly downgrade non-equivalent `tex3D` and volume-sampler behavior.
3. Validate overlay texture, warp texture, and shape texture behavior visually.

Current remaining focus:
- Keep explicit downgrade behavior for any sampler path that cannot yet be shown visually equivalent to `projectM`.
- Revisit overlay, warp, and shape texture handling on both feedback managers, not just compiler-side sampler classification.
- Add measured reference coverage for sampler-heavy certified presets before relaxing any fallback logic.

Acceptance criteria:
- Sampler-heavy certified presets have measured parity coverage.
- Remaining sampler approximations are reflected as explicit fallback status.

## Milestone 7: wave, shape, and mesh rasterization parity

Status:
- In progress

Goal:
- Match what projectM actually draws, not just how many primitives Stims emits.

Primary files to change:
- [`assets/js/milkdrop/renderer-helpers/wave-renderer.ts`](../assets/js/milkdrop/renderer-helpers/wave-renderer.ts)
- [`assets/js/milkdrop/renderer-helpers/procedural-wave-renderer.ts`](../assets/js/milkdrop/renderer-helpers/procedural-wave-renderer.ts)
- [`assets/js/milkdrop/renderer-helpers/shape-renderer.ts`](../assets/js/milkdrop/renderer-helpers/shape-renderer.ts)
- [`assets/js/milkdrop/renderer-helpers/border-renderer.ts`](../assets/js/milkdrop/renderer-helpers/border-renderer.ts)
- [`assets/js/milkdrop/renderer-helpers/mesh-renderer.ts`](../assets/js/milkdrop/renderer-helpers/mesh-renderer.ts)
- [`tests/milkdrop-renderer-adapter.test.ts`](../tests/milkdrop-renderer-adapter.test.ts)

Implementation tasks:
1. Validate draw ordering, blend semantics, smoothing, borders, and thickness.
2. Expand visual certification for custom waves and custom shapes.
3. Revisit legacy aliases only when visual evidence shows mismatch.

Current remaining focus:
- Compare WebGPU and compatibility WebGL output for custom-wave, custom-shape, and border-heavy presets before changing more backend flags.
- Tighten shape-outline, border-ring, and waveform thickness behavior based on measured reference output rather than object-count parity.
- Treat remaining visible draw-order or smoothing drift as certification blockers even when the VM output is already semantically correct.

Acceptance criteria:
- Certified wave/shape presets are judged by rendered output rather than object counts alone.
- Remaining differences are explicit and measurable.

## Milestone 8: WebGPU re-certification

Status:
- Not started

Goal:
- Prevent WebGPU from claiming parity before it has earned it.

Primary files to change:
- [`assets/js/milkdrop/renderer-adapter-webgpu.ts`](../assets/js/milkdrop/renderer-adapter-webgpu.ts)
- [`assets/js/milkdrop/renderer-adapter-webgl.ts`](../assets/js/milkdrop/renderer-adapter-webgl.ts)
- [`assets/js/milkdrop/webgpu-optimization-flags.ts`](../assets/js/milkdrop/webgpu-optimization-flags.ts)
- [`tests/milkdrop-webgpu-rollout.test.ts`](../tests/milkdrop-webgpu-rollout.test.ts)

Implementation tasks:
1. Compare WebGPU output against both:
   - projectM reference output
   - Stims compatibility WebGL output
2. Disable exactness claims for WebGPU where descriptor-plan output diverges.
3. Keep fallback routing conservative until equivalence is proven.

Current remaining focus:
- Build a repeatable “projectM reference plus WebGL comparator” review loop for the certified corpus.
- Require native WebGPU capture success for certified presets; fallback to WebGL remains a certification failure.
- Gate any future WebGPU backend-capability claims on measured output, not on native execution alone.

Acceptance criteria:
- WebGPU-specific certification exists for the certified corpus.
- A preset is not `exact` on WebGPU unless it passes both comparison layers.

## Milestone 9: UI and reporting honesty

Status:
- In progress

Goal:
- Make the product surface tell the truth about what is measured and what is inferred.

Primary files to change:
- [`assets/js/milkdrop/overlay.ts`](../assets/js/milkdrop/overlay.ts)
- [`assets/js/milkdrop/overlay/inspector-panel.ts`](../assets/js/milkdrop/overlay/inspector-panel.ts)
- [`assets/js/milkdrop/overlay/preset-row.ts`](../assets/js/milkdrop/overlay/preset-row.ts)
- [`assets/js/milkdrop/catalog-store-analysis.ts`](../assets/js/milkdrop/catalog-store-analysis.ts)
- [`assets/js/milkdrop/common-types.ts`](../assets/js/milkdrop/common-types.ts)
- [`docs/MILKDROP_PRESET_RUNTIME.md`](./MILKDROP_PRESET_RUNTIME.md)

Implementation tasks:
1. Distinguish semantic support from measured visual parity in diagnostics.
2. Expose whether a fidelity label is:
   - measured against projectM
   - inferred from semantic analysis only
3. Add a preset-level pointer to diff artifacts or parity status when available.

Completed slices:
- `MilkdropVisualCertification` now carries the measured `mismatchRatio` and `failThreshold` so downstream UI can surface drift figures without re-loading the suite manifest.
- Catalog projection (`catalog-store-analysis.ts`) plumbs measured ratio/threshold from the suite manifest into each catalog entry's visual certification.
- Preset rows render a "projectM verified" badge when measured parity passes and a "Drifts from projectM (~X%)" badge when measured parity fails, with the certification reason exposed via tooltip.
- Inspector panel adds a "Measured drift" metric that shows the measured pixel-mismatch percentage for measured presets and reads "not measured" for inferred-only presets.

Current remaining focus:
- Expose a per-preset link to checked-in diff/reference artifacts (currently only the certification reason text is surfaced).
- Reflect the same measured-vs-inferred distinction in catalog rollups and exported diagnostics, not just the row + inspector.
- Once Milestones 4-8 land more measured passes, audit copy in the inspector + browse list to ensure no remaining wording implies visual parity from semantic-only success.

Acceptance criteria:
- The UI never implies visual parity when only semantic compatibility is known.
- Inspector and catalog status are aligned with the certified visual results.

## Suggested execution order

1. Milestone 1
2. Milestone 2
3. Milestone 3
4. Milestone 4
5. Milestone 5
6. Milestone 6
7. Milestone 7
8. Milestone 8
9. Milestone 9

## Definition of done

The shift away from merely semantic compatibility is complete when:

- fidelity labels are driven by measured visual evidence,
- certified presets are checked in CI against projectM references,
- compiler/runtime compatibility reports remain available as supporting diagnostics,
- and no preset is marketed as `exact` without a passing visual certification path.
