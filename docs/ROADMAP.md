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
- WebGL2 compatibility baseline plus a guarded WebGPU execution path. Measured visual evidence is captured on the WebGPU path (the reference-capture backend); WebGL2, the baseline most users run, has no measured evidence and is tracked as a gap, not claimed.
- Browser audio from the microphone, a file, tab or system audio (desktop browsers), a YouTube embed captured as tab audio, and the built-in demo, analysed off the main thread.
- Live performance: WebMIDI learn with mappings saved per device, factory controller profiles, and a cue monitor whose hand fader runs both presets through the fade.
- Comfort controls: a Reduce flashing governor, a brightness ceiling, and a motion dampener.
- Browser canvas recording beta.
- Native projectM reference capture, provenance, image-diff, and result-promotion tooling.

See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) for file-level status and [`TECHNICAL_ACHIEVEMENTS.md`](./TECHNICAL_ACHIEVEMENTS.md) for evidence boundaries.

## Now: studio loop first, proof loop as a maintained floor

The proof loop below is a floor, not a frontier: it stays green and does not grow. New evidence infrastructure ships only when a studio workflow needs it. The immediate work is the studio loop — **browse → listen → edit → compare → save → share → record**.

### Up next, in order

Each of these needs a real GPU, a second display, or a product decision.

1. **Reduce flashing on by default.** The governor sees real frames (#1370), and its read now costs the main thread 0.1 ms instead of 2–3.6 ms (#1375). The first-run preset is now one the WCAG audit reads at 0 flashes/s (`shifter-curlique`, #1376; the previous one read 38/s). The governor still dims it to about half brightness, 65% of the time, in silence as well as with music, while leaving `geiss-casino` and `eos-glowsticks-v2-03-music` alone. Settle whether the governor or the audit is right before turning it on for everyone (see [Product moments](./PRODUCT_MOMENTS.md#open-questions)).
2. **Re-measure parity and demote what fails.** The certified labels rest on a July results file that the September suite contradicts (see [Proof floor](#proof-floor--maintained-not-expanded)).
3. **Recording that holds up.** Render 9:16 and 1:1 natively, keep frames coming when the tab is hidden, lift the power-saving frame cap while recording, and add a browser test that measures the file.
4. **A projector window that mirrors the stage.** Today's second window is a separate session (see [Live performance](#live-performance-vjing--hardware-control)).
5. **A flash audit of the whole corpus with real music.**

### Zero-friction audio routing (Closing the capture gap)

Audio capture friction is the single largest hurdle for music listeners and creators.

Shipped:

- Tab or system audio through `getDisplayMedia({ audio: true })`, on desktop browsers.
- Every source on the first screen as a chip (#1368). Tab audio, system audio, or a file now takes one click in the app before the browser's own picker.

Open:

- The tab/system card only checks that `getDisplayMedia` exists, so a browser that cannot share audio fails after the share dialog instead of before it.
- A direct audio-URL source, reusing the file-audio graph. SoundCloud has no code at all.
- The local player plays one file on a loop. Missing: folder and multi-file playlists, advancing at the end of a track, ID3 title and artwork, a seek bar with beat markers, and shuffle/repeat.
- The microphone has a device picker and a check that the browser's voice processing is off. Missing: user gain, a level meter in dB, and a noise gate. Room compensation comes after those.

Exit criteria:

- a user can start visualizing their system audio or a local playlist within 2 clicks from first visit without external software. *System audio: met inside the app; the browser's share picker adds its own clicks. Local playlist: not met, because there is no playlist.*

### Remix studio & shader live-coding

Shipped:

- Undo history belongs to one preset: loading a preset or swapping A/B no longer enters it (#1369).
- A/B compares your edit with the preset's original (`Cmd/Ctrl+Shift+B`, listed in the shortcuts dialog). While A/B shows the original, it is read-only (#1369).
- Revert to original, as an undoable edit. A draft that matches the original is cleared, so a fix to a bundled preset reaches visitors who once opened it (#1369).
- Named versions in the editor's History tab.
- Assisted edits, from the editor's Assist tab and from the Refine panel, appear as a diff before they apply (#1369).
- Exported `.milk` files keep remix lineage (`remix_of_N_id`/`title`/`author`), and import reads it back (#1371).
- A link to a preset that lives only in this browser carries its code, so the recipient can open it (#1371).

Open:

- **Watcher HUD.** The Inspect tab draws 120-sample sparklines, repaints at most every 150 ms, and exists only while the editor is open. Missing: a stage overlay, plots at display rate, and history kept in typed ring buffers instead of `Array.shift` on the render path.
- **Shader tab (WGSL/GLSL).** Missing. `compiler/custom-shader-block.ts` parses a block but nothing calls it.
- **Custom textures.** Missing. Textures are a fixed bundled table.
- **Lineage in links.** Lineage survives a file round trip but not a share link.
- **Share-link reach.** Links stop at 16,000 characters, and short links wait on moderation.
- **The loop as a whole.** No end-to-end test of browse → edit → compare → save → share.

Exit criteria:

- browse → edit → compare → save → share works without leaving the running session. *Each step works; nothing tests the whole loop.* And
- variable watch graphs update at delivered display frame rates without hitching the main JS thread. *Not met.*

### Creator-grade export & vertical formats

Recording is a `MediaRecorder` beta. Only the 4K preset renders natively; the three 1080×1920 presets center-crop and upscale the live canvas, and there is no 1:1 preset.

- Keep frames coming when the tab is hidden during a recording. Switching tabs freezes the video while the audio runs on: `hidden-tab-policy.ts` does not exempt recording, and browsers pause `requestAnimationFrame` in hidden tabs anyway, so a recording needs a frame source that does not depend on it.
- Lift the power-saving frame cap while recording; `captureStream(60)` asks for frames the cap withholds.
- Pick up an audio source that changes mid-recording (audio is composed once, at start).
- Portrait and social aspect ratios rendered natively: 9:16 (1080×1920) and 1:1, reusing the native capture and resize path the 4K preset already uses.
- Transparent background alpha channel export (`WebM with alpha` / `ProRes 4444`) for video editors overlaying visualizers on DJ footage. MilkDrop's composite is opaque by design, so this is also a design decision.
- On-screen track title & artwork overlay: customizable lower-third typography badge rendered directly into video frames. Needs a metadata source; nothing parses ID3 today.
- Seamless 15s and 30s loop export for Spotify Canvas and VJ banks.
- Deterministic frame pacing and loop-duration controls. `OfflineFrameRenderer` exists but nothing in the engine implements it.
- Verify codec, aspect ratio, duration, and frame count in browser-backed tests. Today's recording tests are all mocked.
- Label `MediaRecorder` as the compatibility fallback once a deterministic path exists.

Exit criteria:

- "1080p", "4K", and "9:16 Vertical" describe measured render output rather than canvas container dimensions; and
- exported audio-video files remain synchronized over a documented test duration without dropped frames.

*Neither is met.*

### Make the large catalog useful

Shipped:

- Local search that never waits on semantic or audio matching.
- "Best match" ranks Browse results by how well they match the search; before, it changed nothing (#1373).
- "High fidelity first" removed: it sorted on WebGPU support, which every bundled preset reports (#1373).
- Queue any preset from a Browse card or row, not only the one on stage (#1373).

Open:

- **Preview gaps.** Re-render the 193 presets listed in `preview-failures.json`.
- **Ranking inputs.** Reactivity is measured for 47 of 1,787 presets, motion for 50, and engagement for none. There is no performance-cost signal. 99 of the top 100 by `curatedRank` are uncertified.
- **Mood.** Mood comes from title keywords (`describePresetMood`). The autotagger's `category:*` tags can only be reached by typing them.
- **Visual similarity.** The finder's "look" mode embeds a text description of each frame, not the frame. Those descriptions collapse 1,786 presets into 81 distinct strings.
- **Community signals.** `setRating` has no UI, and there are no notes or glitch reports.
- **Shareable views.** A shared Browse URL keeps the collection but not the search, author, or sort.
- **Fidelity in Browse.** A fidelity sort or badge needs measurements; one preset in 1,787 has one.

Exit criteria:

- a first-time user can find a strong preset without understanding MilkDrop naming conventions. *Partly met: starter picks, collections, and search synonyms exist; there is no mood browsing and no user testing.* And
- low-confidence or expensive presets do not dominate default recommendations. *Not met: no cost signal, and almost no confidence signal.*

### Proof floor — maintained, not expanded

**The floor is not green.** The last suite run (2026-09-01) graded the 13 certified references: 1 pass, 10 fail, 2 whose reference shows no signal. The feedback clamp (#1223, 2026-09-23) landed after that run and has not been measured. `measured-results.json` (2026-07-29) still marks 250-wavecode, 300-beatdetect, and glowsticks as passing; the suite grades the first two as failing (7.38% and 5.88% against a 2% limit) and the third as no-signal. CI grades the tooling against synthetic fixtures only. Re-measuring needs a WebGPU device, which headless Chromium does not expose.

- Re-run capture, suite, and noise; demote the results the suite contradicts.
- Seed `Math.random` in the capture path, so presets like mosaics and cubetrace render the same way on every run.
- Fix renderer behavior by subsystem when measured evidence regresses: feedback orientation, shader sampling, color presentation, shapes, waves, and motion vectors.
- Promote results only after the requested backend and reference provenance are verified. The tooling enforces this; the data predates it.
- Show evidence where people choose presets. Browse shows none by design, `PresetRowRenderer`'s certified badges are dead code, and the inspector shows no measured result.
- Portrait viewports render black on WebGPU (found 2026-10-06; WebGL is unaffected).

Exit criteria:

- every featured preset has current measured evidence. *Not met: the first-run preset is uncertified, its reference shows no signal, and its WebGPU and WebGL renders differ in mean luminance (88 vs 26).*
- public compatibility wording is generated or guarded against tracked sources of truth. *Partly met: the claims guard scans the README and `docs/` but not in-app copy or `public/llms.txt`, and the catalog fidelity check trusts the stale results file.* And
- unsupported or fallback behavior is visible rather than silent. *Partly met: the 168 presets that render approximated on WebGPU get a stage chip, but nothing in Browse says so.*

### Sensory safety shield & comfort controls

The bundled corpus was imported from the community without any photosensitive-seizure review. Stims' commitment to neurodivergent stimmers requires active protection, not just passive reporting.

**What is measured.** The WCAG 2.3.1 audit (`scripts/flash-analysis.ts` + `scripts/analyze-preset-flash.ts`) has measured 40 of 1,787 presets, most recently on 2026-08-22. One of them, `beta106at-shape-mash0001-…`, measured high at about 5 flashes a second. The rest stay under threshold because MilkDrop's motion is directionally incoherent: about 14% of the field brightens while 13% darkens in the same frame, which is not the field-wide flash WCAG describes. All of those runs used the synthetic preview waveform. On 2026-10-06 the live governor, sampling at 60 Hz with real audio, caught the first-run preset (`krash-rovastar-cerebral-demons-stars`) flashing above 3 a second in bursts. Real audio and the sampling rate both matter. See [`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md#layer-0--safety-first-sample-run-complete).

Shipped:

- The flash governor checks frames against WCAG 2.3.1 and dims the stage. Before #1370 it read the canvas outside the draw, so outside agent mode it saw a blank frame on WebGPU and a dimmed one on WebGL. It now reads inside the draw, at a 60 Hz cadence whatever the display rate.
- While it dims, a "Dimming flashes" notice shows on stage. Reduce flashing can be switched from the dock menu and the command palette (#1370).
- With Reduce flashing on, shuffle and autoplay skip presets measured as flashing, as Browse already did (#1370).
- A motion dampener slider (0–100%), defaulting to 40% when the OS asks for reduced motion.
- A brightness ceiling, 30–100%.

Open:

- **Default-on.** Reduce flashing follows the OS reduced-motion setting, so it is off for most visitors. The cost that kept it opt-in is gone (#1375); see item 1 in [Up next](#up-next-in-order).
- **The shield itself.** It is a CSS brightness filter that reacts after it detects a flash, so the first one or two get through. A clamp in the shader would act before the frame is shown.
- **Calm filter.** A "Calm stimming" filter has no data to stand on: motion is measured for 50 presets and flashing for 40.
- **Room controls.** Gamma and contrast are missing; CSS has no gamma filter, so this needs an SVG filter or a shader uniform.
- **Dampener gaps.** The dampener does not reach presets whose warp shader owns the transform, or the per-pixel part of WebGPU-lowered programs.

Exit criteria:

- the audit tool's resource-exhaustion pattern is fixed and a full-corpus run completes without a large unmeasured tail. *Not met: the last local run lost 21 of 60 presets, mostly to 90-second timeouts clustered at the end. Page recycling exists but reuses one browser and context.*
- a corpus test in `tests/corpus/` continuously enforces the threshold, not just regression-tests the tool's report shape. *Not met; it would fail today on the one high-risk preset.*
- a real-time luminance clamp passes a synthetic 15Hz square-wave flash torture test with zero frames exceeding WCAG 2.3.1 thresholds. *Partly met: unit tests cover 10 Hz and 30 Hz on a 6×6 grid; none covers 15 Hz, the 16×16 grid the app uses, or the real filter in a browser.* And
- the motion dampener scales camera transforms down to full stillness without halting audio-reactive shape generation. *Mostly met: transforms come to rest at 0, but no test checks that waves and shapes still react.*

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

Open:

- **Pads and notes.** They cannot be learned, and cannot trigger actions such as next preset or blackout.
- **MIDI clock.** In/out is implemented but only tests use it.
- **Latency.** The sub-10 ms target has never been measured on a device.
- **Projector / external display window.** The second window today is a watch-party link. It boots a full session with its own audio, synced through a relay that carries only the preset id and title, so MIDI moves, edits, and crossfades never reach the audience screen. What it needs: a same-origin window that mirrors the stage canvas (the picture-in-picture path already does), with no chrome and the cursor hidden.
- **Tap tempo and phase nudge.** Missing; tempo comes only from the audio. `=` and `-` are the stage zoom and warp keys.
- **Transition shaders.** One noise dissolve. Missing: wipe, glitch, and others, on both backends.
- **Stage utilities.** Space freezes the picture. Blackout and white flash are missing, and the brightness ceiling stops at 30%. B, W, and F are taken (Browse, next waveform, full screen); D, K, and Y are free.

Exit criteria:

- WebMIDI bindings persist across browser restarts and respond with sub-10ms latency. *Persistence is met and tested; latency is unmeasured.* And
- the pop-out projector window maintains display-rate frame synchronization with zero UI chrome or cursor leaks. *Not met: there is no mirror window.*

### Dual-backend differential evidence (Closing the WebGL2 gap)

- Extend the parity diff harness (`scripts/run-parity-diff-suite.ts`) to capture and grade WebGL2 frame captures alongside WebGPU, which is currently the only judged backend.
- Grade both backends against the same contract the suite already uses: mismatch below the preset's configured `failThreshold` (`0.02` in `visual-reference-manifest.json`), outside its measured noise band, and against a reference a blank frame would not also pass.
- Eliminate the unmeasured status of the WebGL2 baseline so that fidelity claims reflect the renderer the majority of web users run.

Exit criteria:
- Every certified preset in `src/data/milkdrop-parity/visual-reference-manifest.json` possesses matching measured diff reports for both `webgpu` and `webgl` backends; and
- zero silent divergence between WebGL2 GLSL 300 es and WebGPU WGSL shader lowering.

### Close the 168-preset WebGPU shader-translation gap

Measured by `tests/corpus/butterchurn-corpus-support.test.ts` on the bundled corpus (2026-09-02): 1,578 presets are fully supported on both backends, 168 execute their shader programs directly on WebGL but fall back to extracted scalar controls on WebGPU, and 8 reference EEL identifiers the expression VM evaluates to `0`. (Was 226 / 1,521 before `mat2` element writes were let through to the WebGPU node executor, and 169 / 1,577 before `mat3`/`mat4` had a representation there.)

- ~~Resolve the packed feedback composite sampler (`sampler_fc_main` and `sampler_fw_main`) binding on WebGPU.~~ Done: both resolve to real bindings (`warpTex` / `currentTex`) end to end, covered by `tests/unit/milkdrop-shader-sampler-aliases.test.ts`. None of the remaining 168 is attributable to sampler binding.
- Lower volumetric noise (`sampler_noisevol_lq`) directly to 3D texture bindings in WebGPU, replacing the simplex-atlas approximation the WebGL preamble uses. Note the backends already differ here: `sampleNoiseVolume` slices the 2D simplex atlas on WebGL but samples the native simplex volume in the WebGPU node executor.
- ~~Give the WebGPU node executor a `mat3`/`mat4` representation.~~ Done: a mat3/mat4 is carried as its column vectors (`shaderMatrix` in `src/js/milkdrop/feedback-manager-webgpu-tsl.ts`), an element write is a swizzle on one column, products are spelled out column-major (`M * v`, `v * M`, `M * M`, `mul`, `transpose`), and shader analysis seeds each bare `matN` declaration with `matN(0.0)` so the size is known before the first write. The analysis gate now covers only writes at a runtime index, of which the corpus has none. The branch desugar masks indexed targets too, so the flag-on count went from 50 to 14; with shipped defaults only one of the 20 mat3 presets moved, because the other 19 also branch.
- Close the WebGPU executor gaps that keep the `shaderBranchDesugar` rewrite (168 → 14) behind a flag: the GPU-process crash is fixed; six presets still render white or black under the flag. They are named in `src/js/milkdrop/compiler/shader-branch-desugar.ts` together with what has been ruled out (every statement compiles; q-registers, feedback format and decay blend are shared with WebGL) and the lead to check first (`sampleNoiseVolume` samples different textures on the two backends). This needs a WebGPU device: headless Chromium exposes no adapter, so it cannot be done from a container.

Exit criteria:
- `tests/corpus/butterchurn-corpus-support.test.ts` reports 0 presets falling back to extracted scalar controls on the WebGPU path, with `fullySupported` at the full corpus count.

### Vectorized GPU compute offloading for waveforms & geometry

- Offload per-point custom wavecode generation ($4 \text{ waves} \times 512 \text{ points} = 2,048 \text{ evaluations/frame}$) from CPU JavaScript JIT to WebGPU compute storage buffers.
- Implement AST SIMD/vec4 vectorization in the WGSL generator for per-vertex grid transformations.
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

## Later: platform expansion & ecosystem

These workstreams begin only after their prerequisite user flows and proof contracts are stable.

| Workstream | Prerequisite | User Value |
| :--- | :--- | :--- |
| **Progressive Web App (PWA) Offline App** | Service worker caching, local database preset store, offline audio synthesis | Installable desktop/mobile app running anywhere with complete offline preset access. |
| **Community Catalog & Cloud Hub** | Stable preset identity, provenance, moderation, versioning, local-first storage | Public gallery to publish, discover, rate, and fork presets without filing GitHub PRs. |
| **Embeddable NPM Package (`@stims/core`)** | Decoupled renderer engine, Web Component `<stims-player>`, clean lifecycle API | Drop-in visualizer library for musicians, portfolio sites, and web audio apps. |
| **Real Stem-Aware Reactivity** | On-device WebGPU Demucs-lite or multi-band spectral isolation with fixed memory budget | Visuals reacting independently to isolated vocals, drums, basslines, and melody. |
| **Standalone Desktop Builds (Tauri)** | Native audio loopback, multi-monitor window management, local file association | Lightweight `.dmg`/`.exe` with double-click `.milk` file associations and system audio loopback. |
| **Stims-Native WebGPU Preset Lane** | Stable backend contract, performance telemetry, format validation | Next-generation preset format leveraging compute shaders, storage buffers, and 3D meshes. |
| **Multi-Display or Venue Output** | Deterministic timing, remote recovery, and a supported transport contract | Multi-screen synchronized canvases spanning broad venue projection rigs. |

## Research, not roadmap commitments

Research code may exist for these areas, but it remains labeled as scaffolding until an end-to-end product workflow and verification plan exist:

- **Syphon (macOS), Spout (Windows) & NDI Video Output**: Zero-latency GPU texture streaming into Resolume, TouchDesigner, and OBS via native sidecar or WebRTC bridges;
- **Ableton Link Protocol Sync**: Low-latency local network tempo and phase sync over WebSockets/WebRTC;
- **Art-Net / DMX Stage Lighting Bridge**: Real-time extraction of dominant color palettes and beat transients transmitted to stage DMX fixtures;
- **WebXR 360° Immersive VR Dome**: Virtual reality celestial dome projection for Meta Quest and Apple Vision Pro;
- **Neural audio-to-visual generation & Gaussian-splat rendering**; and
- **General plugin marketplace**.

AI-assisted authoring — text/image-to-preset generation, blending, and diff-inspectable assisted edits in the editor — is studio scope and already wired to the Remix workflow. It is distinct from "neural audio-to-visual generation" above, which is the unbuilt research direction.

