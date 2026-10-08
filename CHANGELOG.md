# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

_Current release status: actively developed. Latest release: **v1.4.0**._

## [Unreleased]

### Added

- The Release workflow can be run from the Actions tab on `main`, for anyone who cannot push tags: it tags a commit on `main` (by default its head) as `v<that commit's package.json version>` and publishes the same notes a tag push would. It refuses a commit that is not on `main`, or a tag that already points at another commit.
- The Tune pane says which audio drives each control. When the preset's equations recompute a field, its chip names the signals that reach it (`eq · bass`, all of them in the tooltip and accessible name), or says no audio does. It reads the static dataflow analysis (`src/js/milkdrop/preset-dataflow.ts`) of the compile on stage. So it follows a signal through `q` variables, persistent state and per-pixel equations, works before any music plays, and reruns only when the equations change (`dataflowSignature()`), not on every fader move.
- A Tune fader whose field the per-frame code recomputes shows the value the frame used, as a tick on its track beside the base value the fader holds. The tick follows the running preset only while Tune is on screen and some fader has a tick. A field per-pixel code varies across the mesh gets none, since no single number is what was drawn.
- Outline rows say which audio reaches what each drawn part draws: the per-pixel equations and every enabled custom wave and shape (`bass +1`, or `no audio`). The answer comes from the same dataflow analysis as the Tune chips. A wave whose code reads no audio makes no claim, because its points sit on the waveform unless its code moves them.
- Solo and Mute in the Outline now cover the main waveform, the borders and the motion vectors as well as custom waves and shapes. Each layer gets a row under Settings when the preset draws it, at a visible base value or through an equation. Soloing any element now hides those layers too, so what remains is that element over the warped feedback.
- Each custom wave and shape has its own controls in Tune. Pick one in the pane's wave-or-shape picker, or press Tune on its Outline row. Its switches (draw, additive, thick, textured or spectrum and dots), colours and faders (sides, radius, position and angle; samples, scaling and smoothing) use the same widgets as the rest of the pane, and each move is a line in the draft. The `eq` chip on each control reads that slot's own code, so `x = …` in `shape_1_per_frame1` marks shape_1's X as recomputed. A field is found under whichever spelling the preset uses (`wavecode_0_bDrawThick` or `wavecode_0_thick`), and its own line is rewritten rather than a second one added.
- MCP tool `get_audio_reactivity_guide` (stdio and Worker) explains how presets read `bass`/`mid`/`treb`, their `_att` versions and `vol`, and names the `lab:dataflow` and `lab:reactivity` commands that check a preset. Given a `presetId`, it adds that preset's audio reach and measured reactivity from the catalog. `docs/ARCHITECTURE.md` and the authoring reference and listening chapter are now readable through `read_doc_section`.

### Changed

- Every public surface now tells the same story about what Stims is and what is new in it. [`docs/LINEAGE_AND_CREDITS.md`](./docs/LINEAGE_AND_CREDITS.md#what-stims-contributes) states the three contributions: per-pixel equations on the GPU, held to the CPU's answer by differential fuzzing; fidelity measured against native projectM; and the preset corpus analysed as programs. The README, both `llms` files and the comparison page repeat them. Running presets in a browser (Butterchurn was first) and editing them live (MilkDrop 2 had an editor) are no longer presented as new.
- `llms.txt` and `llms-full.txt` drop the "high-performance" and AI-first framing, the `?tweak=` flag and `toil:apply_tweak` message (neither does anything), and catalog fields that do not exist; the model-backed API routes are marked optional. The home screen's tagline names MilkDrop, the MCP endpoint stops calling itself "Stim Webtoys", and "MilkDrop-inspired" is gone from the docs.
- The compiler case study is deleted: its IR type, JIT output and WGSL kernel were invented, it described a dead-store pass that does not exist, and it credited the browser MilkDrop to a WebAssembly projectM port instead of Butterchurn. Its accurate parts are in [`docs/TECHNICAL_ACHIEVEMENTS.md`](./docs/TECHNICAL_ACHIEVEMENTS.md), which also now says the per-frame compute VM is off by default and documents the corpus analysis.
- The start page's tagline and explainer say what you can do with a preset: play it, see what moves it, and change it while it plays. `/learn/milkdrop-online/` drops "Winamp's Visualizer in Your Browser" from its title, which `docs/LINEAGE_AND_CREDITS.md` asks public copy to avoid, and the agent instructions under `.github/` drop "MilkDrop-inspired".
- Docs pages no longer open by narrating themselves: sentences like "This document describes…" are removed where the title, outline, or a table's header row already says it (24 pages across `docs/` and `CONTRIBUTING.md`); where an opener mixed narration with substance, the substance stays. The rule is recorded in `docs/DOCS_MAINTENANCE.md`.

### Removed

- **Breaking for MCP clients:** the tools left over from the toy library. They described a one-entry registry and a loader that no longer exists. Calling one now returns an unknown-tool error. Replacements:
  - `get_toys` → `list_presets` / `get_preset_info`.
  - `launch_toy` → `open_preset_url`; pass `baseUrl` to target a local dev server.
  - `get_toy_audio_reactivity_guide` → `get_audio_reactivity_guide`.
  - `describe_loader` → `read_doc_section` on `docs/ARCHITECTURE.md` ("App bootstrap").
  - `capture_toy_screenshot`, `test_toy_interactivity`, `get_toy_health` (stdio only) → `capture_preset`, which now lists the page's console errors on success and on failure.
- `src/data/toys.json`, which nothing reads once those tools are gone. The sitemap's MilkDrop image title is now a constant in `scripts/generate-seo.ts`, and the Vite build no longer derives inputs from it.

### Fixed

- A `?preset=` page names its preset. Below the stage, in normal flow, it shows the preset's name as the page's one h1, its author (linked to the author page where one exists), more presets by the same author, and the topic hubs. Search engines render the page and skip `<noscript>`, which held the only copy of this content, so the sitemap's preset URLs read as one page under the heading "Stims visualizer". The edge now writes its no-JavaScript copy into one `<noscript>` instead of all four in the shell, and both copies come from `functions/shared/preset-page.ts`.
- `/author/<slug>` and `/discover/<slug>` pages name their collection in the h1 ("Geiss MilkDrop Presets") instead of the home page's headline, for returning visitors too.
- Presets in Browse (grid tiles, list rows, the recently-played rail and the remix family) are links to their `?preset=` pages, so crawlers on the hub pages can follow them and a preset opens in a new tab with a modifier click. A plain click still switches presets in place.
- A preset credited to a chain such as "Stahlregen + Geiss" links each hand in its byline to that hand's author page. Its related presets come in one group per hand, drawn from the presets crediting that hand, the rule the author pages already use.

### Planned — studio first, parity as a floor

- **Remix studio**: dependable undo/redo and named snapshots, side-by-side A/B against the source preset, remix provenance retained in exported `.milk`.
- **Creator-grade export**: deterministic frame pacing, loop-duration controls, and codec/AV-sync verification for 1080p and 4K recording.
- Parity stays a maintenance floor, not a frontier: projectM WebGPU compute-shader lowering and the AudioWorklet analyzer migration proceed only as they serve the compatibility labels and recording path above.

## [1.4.0] - 2026-10-01

### Added

- Pushing a `vX.Y.Z` tag publishes a GitHub Release: `.github/workflows/release.yml` runs `bun run release:notes`, which takes that version's section of `docs/RELEASE_NOTES.md` and refuses a tag that disagrees with `package.json` or has no notes. Versions 1.1.0 through 1.3.0 were written up but never tagged, so none of them appeared on the repo page.
- Pause. Space and the dock's transport button hold the picture and release it; the preset, history and audio session stay put. Stopping audio — which unmounts the engine and returns to the start page — moves to the menu as "Stop audio and go back to start". `EngineSnapshot.playbackPaused` and `__stims_agent.getState().playbackPaused` expose the state; `toggle-playback` is the palette action.
- The preset-tuning keys are listed, rebindable and announced: H (blend/cut), W / Shift+W (waveform), I / Shift+I (zoom), O / Shift+O (warp), J / Shift+J (wave scale), `<` / `>` (rotation) are registry bindings dispatching `nudge-*`, `wave-mode-*` and `toggle-transition-mode` palette actions (`frontend/preset-nudges.ts`), each reporting the value it landed on. They replace the MilkDrop runtime's document-level key handler (`ui-bridge.ts`), a leftover of the standalone overlay that in the shell was undocumented and reported only to the agent debug snapshot. Q (echo zoom) is not carried over — the canvas holds Q as a performance key — and R, which duplicated N, is free; Backspace stays as an alias of Previous.
- Quick-select shows its numbers: the first nine cards in Browse wear the digit that plays them (and `aria-keyshortcuts`), the shortcut reads the same list the panel is showing, and with Browse closed the digits say to open it instead of playing an unpredictable preset.

- Virtual time for deterministic visual captures: `animation-loop.ts` exposes a controllable `virtualTimeSource`, and the capture script plus visual-regression e2e drive it so single-frame comparisons stop drifting on phase (`0951a1a9`).
- WebGPU timestamp profiler and temporal reconstruction (`e76d092c`).
- Hermite-spline audio reactivity interpolation (`f8b9ba56`), continuous dynamic-resolution scaling with an accumulator, and CAS sharpening (`fb72fa4d`).
- Per-frame `q`-registers in GPU field programs (`b93d1adf`), extended shader intrinsics and metadata (`0a5726f4`).
- Audio search now feeds real spectral bands, and presets are described by how they look rather than what they are called (`29afa912`, `4c44533e`).

### Changed

- One public pitch, "Play and live-edit MilkDrop presets in your browser", replaces "MilkDrop-inspired" in the page title, social and oEmbed metadata, shared-preset link previews, the share sheet text and the sitemap. It says what Stims does with the presets (they are the original `.milk` files) without claiming to be MilkDrop, and it drops "Winamp's MilkDrop, in your browser", which `docs/LINEAGE_AND_CREDITS.md` already asked public copy to avoid.
- The README is less than half its old length: the pitch, four larger clips, a short comparison with the compatibility numbers a CI test pins, how the code is laid out, and how to start. The system diagram and the engineering detail it carried moved to `docs/TECHNICAL_ACHIEVEMENTS.md`; the frame-cost benchmark was already in `docs/RUNTIME_PERFORMANCE.md`.
- Removed 130 MiB from the working tree: `bin/stims-ctl` (the 60 MiB `ctl:compile` binary, now ignored), `output/` (60 MiB; already ignored, but 197 files were committed anyway), the four README clips the page no longer shows, and four unreferenced leftovers (`audit-input-blocking.ts`, `src/stims-demo.gif`, `test-screenshots/`, a `.sisyphus/` session file).
- Stage dock: the bar stays up while a pointer rests on it or focus is inside it (it faded out from under the cursor after three still seconds), and the "Controls" reveal handle no longer paints over the title while focus holds the bar. The transition control opens the ladder as a popover and prints the engine's actual value instead of cycling four states and rounding to the nearest rung. The overflow menu is two columns from 640px up, with Settings and the command palette leading their group — as one column of 26 items it scrolled at every common desktop height with those two last. On touch the primary Prev/Next buttons are 44px like everything else (a specificity bug held them at 38), and at ≤480px the bar drops Save and Full screen so the preset title gets ~150px rather than "K.."; Save gains a menu row and both keep their stage gestures.
- Scrolling over the stage only nudges the visuals; changing the preset by scroll now needs Shift, since a trackpad flick with momentum cleared the old 120px threshold on its own.
- The first-run hint names Space and `?`; the drag hint fires on the first drag of any preset rather than on presets that read interaction signals (0 of the bundled catalog).
- `mat2` element writes in a native `shader_body` now execute directly on WebGPU: the analysis gate that sent every matrix element write to the uniform-only approximation is narrowed to `mat3`/`mat4`, the only sizes the node executor cannot represent. 57 bundled presets move off the approximation (WebGPU shader-translation gap 226 → 169; fully supported on both backends 1521 → 1577).
- `mat3`/`mat4` element writes execute directly on WebGPU as well: the node executor carries a mat3/mat4 as its column vectors, so `M[int(0)].x = q20` is a column swizzle and `(p / q7) * M`, `M * v`, `M * M`, `mul(...)` and `transpose(...)` are spelled out column-major. Shader analysis seeds every bare `matN` declaration with `matN(0.0)` so the executor knows the size before the first element write, and the analysis gate now covers only writes at a runtime index (the corpus has none). Runtime-index matrix and vector reads (`mat4(...)[int(mod(p.y, 4.0))][int(mod(p.x, 4.0))]`) go through element access instead of dropping the statement, initialized matrix declarations (`mat3 m = mat3(1.0)`) parse as the assignment they carry, and a compound element write (`M[0] += v`) reads the previous column out of the stored matrix. The branch desugar masks indexed targets too, so a mat2 column write under an `if` no longer sends the whole body to the approximation. With shipped defaults the WebGPU shader-translation gap moves 169 → 168 (19 of the 20 mat3 presets also branch); with `shaderBranchDesugar` on it moves 50 → 14 and fully-supported 1693 → 1729.
- The WebGPU node executor now binds MilkDrop per-frame registers a shader body reads without assigning (`tele`, `hordist`, `blur1_min`, …) as uniforms driven from the VM frame state, as the WebGL path already did with `uniform float` declarations. Reads of such names used to compile to nothing and silently dropped the statement and everything downstream of it (8 bundled presets, 3 of them among the `mat2` bodies above).
- Bounded every growth path the `#1105`–`#1111` series touched: compiled-preset cache warmup, preset preview cache, idle renderer pool retention, source-diff memory, and offscreen shader identicons (`a63a1dda`, `12bd38be`, `663df8c8`, `fed4a2bb`, `9cf158e4`).
- Coalesced stage-control activity and optimized preset stage transitions (`4d046c3d`, `d7f2e5a8`); removed redundant layers (`b28b4aa9`).

### Fixed

- oEmbed titles name a preset's author once. `functions/api/oembed.ts` used the raw catalog title, which already leads with the author, next to its own byline ("Krash & Rovastar - Cerebral Demons (Stars Remix) by Krash & Rovastar"); it now formats titles with `presentTitle()`, as the link-preview middleware does.
- The keyboard is no longer treated as a TV remote on every page. `gamepad-navigation.ts` handled arrow keys, Enter and Backspace/Escape as D-pad input wherever it was installed — so on a desktop each → that changed the preset also walked DOM focus one element along (from the stage, which is not in the focusable list, that meant the skip link, left sitting visible over the visuals), and each Backspace re-dispatched a synthetic Escape that closed whatever panel was open. Keyboard-as-remote is now an explicit option, on only for smart-TV / leanback devices; real gamepads are polled as before.
- Closing a panel no longer reverts a preset change committed in the same tick. `updatePanel`, `handlePresetSelection`, `handleBrowseRecovery` and `handleAudioStop` spread the `routeState` their render captured, rewriting every other field to that render's values; `commitRoute` takes an updater and each changes only what it owns. With the point above this was Backspace in Browse: the previous preset, the panel closing, and the preset put straight back as a 2.5 s blend of itself.
- The quick-select digits are worn only while they answer. Opening Browse focuses the search field, where a digit is a search; the badges showed regardless, so pressing 1 wrote "1" into the query and filtered the list. They hide while the field has focus and return the moment focus leaves it; the shortcut listing says so.
- The transition is reported one way. The product default (2.5 s) is now a rung of the dock ladder (Cut / 1 s / 2.5 s / 5 s) and of the Settings list; before, a fresh visitor read "2.5s" on the pill, nothing marked in the popover (exact match), and "2s" marked in the overflow menu (nearest match). Both ladders mark by the same exact rule, and an off-ladder Settings value is printed on the menu's group label, which on a phone is the only place the transition is shown. The palette action is `transition-2.5s` (was `transition-2s`).
- One status channel no longer silences the other. The toast hook picked `statusMessage ?? runtime.status`, and the shell's status line is sticky, so a single Space press ("Paused…", "Resumed.") shadowed every runtime line for the rest of the session — no "Loaded <preset>", no blend refusal, no shader-approximation notice. Each channel now shows when it changes; a repeated runtime status still shows once, and pausing twice says "Paused" twice.
- The status toast no longer paints over the Cue deck card. The card announces that it holds the bottom of the screen, the same signal the sheets and the stage menu already send, so toasts dodge upward while it is up. The two returning-visitor cards — Perform and the Cue deck — also take turns instead of appearing together in opposite corners: the cue deck waits until the Perform card has been dismissed or something has been pinned (`frontend/stage-hint-cards.ts`).
- A paused stage keeps its transport up. The dock faded three seconds after Space, leaving a frozen frame under a "Controls" handle — the same picture as a hung renderer — and the audio-status button still claimed "the visuals are reacting". The bar now holds while paused, and the button says the picture is held.
- A second catalog copy of the same work is not listed as a relative: `goody-need` and `cotc-goody-need` share a title, and the lineage section read "1 more in the Need family" over two identical "the original" rows. Same-work duplicates collapse, keeping the copy on stage.
- The Browse hint reads "Click a card to play it" on non-touch devices; "Tap" was the only variant.
- A corpus-wide black/white/flat-frame sweep of the 1,787 bundled presets (WebGPU verified at 10–13 s, WebGL on the flagged set) found 342 broken; the causes with a compile-level signature are fixed here. Custom-wave per-point code that writes `dx`/`dy`/`zoom` no longer lowers to an undeclared `fieldTranslateX` in the wave's WGSL (31 presets rendered nothing and logged `unresolved value`); a negative `zoom` keeps its sign through every path — CPU mesh, WGSL transform, TSL blend and the WebGL warp — so MilkDrop's `zoom = -1` point mirror works instead of collapsing onto the centre pixel (23 presets); the runtime-selected warp/overlay texture path no longer binds all eight noise volumes into every pipeline, and the device asks for the sampled-texture limit the adapter offers, so presets that bind 17 textures composite again (14 presets); HLSL `normalize(float)` lowers to `sign()` instead of an invalid WGSL vector normalize (4 presets); the WebGPU per-pixel compiler knows NS-EEL `equal()`, `sqr()`, `bnot()`, `band()` and `bor()` instead of dropping every statement using them (306 presets carried such code) and the drop warning now names the call; and converted Butterchurn bodies whose `int` loop counters lost their declarations are hoisted as `int`, not `float`, so they compile on WebGL (4 presets).
- Live editor field writes no longer silently no-op (`37c5a0fa`).
- Preset transitions no longer invalidate the frame's WebGPU command buffer (`2528bfa7`).
- Removed duplicate `.milk` files and normalized Geiss/Aderrasi catalog metadata (`7cc92dae`); search index re-embeds presets whose description changed (`03ba5f93`).
- Stopped three tests failing on the CI runner and nowhere else (`900a3617`).

## [1.3.0] - 2026-07-29

### Added

- Preset equations restored across the bundled butterchurn corpus. `scripts/butterchurn-eel-transpiler.ts` converts upstream JavaScript equation strings back to MilkDrop EEL, writing canonical `.milk` output (`per_frame_N`, `per_pixel_N`, `wave_N_per_pointM`, `shape_N_per_frameM`, `wavecode_N_*`, `shapecode_N_*`). 157,950 statements recovered; 1629 presets gained per-frame code and 1068 gained per-pixel code (1739 presets now compile clean).
- Custom shape instancing (`shapecode_N_num_inst`): per-frame shape code now runs once per instance with `instance` and `num_inst` in scope. 304 bundled presets declare multi-instance shapes and 232 vary geometry by `instance`.
- `randint`, `log10`, and `gmegabuf` functions added to the preset expression language engine.
- `EngineSnapshotCtx` with `useEngineSnapshot()` hook for frame-accurate state without re-rendering the full UI tree.
- Performance controls with persistent pixel ratio, particle budget, and shader-quality presets.

### Changed

- Console-style settings, browse drawer, and dock redesigned (`redesign(chrome): console-style settings, browse, and dock`).
- VM program blocks compile to one JavaScript function each instead of one per statement, reducing VM CPU cost from 2.00 ms/frame to 1.10 ms/frame.
- Compute VM readback buffer reuse and signal array packing optimized in WebGPU backend (`perf(webgpu)`).
- Fullscreen rendering quality and refresh targets optimized for mobile hardware (`perf(mobile)`).
- Centralized URL override handling and sanitized storage access helper (`refactor(core)`).
- Custom shape radius floor lowered from 0.04 to 0.002 so MilkDrop instanced dot fields remain accurately sized.

### Fixed

- Mesh transform cache removed: it quantized coordinates to 1/2048, so distinct points collided onto one key and a motion-vector point could receive a mesh vertex's transform from the opposite edge of the screen — four vectors per frame drawn ~2.0 NDC out of place. It served ~86 of ~24,320 transform calls per frame while every per-pixel preset paid a key computation, pool bump and `Map.set` on all ~1764 vertices (`fix(milkdrop)`).
- **Correction to `0eb14b23`:** that commit's message claims its per-vertex hoist was bit-exact. Later verification with fixtures that genuinely emit motion vectors found one branch — no per-pixel program, legacy `mv_dx`/`mv_dy`, direct path (≤288 cells) — where four vectors per frame differed. The change was in fact a partial *fix* for the cache-collision bug above rather than a no-op, and no shipped preset reached that branch (all 1,782 swept). The cache removal supersedes it.
- Enhanced microphone permission error guidance and fallback device error handling (`fix(audio)`).
- Microphone capture behavior repaired on mobile browsers (`fix(audio)`).

## [1.2.0] - 2026-07-24

### Added

- HUD spectrum display and audio signal caching for stage visualizer (`b307dab7`, `cb1aea17`).
- Structured test suite directory organization (`tests/unit/`, `tests/e2e/`).

### Changed

- Refactored test discovery harness to derive test profiles from category subfolders (`tests/unit/`, `tests/e2e/`).
- Extracted `test-utils` leaf module and eliminated runtime barrel imports in unit tests.
- Re-architected application shell and extracted workspace UI modules into `AudioSourcePanel`, `BrowseSheetPanel`, and `SettingsSheetPanel`.

### Fixed

- Fixed route-driven demo audio playback race condition when launching visualizer toys (`067bc32e`).
- Corrected microphone e2e assertion constraints for CI test harness (`4a4fd3b7`).

## [1.1.0] - 2026-07-19

### Added

- Native MilkDrop parity bridge (`3cfb5d7a`) supporting classic MilkDrop shader mechanics and preset states.
- Dedicated shell theme and launch style layers (`a7698c11`).

### Changed

- Enhanced high-contrast color scheme for light shell theme to improve accessibility (`b611b886`).
- Optimized fullscreen edge-to-edge layout on mobile viewports (`a44e343d`).
- Wave and mesh hot-path allocations optimized via buffer pooling in VM executor (`b2f99ab4`).

### Fixed

- Corrected MilkDrop native 3D noise texture axis ordering (`5ced82f3`).
- Resolved collection tag filtering and search bugs in MilkDrop preset browser (`226d7812`).

## [1.0.0] - 2025-02-04

### Added

- Initial release of the Stim Webtoys Library featuring [Aurora Painter](./toy.html?toy=aurora-painter), [Defrag Visualizer](./toy.html?toy=defrag), [Multi-Capability Visualizer](./toy.html?toy=multi), and [Audio Light Show](./toy.html?toy=lights).
- Core execution engine supporting Vite build, preview, Bun runtime, and test execution.

[Unreleased]: https://github.com/zz-plant/stims/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/zz-plant/stims/releases/tag/v1.4.0
[1.3.0]: https://github.com/zz-plant/stims/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/zz-plant/stims/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/zz-plant/stims/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/zz-plant/stims/releases/tag/v1.0.0
