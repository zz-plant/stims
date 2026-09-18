# Stims product and engineering roadmap

Stims is building a browser-native studio around audio-reactive, MilkDrop-inspired presets. The roadmap prioritizes user-visible workflow improvements and measurable compatibility before speculative rendering or hardware breadth.

## Product principles

1. **Fidelity before parity claims.** Loading and compiling a preset is not proof that it looks correct.
2. **Workflow before technology badges.** WebGPU matters when it improves a measured user outcome; it is not a product promise by itself.
3. **One coherent studio.** Discovery, playback, editing, inspection, and recording should share one session.
4. **Foundations are not features.** A service class, reserved signal, or API route is not shipped until it is connected, usable, and verified.
5. **Direct formats and portable state.** Preserve `.milk` authoring and shareable session URLs rather than hiding the source format.
6. **Frictionless audio & sensory comfort are core, not afterthoughts.** Listening to music and sensory regulation are why people open Stims; audio routing and photosensitive safety must never be hidden behind external setup hoops or buried configuration.

## Current baseline

- Searchable imported preset catalog with previews, collections, favorites, queues, history, and deep links.
- Direct `.milk` import/export and a live CodeMirror authoring environment.
- WebGL2 compatibility baseline plus a guarded WebGPU execution path. Measured visual evidence is currently captured on the WebGPU path (the reference-capture backend); WebGL2 — the baseline most users actually run — lacks the same measured evidence and is tracked as a gap, not claimed.
- Multi-source browser audio with off-main-thread analysis.
- Browser canvas recording beta.
- Native projectM reference capture, provenance, image-diff, and result-promotion tooling.

See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) for file-level status and [`TECHNICAL_ACHIEVEMENTS.md`](./TECHNICAL_ACHIEVEMENTS.md) for evidence boundaries.

## Now: studio loop first, proof loop as a maintained floor

The proof loop below is a floor, not a frontier: it stays green and does not grow. New evidence infrastructure ships only when a studio workflow needs it. The immediate work is the studio loop — **browse → listen → edit → compare → save → share → record**.

### Zero-friction audio routing (Closing the capture gap)

Audio capture friction is the single largest hurdle for music listeners and creators.

- Streamline system audio capture via browser `getDisplayMedia({ audio: true })` to capture desktop, Spotify, and streaming audio with zero third-party virtual cable drivers.
- Direct URL audio streaming for YouTube and SoundCloud streams where CORS and browser permissions permit.
- Enhanced local audio player: folder drag-and-drop playlist ingestion, ID3 metadata/artwork display, waveform seek bar with beat markers, and shuffle/repeat modes.
- Visual microphone calibrator: live input VU meter, adjustable gain, noise gate, and ambient room frequency profile compensation.

Exit criteria:

- a user can start visualizing their system audio or a local playlist within 2 clicks from first visit without external software.

### Remix studio & shader live-coding

- Add dependable undo/redo and named snapshots.
- Provide side-by-side or rapid A/B comparison against the source preset (`Cmd/Ctrl+Shift+B`).
- Live variable watcher HUD: real-time oscilloscope plotting for selected variables (`q1-q32`, `warp`, `zoom`, `rot`, `dx`, `dy`, custom vars).
- Direct WGSL/GLSL shader tab allowing modern compute/fragment shader authoring alongside classic EEL2 equations.
- Custom texture drag-and-drop: import user PNG/JPG sprites and feedback textures directly into the preset workspace.
- Record remix provenance and retain source in exported `.milk` files or companion metadata.
- Make generated or assisted edits inspectable as source diffs before application.
- Add a share format that preserves the preset or a stable community identifier without requiring an account for local work.

Exit criteria:

- browse → edit → compare → save → share works without leaving the running session; and
- variable watch graphs update at delivered display frame rates without hitching the main JS thread.

### Creator-grade export & vertical formats

- Harden the native renderer-resize and active-audio composition paths now implemented for recording.
- Portrait and social aspect ratios: one-click render modes for 9:16 (1080×1920 for TikTok/Reels/Shorts) and 1:1 square with non-distorting coordinate projection.
- Transparent background alpha channel export (`WebM with alpha` / `ProRes 4444`) for video editors overlaying visualizers on DJ footage.
- On-screen track title & artwork overlay: customizable lower-third typography badge rendered directly into video frames.
- Seamless video loop generator: export exact 15s and 30s seamless looping clips for Spotify Canvas and VJ banks.
- Add deterministic frame pacing and loop-duration controls.
- Verify codec, aspect-ratio, duration, and frame-count output in browser-backed tests.
- Keep the existing `MediaRecorder` path as a clearly labeled compatibility fallback.

Exit criteria:

- "1080p", "4K", and "9:16 Vertical" describe measured render output rather than canvas container dimensions; and
- exported audio-video files remain synchronized over a documented test duration without dropped frames.

### Make the large catalog useful

- Improve preview reliability and cold-load behavior.
- Rank by visual quality, evidence, performance, author, mood, and session relevance instead of relying on preset count.
- Smart playlists & mood tagging: "Chill Ambient", "Hypnotic Fractals", "High-Energy DnB", "90s Cyber Retro".
- Visual similarity search: find presets that match color distribution and motion dynamics using frame embeddings.
- Community feedback: user upvoting, bookmarks with personal notes, and one-click glitch reporting.
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

### Sensory safety shield & comfort controls

The bundled preset corpus was imported from the community without any photosensitive-seizure safety review. Stims' core commitment to neurodivergent stimmers requires active protection, not just passive reporting. A real WCAG 2.3.1-grounded measurement tool now exists (`scripts/flash-analysis.ts` + `scripts/analyze-preset-flash.ts`, unit-tested, corpus-sampling built in) alongside the earlier placeholder-threshold tool (`bun run lab:flash-risk`). Sample runs report zero presets over threshold, and that zero has since been *explained* rather than left ambiguous: stage-by-stage measurement on rendered output confirmed capture sees full-amplitude change, the area floor is genuinely crossed (26.8–29.7% of a 10° window), and what stops a flash registering is directional incoherence — ~14% of the field brightening while ~13% darkens in the same frame. MilkDrop's texture-in-motion aesthetic does not produce the coherent field-wide oscillation WCAG's general flash threshold describes. The WCAG red-flash criterion is now implemented and unit-tested (`flash-analysis.ts`), but not yet run at corpus scale. One gate remains before this is a safety claim: every measurement used the synthetic preview waveform rather than real high-energy audio. See [`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md#layer-0--safety-first-sample-run-complete).

- Active real-time photosensitive seizure shield: post-processing shader clamp that suppresses luminance oscillation faster than 3Hz, guaranteeing WCAG 2.3.1 compliance across any preset.
- Universal motion & velocity dampener slider (0%–100%) to scale down rotation, zoom, and warp speed for motion-sickness or vestibular sensitivity.
- Curated "Calm Stimming" catalog filter: smooth fluid dynamics, soft pastel transitions, and zero rapid strobing.
- Dark-room viewing controls: global canvas brightness, gamma, and contrast dimmers.
- Default-on flash-rate cap surfaced as a visible, persistent safety control, not a buried setting.

Exit criteria:

- the audit tool's apparent resource-exhaustion pattern (timeouts clustering late in a long run) is fixed and a full-corpus run completes without a large unmeasured tail;
- a corpus test in `tests/corpus/` continuously enforces the threshold, not just regression-tests the tool's report shape;
- real-time luminance clamp passes synthetic 15Hz square-wave flash torture test with zero frames exceeding WCAG 2.3.1 thresholds; and
- motion dampener scales camera transforms down to full stillness without halting audio-reactive shape generation.

## Next: compatibility depth & runtime compiler milestones

These deepen the compatibility lane, compiler runtime, and live-performance capabilities. Each item names the measurement it moves; where a count appears, it is the one the cited test or data file reports today.

### Live performance, VJing & hardware control

- WebMIDI controller mapping with interactive "MIDI Learn" mode: map physical knobs, faders, and pads to preset variables (`zoom`, `warp`, `decay`, `rot`).
- Dedicated projector / external display window: pop out a clean, borderless fullscreen canvas window for secondary monitors or projectors while retaining controls and editor on primary display.
- Live BPM tap tempo and manual phase nudge keys (`+`/`-`) to synchronize visual pulsing to live drummers or DJs.
- DJ-style preset crossfader (A/B deck blending) with customizable transition shaders (wipe, blend, glitch, dissolve).
- Emergency stage utilities: single-key Blackout (`B`), White Flash (`W`), and Visual Freeze (`F`).

Exit criteria:

- WebMIDI bindings persist across browser restarts and respond with sub-10ms latency; and
- pop-out projector window maintains display-rate frame synchronization with zero UI chrome or cursor leaks.

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

