# Stims product and engineering roadmap

Stims is building a browser-native studio around audio-reactive, MilkDrop-inspired presets. The roadmap prioritizes user-visible workflow improvements and measurable compatibility before speculative rendering or hardware breadth.

## Product principles

1. **Fidelity before parity claims.** Loading and compiling a preset is not proof that it looks correct.
2. **Workflow before technology badges.** WebGPU matters when it improves a measured user outcome; it is not a product promise by itself.
3. **One coherent studio.** Discovery, playback, editing, inspection, and recording should share one session.
4. **Foundations are not features.** A service class, reserved signal, or API route is not shipped until it is connected, usable, and verified.
5. **Direct formats and portable state.** Preserve `.milk` authoring and shareable session URLs rather than hiding the source format.

## Current baseline

- Searchable imported preset catalog with previews, collections, favorites, queues, history, and deep links.
- Direct `.milk` import/export and a live CodeMirror authoring environment.
- WebGL2 compatibility baseline plus a guarded WebGPU execution path. Measured visual evidence is currently captured on the WebGPU path (the reference-capture backend); WebGL2 — the baseline most users actually run — lacks the same measured evidence and is tracked as a gap, not claimed.
- Multi-source browser audio with off-main-thread analysis.
- Browser canvas recording beta.
- Native projectM reference capture, provenance, image-diff, and result-promotion tooling.

See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) for file-level status and [`TECHNICAL_ACHIEVEMENTS.md`](./TECHNICAL_ACHIEVEMENTS.md) for evidence boundaries.

## Now: studio loop first, proof loop as a maintained floor

The proof loop below is a floor, not a frontier: it stays green and does not grow. New evidence infrastructure ships only when a studio workflow needs it. The immediate work is the studio loop — browse → edit → compare → save → share → record.

### Remix studio

- Add dependable undo/redo and named snapshots.
- Provide side-by-side or rapid A/B comparison against the source preset.
- Record remix provenance and retain source in exported `.milk` files or companion metadata.
- Make generated or assisted edits inspectable as source diffs before application.
- Add a share format that preserves the preset or a stable community identifier without requiring an account for local work.

Exit criteria:

- browse → edit → compare → save → share works without leaving the running session.

### Creator-grade export

- Harden the native renderer-resize and active-audio composition paths now implemented for recording.
- Add deterministic frame pacing and loop-duration controls.
- Verify codec, aspect-ratio, duration, and frame-count output in browser-backed tests.
- Keep the existing `MediaRecorder` path as a clearly labeled compatibility fallback.

Exit criteria:

- "1080p" and "4K" describe measured render output rather than canvas container dimensions; and
- exported audio-video files remain synchronized over a documented test duration.

### Make the large catalog useful

- Improve preview reliability and cold-load behavior.
- Rank by visual quality, evidence, performance, author, mood, and session relevance instead of relying on preset count.
- Make queue, favorites, recent history, and shareable filtered views coherent on desktop and mobile.
- Treat semantic and audio-profile matching as optional enhancements, never as blockers for local search.

Exit criteria:

- a first-time user can find a strong preset without understanding MilkDrop naming conventions; and
- low-confidence or expensive presets do not dominate default recommendations.

### Proof floor — maintained, not expanded

- Keep the checked-in reference and diff loop green for the bundled proof presets.
- Fix renderer behavior by subsystem when measured evidence regresses: feedback orientation, shader sampling, color presentation, shapes, waves, and motion vectors.
- Promote results only after the requested backend and reference provenance are verified.
- Surface clear visual-evidence and fallback labels in the browsing and inspector workflows.

Exit criteria:

- every featured preset has current measured evidence;
- public compatibility wording is generated or guarded against tracked sources of truth; and
- unsupported or fallback behavior is visible rather than silent.

### Flash-safety measurement

The bundled preset corpus was imported from the community without any photosensitive-seizure safety review. A real WCAG 2.3.1-grounded measurement tool now exists (`scripts/flash-analysis.ts` + `scripts/analyze-preset-flash.ts`, unit-tested, corpus-sampling built in) alongside the earlier placeholder-threshold tool (`bun run lab:flash-risk`). Sample runs report zero presets over threshold, and that zero has since been *explained* rather than left ambiguous: stage-by-stage measurement on rendered output confirmed capture sees full-amplitude change, the area floor is genuinely crossed (26.8–29.7% of a 10° window), and what stops a flash registering is directional incoherence — ~14% of the field brightening while ~13% darkens in the same frame. MilkDrop's texture-in-motion aesthetic does not produce the coherent field-wide oscillation WCAG's general flash threshold describes. The WCAG red-flash criterion is now implemented and unit-tested (`flash-analysis.ts`), but not yet run at corpus scale. One gate remains before this is a safety claim: every measurement used the synthetic preview waveform rather than real high-energy audio. See [`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md#layer-0--safety-first-sample-run-complete).

Exit criteria:

- the audit tool's apparent resource-exhaustion pattern (timeouts clustering late in a long run) is fixed and a full-corpus run completes without a large unmeasured tail;
- a corpus test in `tests/corpus/` continuously enforces the threshold, not just regression-tests the tool's report shape; and
- a default-on flash-rate cap ships as a visible safety control, not a buried setting.

## Next: compatibility depth & runtime compiler milestones

These deepen the compatibility lane and compiler runtime. Each item names the measurement it moves; where a count appears, it is the one the cited test or data file reports today.

### Dual-backend differential evidence (Closing the WebGL2 gap)

- Extend the parity diff harness (`scripts/run-parity-diff-suite.ts`) to capture and grade WebGL2 frame captures alongside WebGPU, which is currently the only judged backend.
- Grade both backends against the same contract the suite already uses: mismatch below the preset's configured `failThreshold` (`0.02` in `visual-reference-manifest.json`), outside its measured noise band, and against a reference a blank frame would not also pass.
- Eliminate the unmeasured status of the WebGL2 baseline so that fidelity claims reflect the renderer the majority of web users run.

Exit criteria:
- Every certified preset in `src/data/milkdrop-parity/visual-reference-manifest.json` possesses matching measured diff reports for both `webgpu` and `webgl` backends; and
- zero silent divergence between WebGL2 GLSL 300 es and WebGPU WGSL shader lowering.

### Close the 169-preset WebGPU shader-translation gap

Measured by `tests/corpus/butterchurn-corpus-support.test.ts` on the bundled corpus (2026-09-02): 1,577 presets are fully supported on both backends, 169 execute their shader programs directly on WebGL but fall back to extracted scalar controls on WebGPU, and 8 reference EEL identifiers the expression VM evaluates to `0`. (Was 226 / 1,521 before `mat2` element writes were let through to the WebGPU node executor, which already ran them.)

- ~~Resolve the packed feedback composite sampler (`sampler_fc_main` and `sampler_fw_main`) binding on WebGPU.~~ Done: both resolve to real bindings (`warpTex` / `currentTex`) end to end, covered by `tests/unit/milkdrop-shader-sampler-aliases.test.ts`. None of the remaining 169 is attributable to sampler binding.
- Lower volumetric noise (`sampler_noisevol_lq`) directly to 3D texture bindings in WebGPU, replacing the simplex-atlas approximation that both backends use today.
- Give the WebGPU node executor (`src/js/milkdrop/feedback-manager-webgpu-tsl.ts`) a `mat3`/`mat4` representation. `mat2` is packed as a vec4 and executes; 20 presets still fall back because they write a `mat3` element (19 of them also branch, so the desugar is needed too).
- Close the WebGPU executor gaps that keep the `shaderBranchDesugar` rewrite (169 → 50) behind a flag: the GPU-process crash is fixed; six presets still render white or black under the flag (named in `src/js/milkdrop/compiler/shader-branch-desugar.ts`).

Exit criteria:
- `tests/corpus/butterchurn-corpus-support.test.ts` reports 0 presets falling back to extracted scalar controls on the WebGPU path, with `fullySupported` at the full corpus count.

### Vectorized GPU compute offloading for waveforms & geometry

- Offload per-point custom wavecode generation ($4 \text{ waves} \times 512 \text{ points} = 2,048 \text{ evaluations/frame}$) from CPU JavaScript JIT to WebGPU compute storage buffers.
- Implement AST SIMD/vec4 vectorization in the WGSL generator for per-vertex grid transformations.
- Eliminate remaining main-thread CPU spikes, building on the 16.5% frame work reduction ($3.43 \text{ ms} \rightarrow 2.87 \text{ ms}$ at 1× and $17.56 \text{ ms} \rightarrow 15.31 \text{ ms}$ at 4× CPU throttle).

Exit criteria:
- Median frame work under 4× CPU throttle remains under $12.0 \text{ ms}$ on standard $1280 \times 720$ benchmarks.

### Chaotic attractor numerical stabilization (Long-duration determinism)

- Implement compiler-level compensated summation (Kahan / Neumaier algorithm) in EEL2 accumulator lowering to mitigate $f32$ floating-point precision drift in recursive non-linear equations.
- Prevent spatial deformation divergence in chaotic attractors (e.g. Lorenz loops) during long-duration playback ($t > 300\text{ s}$) for venue, kiosk, and live-coding performances.

Exit criteria:
- Frame drift test suite passes on 10-minute continuous execution benchmark against native $f64$ baseline.

### Deterministic creator-grade export via headless compute

- Connect the headless browser rendering engine and WebCodecs (`VideoEncoder` + `OffscreenCanvas`) to the studio export panel.
- Enable frame-exact, non-realtime 4K 60fps video and audio multiplexing without dropped frames or thermal throttling on consumer laptops.

Exit criteria:
- Deterministic frame export completes 60 seconds of 4K 60fps video matching audio waveforms sample-for-sample.

## Later: platform expansion

These workstreams begin only after their prerequisite user flows and proof contracts are stable.

| Workstream | Prerequisite |
| --- | --- |
| Stims-native WebGPU preset lane | Stable backend contract, performance telemetry, and a format that produces visuals unavailable to the classic compatibility lane. |
| Embeddable package or Web Component | Lifecycle, audio, preset, resize, and cleanup APIs proven inside the product and integration tests. |
| Real stem-aware reactivity | On-device separation with measured latency, resource budgets, privacy posture, and populated runtime signals. |
| Community catalog and sync | Stable preset identity, provenance, moderation, versioning, and local-first failure behavior. |
| Multi-display or venue output | Deterministic timing, remote recovery, and a supported transport contract. |

## Research, not roadmap commitments

- neural audio-to-visual generation;
- Gaussian-splat or latent rendering;
- DMX, Art-Net, NDI, or Syphon bridges; and
- a general plugin marketplace.

Research code may exist for these areas, but it should remain labeled as scaffolding until an end-to-end product workflow and verification plan exist.

AI-assisted authoring — text/image-to-preset generation, blending, and diff-inspectable assisted edits in the editor — is studio scope and already wired to the Remix workflow. It is distinct from "neural audio-to-visual generation" above, which is the unbuilt research direction.

