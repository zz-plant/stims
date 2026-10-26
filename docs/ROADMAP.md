# Stims product and engineering roadmap

Stims is building a browser-native studio around the original MilkDrop presets. The roadmap prioritizes user-visible workflow improvements and measurable compatibility before speculative rendering or hardware breadth.

[`PRODUCT_MOMENTS.md`](./PRODUCT_MOMENTS.md) names the visitor moments this work serves, what counts as correct in each, and the policies agents apply without asking.

## Product principles

1. **Fidelity before parity claims.** Loading and compiling a preset is not proof that it looks correct.
2. **Workflow before technology badges.** WebGPU matters when it improves a measured user outcome; it is not a product promise by itself.
3. **One coherent studio.** Discovery, playback, editing, inspection, and recording should share one session.
4. **Foundations are not features.** A service class, reserved signal, or API route is not shipped until it is connected, usable, and verified.
5. **Direct formats and portable state.** Preserve `.milk` authoring and shareable session URLs rather than hiding the source format.
6. **Frictionless audio & sensory comfort are core, not afterthoughts.** Listening to music and sensory regulation are why people open Stims; audio routing and photosensitive safety must never be hidden behind external setup hoops or buried configuration.

## Current baseline

Audited against the code on 2026-10-06. PR numbers mark what changed in that pass.
- Searchable catalog with previews, collections, favorites, history, deep links, and a preset queue you can fill from Browse (#1373).
- Direct `.milk` import/export and a live CodeMirror editor: undo that never crosses presets, A/B against the original, named versions, and a revert to the original (#1369).
- WebGPU where the browser ships it as stable, WebGL2 elsewhere ([Rendering backends](./ARCHITECTURE.md#rendering-backends) has the selection rule and how visitors split). Measured visual evidence exists only for WebGPU, the judged backend; WebGL2 has none and is tracked as a gap, not claimed.
- Browser audio from the microphone, a file, tab or system audio (desktop browsers), a YouTube embed captured as tab audio, and the built-in demo, analysed off the main thread.
- Live performance: WebMIDI learn with mappings saved per device, factory controller profiles, and a cue monitor whose hand fader runs both presets through the fade.
- Comfort controls: a Reduce flashing governor, a brightness ceiling, and a motion dampener.
- Browser canvas recording beta.
- Native projectM reference capture, provenance, image-diff, and result-promotion tooling.

See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) for file-level status and [`TECHNICAL_ACHIEVEMENTS.md`](./TECHNICAL_ACHIEVEMENTS.md) for evidence boundaries.

## Workstreams

Four lanes cut across the sections below. Keep one owner per lane where possible. Parity and runtime work can move in parallel, but a change to a public claim waits for the proof lane to catch up.

| Lane                | Owns                                                                                                                                                                                                                  | Done when                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Parity and fidelity | `packages/milkdrop-toolchain/src/compiler/`, `src/js/milkdrop/vm/`, `src/js/milkdrop/renderer-helpers/`, `src/data/milkdrop-parity/`; ordered work in the [parity plan](./MILKDROP_PROJECTM_PARITY_PLAN.md#open-work) | the certification corpus compiles and steps in Stims, the certified set has current measured results, and catalog labels derive from them |
| Runtime performance | `src/js/milkdrop/runtime.ts`, `vm.ts`, `vm/frame-generation.ts`, `vm/wave-builder.ts`, `renderer-adapter*.ts`; queue in [Runtime performance](./RUNTIME_PERFORMANCE.md#open)                                          | fewer per-frame allocations, with no regression in playback or controls                                                                   |
| Browser product     | `src/js/frontend/`, `src/js/milkdrop/overlay/`, `public/milkdrop-presets/catalog.json`                                                                                                                                | launch, browse and recovery hold up on mobile and from the keyboard                                                                       |
| Proof and release   | `scripts/run-quality-gate.ts`, `scripts/run-parity-diff-suite.ts`, `scripts/promote-parity-suite-result.ts` and their tests, [Development](./DEVELOPMENT.md), [Lineage and credits](./LINEAGE_AND_CREDITS.md)         | gates cover each public claim, and public wording matches the strongest evidence present                                                  |

## Now: studio loop first, proof loop as a maintained floor

The proof loop below is a floor, not a frontier: it stays green and does not grow. New evidence infrastructure ships only when a studio workflow needs it. The immediate work is the studio loop — **browse → listen → edit → compare → save → share → record**.

### Up next, in order

Each of these needs a real GPU, a second display, or a product decision.
1. **Reduce flashing on by default.** The governor sees real frames (#1370), and its read costs the main thread 0.1 ms (#1375). It disagreed with the WCAG audit on the first-run preset (`shifter-curlique`, #1376), and the governor was wrong three ways (#1383). It judged one sample per tile, so moving texture read as flashing. It counted its own dimming step as the content darkening. And it skipped frames, so some comparisons spanned 33 ms and doubled the motion they judged. It now counts what the audit counts on the same frames: 0, 13 and 52 flashes/s on `shifter-curlique`, psychaos and krash. Live with Reduce flashing on, `shifter-curlique` had a mean brightness of 0.30 to 0.71; it now stays at full brightness in silence, on WebGL and at 390×844. With demo audio on WebGPU, one run in five still dimmed it briefly, to 0.62 at the lowest (see [Product moments](./PRODUCT_MOMENTS.md#open-questions)). What is left is the product call to turn it on for everyone.
2. **Re-measure parity and demote what fails.** The certified labels rest on a July results file that the September suite contradicts (see [Proof floor](#proof-floor--maintained-not-expanded)).
3. **Recording that holds up** ([#1441](https://github.com/zz-plant/stims/issues/1441)). Render 9:16 and 1:1 natively, keep frames coming when the tab is hidden, lift the power-saving frame cap while recording, and add a browser test that measures the file.
4. **A flash audit of the whole corpus with real music.**

### Verify what ships

Each of these is built and needs evidence from a real browser, device or registry before it is claimed.
- **Shared remixes across browsers** ([#1408](https://github.com/zz-plant/stims/issues/1408)). #1415 made the shared-draft test deterministic and #1416 fixed the startup-cover scrollbar handoff; the cross-browser reproduction and the in-app black stage are still open.
- **The OBS recipe** ([#1409](https://github.com/zz-plant/stims/issues/1409)), validated with native recordings and real audio routing.
- **The published packages** ([#1410](https://github.com/zz-plant/stims/issues/1410)). `eel-conformance`, `flash-guard` and `milkdrop-toolchain` reached npm at 0.1.0 on 2026-10-13, and `audio-reactive` stays off it (#1446). The issue stays open until each is checked from a clean consumer.

### Zero-friction audio routing (Closing the capture gap)

Audio capture friction is the single largest hurdle for music listeners and creators.

Shipped:
- Tab or system audio through `getDisplayMedia({ audio: true })`, on desktop browsers.
- Every source on the first screen as a chip (#1368). Tab audio, system audio, or a file now takes one click in the app before the browser's own picker.

Open:
- The tab/system card only checks that `getDisplayMedia` exists, so a browser that cannot share audio fails after the share dialog instead of before it.
- A direct audio-URL source, reusing the file-audio graph. SoundCloud has no code at all.
- The local player takes several files as a queue (#1443): it advances at the end of a track, loops the queue, and has next, previous and pause. Missing: picking a folder, ID3 title and artwork, a seek bar with beat markers, shuffle, and a control for the repeat modes `file-audio.ts` already has (queue, one track, off).
- The microphone has a device picker and a check that the browser's voice processing is off. Missing: user gain, a level meter in dB, and a noise gate. Room compensation comes after those.

Exit criteria:
- a user can start visualizing their system audio or a local playlist within 2 clicks from first visit without external software. _System audio: met inside the app; the browser's share picker adds its own clicks. Local playlist: met for files picked together (#1443); a folder cannot be picked._

### Remix studio & shader live-coding

Shipped:
- Undo history belongs to one preset: loading a preset or swapping A/B no longer enters it (#1369).
- A/B compares your edit with the preset's original (`Cmd/Ctrl+Shift+B`, listed in the shortcuts dialog). While A/B shows the original, it is read-only (#1369).
- Revert to original, as an undoable edit. A draft that matches the original is cleared, so a fix to a bundled preset reaches visitors who once opened it (#1369).
- Named versions in the editor's History tab.
- Version compare in the History tab diffs any two named versions, or a version against the live draft, through the same line-diff machinery assisted edits use — and annotates the diff with how the preset's relationship with the music changed ("zoom stopped listening to bass"), derived from the static dataflow of both sources (`version-compare-summary.ts`).
- Assisted edits, from the editor's Assist tab and from the Refine panel, appear as a diff before they apply (#1369).
- The stage watch HUD: the variables pinned in the Inspect tab plot over the running stage at display rate — a canvas on its own `requestAnimationFrame` loop, off the render path, one polyline per variable stroked straight from fixed-capacity `Float32Array` rings (which also replaced the `Array.shift` history in the Inspect tab's own feed). Toggled from the command palette ("Toggle the variable watch HUD"), including with the editor closed; the watched set is the pin list and survives the editor closing.
- Exported `.milk` files keep remix lineage (`remix_of_N_id`/`title`/`author`), and import reads it back (#1371).
- Share links carry remix lineage too: the `#code=` payload embeds the same `remix_of_N_*` fields an export writes, and the recipient's import reads them back (`tests/unit/share-link-lineage.test.ts`).
- A link to a preset that lives only in this browser carries its code, so the recipient can open it (#1371).
- Share links stop at 16,000 characters only in the extreme: an over-budget `#code=` payload now travels deflate-raw-compressed (`z1~`), decoded forever alongside the two older formats, so every bundled preset's code fits in a link (`bun run lab:link-reach`: raw 83.2% fit → compressed 100.0%, p95 25,101 → 5,215).

Open:
- **Shader tab (WGSL/GLSL).** Partial. The editor's Shader tab lists a preset's warp/comp blocks with jumps, shows the engine's structured compile diagnostics (program, stage, driver message) mapped to the authored block, and a read-only view of the GLSL the WebGL path compiles. Missing: the WGSL a WebGPU pipeline actually runs — the WebGPU path lowers shaders through three's TSL node graphs at render time, so per-block WGSL text needs a live GPUDevice plumbing path that does not exist yet.
- **Custom textures** ([#1442](https://github.com/zz-plant/stims/issues/1442)). Partly shipped: the editor's Textures pane inspects what exists — every `sampler_*` a preset's warp/comp blocks reference, resolved to the bundled texture file the engine binds (with a preview, alias/substitute/rand notes, per-backend volume honesty, and built-in samplers folded into a collapsed group; `texture-bindings.ts`). Still missing: remapping a slot to another bundled texture, user-uploaded textures, and any override persisted in the preset — textures remain a fixed bundled table (`texture-files.ts`).
- **Short links.** Links are long (p95 5,215 characters even compressed); a short-link service would still wait on moderation.
- **The loop as a whole.** `tests/e2e/studio-loop.test.ts` walks browse → edit → compare → save → share; CI's e2e matrix does not run it yet.

Exit criteria:
- browse → edit → compare → save → share works without leaving the running session. _Walked end to end by `tests/e2e/studio-loop.test.ts`; CI's e2e matrix does not run it yet._ And
- variable watch graphs update at delivered display frame rates without hitching the main JS thread. _Met in construction: the stage watch HUD paints on its own `requestAnimationFrame` loop, one polyline per watched variable stroked straight from typed rings with no steady-state allocation, and the frame loop's own path is unchanged beyond the per-frame variable publish the Inspect tab already rode (a no-op with nobody listening). No browser measurement yet; the frame-budget tooling measures the render loop, not this paint._

### Creator-grade export & vertical formats

Recording is a `MediaRecorder` beta. 4K, the three 1080×1920 presets and the 1080×1080 square render natively, by resizing the renderer; Full HD crops and scales the live canvas. Frames are copied in the render loop's frame-drawn notification with the flash governor's dimming, the blackout and the white flash painted in; the brightness ceiling is left out (`stage-presentation.ts`). The first four items below are [#1441](https://github.com/zz-plant/stims/issues/1441).
- Keep frames coming when the tab is hidden during a recording. Switching tabs freezes the video while the audio runs on: `hidden-tab-policy.ts` does not exempt recording, and browsers pause `requestAnimationFrame` in hidden tabs anyway, so a recording needs a frame source that does not depend on it.
- Lift the power-saving frame cap while recording; `captureStream(60)` asks for frames the cap withholds.
- Pick up an audio source that changes mid-recording (audio is composed once, at start).
- Portrait and social aspect ratios rendered natively: 9:16 (1080×1920) and 1:1, reusing the native capture and resize path the 4K preset already uses.
- Transparent background alpha channel export (`WebM with alpha` / `ProRes 4444`) for video editors overlaying visualizers on DJ footage. MilkDrop's composite is opaque by design, so this is also a design decision.
- On-screen track title & artwork overlay: customizable lower-third typography badge rendered directly into video frames. Needs a metadata source; nothing parses ID3 today.
- Seamless 15s and 30s loop export for Spotify Canvas and VJ banks.
- Deterministic frame pacing and loop-duration controls. Nothing renders frames off the live clock yet; recording captures the live canvas.
- Verify codec, aspect ratio, duration, and frame count in browser-backed tests. Today's recording tests are all mocked.
- Label `MediaRecorder` as the compatibility fallback once a deterministic path exists.

Exit criteria:
- "1080p", "4K", and "9:16 Vertical" describe measured render output rather than canvas container dimensions; and
- exported audio-video files remain synchronized over a documented test duration without dropped frames.

_Neither is met._

### Make the large catalog useful

Shipped:
- Local search that never waits on semantic or audio matching.
- "Best match" ranks Browse results by how well they match the search; before, it changed nothing (#1373).
- "High fidelity first" removed: it sorted on WebGPU support, which every bundled preset reports (#1373).
- Queue any preset from a Browse card or row, not only the one on stage (#1373).

Open:
- **Preview gaps.** Re-render the 193 presets listed in `preview-failures.json`.
- **Ranking inputs.** Reactivity is measured for 47 of 1,787 presets, motion for 50, and engagement for none. A performance-cost signal ships (`src/data/preset-frame-cost.json`, read by autoplay and shuffle on low-tier devices via `src/js/core/preset-cost-signal.ts`, #1419). It holds 43 presets, all measured on one high-end WebGPU machine on 2026-10-12; the heaviest is 5.24 ms against the 12 ms low-tier budget, so the gate skips nothing yet. Browse ranking does not read it, by design. 99 of the top 100 by `curatedRank` are uncertified.
- **Mood.** Mood comes from title keywords (`describePresetMood`). The autotagger's `category:*` tags can only be reached by typing them.
- **Visual similarity.** Nearby, the finder's "By look", Browse's "Like your saved" sort, and visual-term search use static EmbeddingGemma 2 vectors on the device (#1447, #1529). Diversity ranking, normalized vectors, and an image-neighbor cutoff shipped in #1534; these do not establish cross-modal retrieval quality. The [vector service](../src/js/core/services/preset-visual-vectors.ts) owns ranking. The optional [hosted fallback](../functions/api/visual-search.ts) uses BGE description embeddings in a separate space. Richer descriptions, multiple capture contexts, and retrieval of successful edits are planned in the [learning-loop spec](./LEARNING_LOOPS_SPEC.md).
- **Community signals.** `setRating` has no UI, and there are no notes or glitch reports. A credited showcase of submitted remixes is [#1411](https://github.com/zz-plant/stims/issues/1411).
- **Named sets.** The queue cannot be saved under a name or shared as a set ([#1412](https://github.com/zz-plant/stims/issues/1412)).
- **Shareable views.** A shared Browse URL keeps the collection but not the search, author, or sort.
- **Fidelity in Browse.** A fidelity sort or badge needs measurements; one preset in 1,787 has one.

Exit criteria:
- a first-time user can find a strong preset without understanding MilkDrop naming conventions. _Partly met: starter picks, collections, and search synonyms exist; there is no mood browsing and no user testing._ And
- low-confidence or expensive presets do not dominate default recommendations. _Not met: the cost signal and its low-tier autoplay gate shipped, but its 43 measurements come from one high-end machine and exclude nothing, and there is almost no confidence signal._

### Clef decision-model assistance (routing and catalog pilots)

A typed Clef decision layer shipped in #1514 (2026-10-18), with capture/source evidence fixes in #1525. Five server-owned tasks cover visual profiles, prompt checks, audio matching, scene choice, and capture review. The [decision-model reference](./DECISION_MODELS.md) owns their schemas, limits, consent, CLI/MCP entry points, and promotion rules. Flash handles text/image judgments; this integration selects Omni for audio/video. Results retain question versions, input hashes, model identity, and review/abstention dispositions.

The app also ships explicit short-clip audio matching, Check animation, and a one-shot saved-scene choice with a local ramp (#1536). These are optional actions with orchestration coverage; they do not establish model accuracy, musical fit, or continuous performance control.

Generation routing already uses the layer: `functions/api/generate-preset.ts` asks `clef-flash` a `complexity` choice and a `needs_reasoning` noul, accepts only answers at or above its 0.8 thresholds, and falls back to a deterministic length-based guess otherwise (Granite survives only for titles). What is open is calibration, not the integration: the thresholds in `decision-model.ts` are "provisional, deliberately conservative thresholds; no task-specific calibration has been established."

Open:
- **Calibration.** Measure accepted-answer accuracy against human labels, per task and per model, with coverage — a concentrated answer distribution is not correctness. Choose thresholds per task rather than the provisional 0.8 defaults, and record the accepted-rate versus accuracy trade on each task.
- **Routing pilot.** Compare `clef-flash` routing against the deterministic fallback and a fixed-generator baseline on the frozen prompt set (`scripts/preset-lab-generation-bench.ts`), scoring compile success, reactivity and prompt adherence, plus end-to-end latency and cost — not whether the labels "look right". The bench's rendered-visual stage stays a documented stub until `lab:visual` is wired into it.
- **Catalog labels.** Batch `visual-profile` questions over portrait and landscape captures on both backends for an initial pilot of roughly 100 diverse presets, split by remix family ([training models](./guides/training-models.md)). Promote accepted results to versioned static metadata. Compare retrieval against current tags, static visual vectors, and the description fallback with human-rated relevance on held-out families.
- **Request-match on generated output.** After compile and reactivity checks, feed `prompt-match` the request and the rendered result and ask the atomic questions ("is a spiral visible?", "is the palette predominantly blue?"); use the answers to bound a repair attempt or choose among variations. Success is agreement with human judgments, including failures that compile successfully — closing the generate → measure → revise gap.
- **Music-aware suggestions.** The finder now captures an explicit short audio clip and asks Omni to select from its shortlist. Evaluate listener preferences, unfamiliar styles, and shuffled-audio controls against the local matcher; the capture path alone does not show musical benefit. `session_listen` still reports features rather than an uploadable recording.
- **Audiovisual performance conductor.** Extend the existing one-shot scene choice into the separately armed [phrase-aware performance pilot](./LEARNING_LOOPS_SPEC.md#ll-05-phrase-aware-performance): look-ahead, bridge presets, bounded dwell/change rates, stale-choice rejection, and immediate manual takeover. Local ramps and modulators execute movement. Omni's sampled video supports broad motion/composition judgments; flashing, frame pacing, and synchronization stay on Stims' full-rate instruments.
- **Capture and preview review.** Feed contact sheets and visual reports to `capture-review` to flag suspicious previews, poor composition or content mismatches, and measure its miss rate against manual review before it gates anything. Codec, duration, synchronization and parity remain instrumented checks.

Constraints the layer already encodes and the pilots must keep:
- Cloudflare caps one request at 64 questions; batch questions over shared evidence (a capture can support several judgments) and combine the answers in code.
- Media count toward the context window and text `state` is truncated when context runs out. Record preset/source hash, model and question version, backend, viewport, audio scenario and capture time with every decision; a desktop thumbnail cannot establish how a preset behaves on a portrait phone.
- Decisions consume measurements; they never override failed gates (compiler validity, flash counts, frame cost, parity).
- Live execution stays local and runs on user request, a meaningful audio change or a phrase-scale window; catalog judgments are cached so browsing never waits on a model. `session_decide` opens no microphone and records no live audio.

Exit criteria:
- per-task accepted-answer accuracy is measured against human labels with coverage, and the thresholds in `decisionDisposition` are tuned per task and model from that measurement; and
- either the routing pilot lands (Flash routing beats the deterministic fallback and a fixed-generator baseline on compile, reactivity, adherence, latency and cost over the frozen prompt set) or the catalog pilot lands (accepted `visual-profile` labels beat current tags and embeddings on held-out families by human-rated relevance), with the other roadmapped with its evidence.

### Learning loops for authoring and discovery

**Slice 1 shipped, 2026-10-23.** The [learning-loop specification](./LEARNING_LOOPS_SPEC.md) owns episode/index contracts, all nine loops, model roles, bounds, privacy, and release evidence. The [page specifications](./PAGE_SPECIFICATIONS.md#planned-learning-loop-interactions) own the proposed interaction states. This work does not change the ordered recording, comfort, and parity priorities above.

| Order                      | Product slice                                                                                                                   | Dependency and exit criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                          | **Reference-guided remix** (LL-00/01): retrieve an editable preset, propose a small diff, compare, and save an explicit outcome | _Foundation shipped:_ the bounded local episode store (100 episodes / 32 MiB, explicit outcomes, eviction, delete) and the on-device reference finder in the "Find a preset" panel ("By reference" mode — retrieve starting points from a description, optional Clef pick against an uploaded reference image, open in the editor, record accept/reject, reuse accepted references). Remaining: the writer-proposed diff and render-and-measure step, then the frozen baseline that measures accepted editable results and total latency against current search/image-generation controls |
| 2                          | **Intent-preserving edits and repair memory** (LL-02/03)                                                                        | Retrieve successful edits and verified repairs; measure preservation errors and repair rate on held-out remix families. Compile/render checks, review, source freshness, and bounded retries remain mandatory                                                                                                                                                                                                                                                                                                                                                                             |
| 3                          | **Choose the next experiment** (LL-06)                                                                                          | Support a concrete gap in those authoring pilots using existing instruments. Measure confirmed failures per GPU-minute and coverage gained per capture against a fixed schedule; stay within the maintained proof floor                                                                                                                                                                                                                                                                                                                                                                   |
| 4                          | **Learn this effect and session taste** (LL-04/07)                                                                              | Require measured authoring benefit, explicit outcomes, diverse retrieval, local deletion/reset, and separate treatment of weak engagement signals                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Separate performance pilot | **Phrase-aware performance** (LL-05)                                                                                            | Build on the shipped Omni selector only after local takeover, rate limits, late-result rejection, and musical-fit controls are evaluated                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Supporting work            | **Catalog refresh** (LL-08)                                                                                                     | Start with the first workflow's corpus. Invalidate stale source/capture/model representations, recapture selectively, and review reindexing before catalog expansion                                                                                                                                                                                                                                                                                                                                                                                                                      |

EmbeddingGemma retrieves evidence; Clef makes narrow typed judgments; an evaluated frontier writer proposes difficult patches or offline critiques. Stims owns validation and application. Human acceptance, teacher labels, and deterministic measurements remain separate. Every slice needs a frozen family-held-out baseline, task-specific calibration, measured latency/cost, and failure/rollback coverage before expansion. A shared store or another model call alone is not delivery.

Measured parameter optimization (LL-09) stays research until source/parameter changes have paired rendered measurements and a surrogate beats simple bounded search on held-out cases. CPU VM trajectories alone cannot establish a visual prediction target.

### Proof floor — maintained, not expanded

**The floor is not green.** The last suite run (2026-09-01) graded the 13 certified references: 1 pass, 10 fail, 2 whose reference shows no signal. The feedback clamp (#1223, 2026-09-23) landed after that run and has not been measured. `measured-results.json` (2026-07-29) still marks 250-wavecode, 300-beatdetect, and glowsticks as passing; the suite grades the first two as failing (7.38% and 5.88% against a 2% limit) and the third as no-signal. CI grades the tooling against synthetic fixtures only. Re-measuring needs a WebGPU device, which headless Chromium does not expose.

The [parity plan](./MILKDROP_PROJECTM_PARITY_PLAN.md#open-work) holds the full ordered list and its evidence.
- Re-run capture, suite, and noise; demote the results the suite contradicts.
- Seed `Math.random` in the capture path, so presets like mosaics and cubetrace render the same way on every run.
- Fix renderer behavior by subsystem when measured evidence regresses: feedback orientation, shader sampling, color presentation, shapes, waves, and motion vectors.
- Promote results only after the requested backend and reference provenance are verified. The tooling enforces this; the data predates it.
- Retire the krash and glowsticks references, which a blank frame would pass.
- Show evidence where people choose presets. Browse shows none by design, and the inspector shows no measured result.
- Make WebGL's warp centre honour the aspect. #1376 traced the black portrait stage of 2026-10-06 to the then first-run preset's 16:9 `cx`/`cy` maths: WebGPU matches MilkDrop there, and WebGL differs because it drops the aspect from `cx`/`cy` (see [Product moments](./PRODUCT_MOMENTS.md#open-questions)).

Exit criteria:
- every featured preset has current measured evidence. _Not met: the first-run preset, `shifter-curlique` (`src/js/milkdrop/runtime/first-run-preset.ts`), has no projectM reference. Its checked-in evidence shows it lit and moving on both backends at both sizes (mean luminance 138 on WebGPU, 115 on WebGL at 1280×720; `src/data/first-run-preset-evidence.json`), which is not parity. Its predecessor, krash, had a reference that shows no signal._
- public compatibility wording is generated or guarded against tracked sources of truth. _Partly met: the claims guard scans the README and `docs/` but not in-app copy or `public/llms.txt`, and the catalog fidelity check trusts the stale results file._ And
- unsupported or fallback behavior is visible rather than silent. _Partly met: the 168 presets that render approximated on WebGPU get a stage chip, but nothing in Browse says so._

### Sensory safety shield & comfort controls

The bundled corpus was imported from the community without any photosensitive-seizure review. Stims' commitment to neurodivergent stimmers requires active protection, not just passive reporting.

**What is measured.** On 2026-08-22 the WCAG 2.3.1 audit (`packages/flash-guard/src/analysis.ts` + `scripts/analyze-preset-flash.ts`) measured 40 of 1,787 presets on the synthetic preview waveform and found one high, `beta106at-shape-mash0001-…`, at about 5 flashes a second. It explained the other zeros as directionally incoherent motion: in a decomposition of five presets, 14.1% of a window brightened while 13.6% darkened in the same frame, each under the 25% area rule ([`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md#layer-0--safety-first-sample-run-complete)). That explanation no longer covers the corpus. On 2026-10-06 the live governor, sampling at 60 Hz with real audio, caught `krash-rovastar-cerebral-demons-stars`, the first-run preset until #1376 replaced it that day, flashing above 3 a second in bursts. Since #1383 the audit and the governor count psychaos and krash well above that on the same frames (item 1 in [Up next](#up-next-in-order)). On 2026-10-13 the hall of fame and the top of curated rank were measured at 60 and 30 fps: 20 of the 65 that could be measured read `high`, four of them in the hall of fame, and curated rank now sinks every `high` preset to the bottom ([`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md#layer-0--safety-first-sample-run-complete)). Whether churn, a quarter of the field brightening while another quarter darkens, should count as flashing is open ([Product moments](./PRODUCT_MOMENTS.md#open-questions)).

Shipped:
- The flash governor checks frames against WCAG 2.3.1 and dims the stage. Before #1370 it read the canvas outside the draw, so outside agent mode it saw a blank frame on WebGPU and a dimmed one on WebGL. It now reads inside the draw, at a 60 Hz cadence whatever the display rate, and thresholds 64 pixels per tile rather than one value (#1383). `scripts/analyze-preset-flash.ts --governor` prints the governor's own count beside the audit's, from the same frames.
- While it dims, a "Dimming flashes" notice shows on stage. Reduce flashing can be switched from the dock menu and the command palette (#1370).
- With Reduce flashing on, shuffle and autoplay skip presets measured as flashing, as Browse already did (#1370).
- A motion dampener slider (0–100%), defaulting to 40% when the OS asks for reduced motion.
- A brightness ceiling, 30–100%.

Open:
- **Default-on.** Reduce flashing follows the OS reduced-motion setting, so it is off for most visitors. The cost that kept it opt-in is gone (#1375); see item 1 in [Up next](#up-next-in-order).
- **The shield itself.** It is a CSS brightness filter that reacts after it detects a flash, so the first one or two get through. A clamp in the shader would act before the frame is shown.
- **Calm filter.** A "Calm stimming" filter has no data to stand on: motion is measured for 50 presets and flashing for 102.
- **Room controls.** Gamma and contrast are missing; CSS has no gamma filter, so this needs an SVG filter or a shader uniform.
- **Dampener gaps.** The dampener does not reach presets whose warp shader owns the transform, or the per-pixel part of WebGPU-lowered programs.

Exit criteria:
- the audit tool's resource-exhaustion pattern is fixed and a full-corpus run completes without a large unmeasured tail. _Not met: the last local run lost 21 of 60 presets, mostly to 90-second timeouts clustered at the end. Page recycling exists but reuses one browser and context._
- a corpus test in `tests/corpus/` continuously enforces the threshold, not just regression-tests the tool's report shape. _Not met; the three presets measured above threshold (`beta106at-shape-mash0001-…`, psychaos and krash) would fail it._
- a real-time luminance clamp passes a synthetic 15Hz square-wave flash torture test with zero frames exceeding WCAG 2.3.1 thresholds. _Partly met: unit tests cover 10 Hz and 30 Hz on a 6×6 grid, and 5 Hz on the app's 16×16 grid at its sample density; none covers 15 Hz or the real filter in a browser._ And
- the motion dampener scales camera transforms down to full stillness without halting audio-reactive shape generation. _Mostly met: transforms come to rest at 0, but no test checks that waves and shapes still react._

## Next: compatibility depth & runtime compiler milestones

These deepen the compatibility lane, compiler runtime, and live-performance capabilities. Each item names the measurement it moves; where a count appears, it is the one the cited test or data file reports today.

### Live performance, VJing & hardware control

Shipped:
- WebMIDI learn: touch a control, turn a knob. Mappings are saved per device, with hot-plug, LED and motor feedback, and factory profiles for known controllers.
- A cue monitor with a hand crossfader; both presets keep running through the fade.
- From #1372:
  - A controller fader mapped to `crossfade` moves the crossfader. It used to write a `crossfade=` line into the preset source.
  - Knob and fader moves apply live and commit once, 250 ms after the last move. Before, every CC recompiled the preset on the main thread.
  - A learned mapping spans the variable's natural range instead of 0–1.
  - Touching a Perform control or the cue fader picks it as the learn target.
- Stage utilities (#1455, closing [#1440](https://github.com/zz-plant/stims/issues/1440)): hold D for a blackout (two quick taps latch it) and Y for a white flash, without touching the preset or audio. Space freezes the picture.
- Tap tempo: K taps (the first tap is the downbeat, one tap after a pause re-syncs it), Shift+K hands the tempo back to the music, and the palette nudges the beat grid by 20 ms. A tapped tempo puts auto-advance on the performer's bar lines.
- MIDI clock in: a running clock from a mixer or DAW sets the tempo and bar position until it stops or goes silent. The cue monitor's BPM readout names who owns the tempo.
- Pads run commands: Settings → Performance hardware maps a pad, key or gamepad button to any command-palette action (next preset, pause, tap tempo, take the queued preset, and anything the palette adds later). The hit that maps it does not fire it, and each mapping is listed under its device with a remove button.
- A projector window ([#1439](https://github.com/zz-plant/stims/issues/1439); dock → Projector window, or the palette) mirrors the stage canvas into a window with no chrome, through the same `captureStream()` path picture-in-picture uses. MIDI moves, edits, crossfades and a held frame all reach it, because it shows this tab's pixels; the flash governor, brightness ceiling, blackout and white flash, which sit outside the canvas, are mirrored onto it. With a second screen attached it moves there once the browser grants screen access; double-click or F in it goes full screen, and the cursor hides when still. After a reload, opening it again takes back the window already on the projector. Casting to a TV keeps the watch-party receiver, which a separate device needs.

Open:
- **Pads on fields and held keys.** A pad can be learned only to a command. Gate and toggle bindings on a preset field still come only from a factory profile, and blackout and white flash are held keys rather than commands, so a pad cannot hold them yet.
- **MIDI clock out.** Implemented, but nothing starts it, so lighting desks cannot follow the visuals' tempo.
- **Latency.** The sub-10 ms target has never been measured on a device.
- **Projector shape and frame pacing.** The projector has the stage's shape and size, so a portrait stage letterboxes on a 16:9 projector; it should render at the projector's own aspect. Display-rate pacing is unmeasured, and a minimised operator window gets no frames from the browser, so the projector holds its last one.
- **Tempo beyond auto-advance.** A tapped or clocked tempo moves only auto-advance's bar lines. LFOs keep their own rate and no preset reads a tempo.
- **Transition shaders.** One noise dissolve. Missing: wipe, glitch, and others, on both backends.
- **Brightness floor.** The brightness ceiling stops at 30%, so the stage cannot be dimmed further than that without a blackout.

Exit criteria:
- WebMIDI bindings persist across browser restarts and respond with sub-10ms latency. _Persistence is met and tested; latency is unmeasured._ And
- the pop-out projector window maintains display-rate frame synchronization with zero UI chrome or cursor leaks. _Partly met: the window has no chrome and hides a still cursor (`tests/e2e/projector-window.test.ts` checks it plays non-black stage frames); frame pacing is unmeasured._

### Dual-backend differential evidence (Closing the WebGL2 gap)

- Extend the parity diff harness (`scripts/run-parity-diff-suite.ts`) to capture and grade WebGL2 frame captures alongside WebGPU, which is currently the only judged backend.
- Grade both backends against the same contract the suite already uses: mismatch below the preset's configured `failThreshold` (`0.02` in `visual-reference-manifest.json`), outside its measured noise band, and against a reference a blank frame would not also pass.
- Eliminate the unmeasured status of WebGL2, which carries a large share of visits ([Rendering backends](./ARCHITECTURE.md#rendering-backends)), so fidelity claims cover the renderer those visitors see.

Exit criteria:
- Every certified preset in `src/data/milkdrop-parity/visual-reference-manifest.json` possesses matching measured diff reports for both `webgpu` and `webgl` backends; and
- zero silent divergence between WebGL2 GLSL 300 es and WebGPU WGSL shader lowering.

### Close the 168-preset WebGPU shader-translation gap

Measured by `tests/corpus/butterchurn-corpus-support.test.ts` on the bundled corpus (2026-09-02): 1,578 presets are fully supported on both backends, 168 execute their shader programs directly on WebGL but fall back to extracted scalar controls on WebGPU, and 8 reference EEL identifiers the expression VM evaluates to `0`. (Was 226 / 1,521 before `mat2` element writes were let through to the WebGPU node executor, and 169 / 1,577 before `mat3`/`mat4` had a representation there.)
- ~~Resolve the packed feedback composite sampler (`sampler_fc_main` and `sampler_fw_main`) binding on WebGPU.~~ Done: both resolve to real bindings (`warpTex` / `currentTex`) end to end, covered by `tests/unit/milkdrop-shader-sampler-aliases.test.ts`. None of the remaining 168 is attributable to sampler binding.
- Lower volumetric noise (`sampler_noisevol_lq`) directly to 3D texture bindings in WebGPU, replacing the simplex-atlas approximation the WebGL preamble uses. Note the backends already differ here: `sampleNoiseVolume` slices the 2D simplex atlas on WebGL but samples the native simplex volume in the WebGPU node executor.
- ~~Give the WebGPU node executor a `mat3`/`mat4` representation.~~ Done: a mat3/mat4 is carried as its column vectors (`shaderMatrix` in `src/js/milkdrop/feedback-manager-webgpu-tsl.ts`), an element write is a swizzle on one column, products are spelled out column-major (`M * v`, `v * M`, `M * M`, `mul`, `transpose`), and shader analysis seeds each bare `matN` declaration with `matN(0.0)` so the size is known before the first write. The analysis gate now covers only writes at a runtime index, of which the corpus has none. The branch desugar masks indexed targets too, so the flag-on count went from 50 to 14; with shipped defaults only one of the 20 mat3 presets moved, because the other 19 also branch.
- Close the WebGPU executor gaps that keep the `shaderBranchDesugar` rewrite (168 → 14) behind a flag: the GPU-process crash is fixed; six presets still render white or black under the flag. They are named in `packages/milkdrop-toolchain/src/compiler/shader-branch-desugar.ts` together with what has been ruled out (every statement compiles; q-registers, feedback format and decay blend are shared with WebGL) and the lead to check first (`sampleNoiseVolume` samples different textures on the two backends). This needs a WebGPU device: headless Chromium exposes no adapter, so it cannot be done from a container.

Exit criteria:
- `tests/corpus/butterchurn-corpus-support.test.ts` reports 0 presets falling back to extracted scalar controls on the WebGPU path, with `fullySupported` at the full corpus count.

### Vectorized GPU compute offloading for waveforms & geometry

- Offload per-point custom wavecode generation ($4 \text{ waves} \times 512 \text{ points} = 2,048 \text{ evaluations/frame}$) from the CPU JIT to the GPU. Per-pixel mesh programs already run inside the mesh shader on the full WebGPU path ([Architecture](./ARCHITECTURE.md#frame-data-flow)); per-point wave programs are the CPU lane left.
- Eliminate remaining main-thread CPU spikes, building on the frame-work reduction recorded in [RUNTIME_PERFORMANCE.md](./RUNTIME_PERFORMANCE.md) ($3.43 \text{ ms} \rightarrow 2.87 \text{ ms}$ at 1×, about 16%; $17.56 \text{ ms} \rightarrow 15.31 \text{ ms}$ at 4× CPU throttle, about 13%).

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

### Learn by editing

The authoring curriculum shipped as ten tracks in [docs/authoring/](./authoring/README.md), published at [/learn/](https://toil.fyi/learn/). The plan behind it is [archived](./archive/PRESET_AUTHORING_DOCS_PLAN.md); its follow-on work is open:
- **Live reactivity while typing.** The editor's Tune chips name the sounds that drive each control from static dataflow. The per-variable live verdicts from `src/js/milkdrop/reactivity-probe.ts`, which the Generate panel already uses, are not wired into the editor.
- **A way from the editor into the lessons.** The docs site with run links exists; the editor has no Learn link to the lesson for what is on screen, and no lesson embeds a live stage.
- **Technique tags.** No catalog preset carries a `technique:*` or `difficulty:*` tag, so lessons cannot link to examples in the wild.
- **Explain this line.** The editor's Explain covers the whole preset; a per-line explanation that links to the relevant lesson does not exist.
- **Lesson deep links.** `#code=` restores a preset but not a lesson position or highlighted lines (`#lesson=`).
- **Archive rescue.** The sweep of community knowledge described in the archived plan has not started.
- **A lesson example driven by the percussive/harmonic signals** ([#1340](https://github.com/zz-plant/stims/issues/1340)).

## Engineering health

Checked against the code on 2026-10-13. These carry no visitor-facing change; each lowers the cost or risk of the work above. They come from the September architecture proposal, the September toolchain audit and the WebGPU revamp plan, all [archived](./archive/).
- **One shader source for the composite pass.** `src/js/milkdrop/feedback-manager-webgpu-tsl.ts` (4,786 lines) mirrors the GLSL composite in `feedback-manager-shared.ts` (2,633) by hand, and nothing fails when they drift. Two attempts at a shared IR were removed because nothing consumed them. Start with a uniform table both managers read their defaults from, plus a differential test that every composite uniform is bound on both backends or declared backend-only (`feedback-composite-contract.ts`, `milkdrop-feedback-uniform-contract.test.ts`, both NEW); decide on generating shaders from it after that.
- **Break up `App.tsx`.** It has 1,496 lines and 33 `useEffect` calls. Extract lifecycle hooks one concern per PR, split `EngineContextValue` into actions and data by change cadence, and add a guard that fails when the effect count rises (`check-app-shell-effects.ts`, NEW).
- **Give `src/js/milkdrop/` a shape.** 89 modules sit at its top level. One folder per concern, each with an index as its public surface, would let `.dependency-cruiser.mjs` replace the `MILKDROP_SHELL_SURFACE` list with "import through the folder index". Move one folder per PR with `git mv` and an import rewrite only.
- **React Compiler.** Enabled globally in #1539 (46 of 59 frontend files compile; the rest bail untouched). What remains is shrinking the bailout inventory — #1540 carries the measured per-file list and the class-by-class plan.
- **Bun 1.4.** Done in #1539: `.bun-version`, `mise.toml`, `packageManager` and `engines.bun` all pin 1.4.3. Still open: `Bun.Image` could replace `sharp`, starting with `scripts/generate-thumbnails.ts`, which has a golden-output test.
- **The Cloudflare Vite plugin for the site Worker.** It would build client and Worker in one graph and retire the hand-stitched `dist/_worker.js` in `scripts/build-site.mjs` and `scripts/sync-resvg-wasm.mjs`.
- **The AudioWorklet bundle on Rolldown instead of esbuild.** Ported and reverted on 2026-09-02: the browser corpus gate passed 2 runs of 11 with it against 4 of 5 with esbuild. Retry with the two browser-backed corpus tests serialised, and measure ten runs.
- **Rendering from a worker over OffscreenCanvas.** Not implemented; agent-mode hidden-tab rendering must keep working from the worker first. An unwired prototype was deleted in #1104 and its message protocol in #1454; recover them with `git show dd3aae08^:src/js/core/<file>`.
- **An Oxlint type-aware `no-floating-promises` pass** in the full `check`, alongside Biome.
- **One browser e2e test per file hangs for its whole timeout** ([#1123](https://github.com/zz-plant/stims/issues/1123)).

## Later: platform expansion & ecosystem

These workstreams begin only after their prerequisite user flows and proof contracts are stable.

| Workstream                                 | Prerequisite                                                                           | User Value                                                                                       |
| :----------------------------------------- | :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **Progressive Web App (PWA) Offline App**  | Service worker caching, local database preset store, offline audio synthesis           | Installable desktop/mobile app running anywhere with complete offline preset access.             |
| **Community Catalog & Cloud Hub**          | Stable preset identity, provenance, moderation, versioning, local-first storage        | Public gallery to publish, discover, rate, and fork presets without filing GitHub PRs.           |
| **Embeddable NPM Package (`@stims/core`)** | Decoupled renderer engine, Web Component `<stims-player>`, clean lifecycle API         | Drop-in visualizer library for musicians, portfolio sites, and web audio apps.                   |
| **Real Stem-Aware Reactivity**             | On-device WebGPU Demucs-lite or multi-band spectral isolation with fixed memory budget | Visuals reacting independently to isolated vocals, drums, basslines, and melody.                 |
| **Standalone Desktop Builds (Tauri)**      | Native audio loopback, multi-monitor window management, local file association         | Lightweight `.dmg`/`.exe` with double-click `.milk` file associations and system audio loopback. |
| **Stims-Native WebGPU Preset Lane**        | Stable backend contract, performance telemetry, format validation                      | Next-generation preset format leveraging compute shaders, storage buffers, and 3D meshes.        |
| **Multi-Display or Venue Output**          | Deterministic timing, remote recovery, and a supported transport contract              | Multi-screen synchronized canvases spanning broad venue projection rigs.                         |

## Research, not roadmap commitments

Research code may exist for these areas, but it remains labeled as scaffolding until an end-to-end product workflow and verification plan exist:
- **Syphon (macOS), Spout (Windows) & NDI Video Output**: Zero-latency GPU texture streaming into Resolume, TouchDesigner, and OBS via native sidecar or WebRTC bridges;
- **Ableton Link Protocol Sync**: Low-latency local network tempo and phase sync over WebSockets/WebRTC;
- **Art-Net / DMX Stage Lighting Bridge**: Real-time extraction of dominant color palettes and beat transients transmitted to stage DMX fixtures;
- **WebXR 360° Immersive VR Dome**: Virtual reality celestial dome projection for Meta Quest and Apple Vision Pro;
- **Neural audio-to-visual generation & Gaussian-splat rendering**;
- **Learned parameter optimization** ([LL-09](./LEARNING_LOOPS_SPEC.md#ll-09-measured-parameter-optimization)): paired rendered measurements and held-out gains over simple search are prerequisites; and
- **General plugin marketplace**.

AI-assisted authoring — text/image-to-preset generation, blending, and diff-inspectable assisted edits in the editor — is studio scope and already wired to the Remix workflow. It is distinct from "neural audio-to-visual generation" above, which is the unbuilt research direction.
