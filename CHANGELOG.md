# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

_Current release status: actively developed. Latest release: **v1.3.0**._

## [Unreleased]

### Added

- Pause. Space and the dock's transport button hold the picture and release it; the preset, history and audio session stay put. Stopping audio — which unmounts the engine and returns to the start page — moves to the menu as "Stop audio and go back to start". `EngineSnapshot.playbackPaused` and `__stims_agent.getState().playbackPaused` expose the state; `toggle-playback` is the palette action.
- The preset-tuning keys are listed, rebindable and announced: H (blend/cut), W / Shift+W (waveform), I / Shift+I (zoom), O / Shift+O (warp), J / Shift+J (wave scale), `<` / `>` (rotation) are registry bindings dispatching `nudge-*`, `wave-mode-*` and `toggle-transition-mode` palette actions (`frontend/preset-nudges.ts`), each reporting the value it landed on. They replace the MilkDrop runtime's document-level key handler (`ui-bridge.ts`), a leftover of the standalone overlay that in the shell was undocumented and reported only to the agent debug snapshot. Q (echo zoom) is not carried over — the canvas holds Q as a performance key — and R, which duplicated N, is free; Backspace stays as an alias of Previous.
- Quick-select shows its numbers: the first nine cards in Browse wear the digit that plays them (and `aria-keyshortcuts`), the shortcut reads the same list the panel is showing, and with Browse closed the digits say to open it instead of playing an unpredictable preset.

- Virtual time for deterministic visual captures: `animation-loop.ts` exposes a controllable `virtualTimeSource`, and the capture script plus visual-regression e2e drive it so single-frame comparisons stop drifting on phase (`0951a1a9`).
- WebGPU timestamp profiler and temporal reconstruction (`e76d092c`).
- Hermite-spline audio reactivity interpolation (`f8b9ba56`), continuous dynamic-resolution scaling with an accumulator, and CAS sharpening (`fb72fa4d`).
- Per-frame `q`-registers in GPU field programs (`b93d1adf`), extended shader intrinsics and metadata (`0a5726f4`).
- Audio search now feeds real spectral bands, and presets are described by how they look rather than what they are called (`29afa912`, `4c44533e`).

### Changed

- Stage dock: the bar stays up while a pointer rests on it or focus is inside it (it faded out from under the cursor after three still seconds), and the "Controls" reveal handle no longer paints over the title while focus holds the bar. The transition control opens the ladder as a popover and prints the engine's actual value instead of cycling four states and rounding to the nearest rung. The overflow menu is two columns from 640px up, with Settings and the command palette leading their group — as one column of 26 items it scrolled at every common desktop height with those two last. On touch the primary Prev/Next buttons are 44px like everything else (a specificity bug held them at 38), and at ≤480px the bar drops Save and Full screen so the preset title gets ~150px rather than "K.."; Save gains a menu row and both keep their stage gestures.
- Scrolling over the stage only nudges the visuals; changing the preset by scroll now needs Shift, since a trackpad flick with momentum cleared the old 120px threshold on its own.
- The first-run hint names Space and `?`; the drag hint fires on the first drag of any preset rather than on presets that read interaction signals (0 of the bundled catalog).
- `mat2` element writes in a native `shader_body` now execute directly on WebGPU: the analysis gate that sent every matrix element write to the uniform-only approximation is narrowed to `mat3`/`mat4`, the only sizes the node executor cannot represent. 57 bundled presets move off the approximation (WebGPU shader-translation gap 226 → 169; fully supported on both backends 1521 → 1577).
- `mat3`/`mat4` element writes execute directly on WebGPU as well: the node executor carries a mat3/mat4 as its column vectors, so `M[int(0)].x = q20` is a column swizzle and `(p / q7) * M`, `M * v`, `M * M`, `mul(...)` and `transpose(...)` are spelled out column-major. Shader analysis seeds every bare `matN` declaration with `matN(0.0)` so the executor knows the size before the first element write, and the analysis gate now covers only writes at a runtime index (the corpus has none). Runtime-index matrix and vector reads (`mat4(...)[int(mod(p.y, 4.0))][int(mod(p.x, 4.0))]`) go through element access instead of dropping the statement, initialized matrix declarations (`mat3 m = mat3(1.0)`) parse as the assignment they carry, and a compound element write (`M[0] += v`) reads the previous column out of the stored matrix. The branch desugar masks indexed targets too, so a mat2 column write under an `if` no longer sends the whole body to the approximation. With shipped defaults the WebGPU shader-translation gap moves 169 → 168 (19 of the 20 mat3 presets also branch); with `shaderBranchDesugar` on it moves 50 → 14 and fully-supported 1693 → 1729.
- The WebGPU node executor now binds MilkDrop per-frame registers a shader body reads without assigning (`tele`, `hordist`, `blur1_min`, …) as uniforms driven from the VM frame state, as the WebGL path already did with `uniform float` declarations. Reads of such names used to compile to nothing and silently dropped the statement and everything downstream of it (8 bundled presets, 3 of them among the `mat2` bodies above).
- Bounded every growth path the `#1105`–`#1111` series touched: compiled-preset cache warmup, preset preview cache, idle renderer pool retention, source-diff memory, and offscreen shader identicons (`a63a1dda`, `12bd38be`, `663df8c8`, `fed4a2bb`, `9cf158e4`).
- Coalesced stage-control activity and optimized preset stage transitions (`4d046c3d`, `d7f2e5a8`); removed redundant layers (`b28b4aa9`).

### Fixed

- A corpus-wide black/white/flat-frame sweep of the 1,787 bundled presets (WebGPU verified at 10–13 s, WebGL on the flagged set) found 342 broken; the causes with a compile-level signature are fixed here. Custom-wave per-point code that writes `dx`/`dy`/`zoom` no longer lowers to an undeclared `fieldTranslateX` in the wave's WGSL (31 presets rendered nothing and logged `unresolved value`); a negative `zoom` keeps its sign through every path — CPU mesh, WGSL transform, TSL blend and the WebGL warp — so MilkDrop's `zoom = -1` point mirror works instead of collapsing onto the centre pixel (23 presets); the runtime-selected warp/overlay texture path no longer binds all eight noise volumes into every pipeline, and the device asks for the sampled-texture limit the adapter offers, so presets that bind 17 textures composite again (14 presets); HLSL `normalize(float)` lowers to `sign()` instead of an invalid WGSL vector normalize (4 presets); the WebGPU per-pixel compiler knows NS-EEL `equal()`, `sqr()`, `bnot()`, `band()` and `bor()` instead of dropping every statement using them (306 presets carried such code) and the drop warning now names the call; and converted Butterchurn bodies whose `int` loop counters lost their declarations are hoisted as `int`, not `float`, so they compile on WebGL (4 presets).
- Live editor field writes no longer silently no-op (`37c5a0fa`).
- Preset transitions no longer invalidate the frame's WebGPU command buffer (`2528bfa7`).
- Removed duplicate `.milk` files and normalized Geiss/Aderrasi catalog metadata (`7cc92dae`); search index re-embeds presets whose description changed (`03ba5f93`).
- Stopped three tests failing on the CI runner and nowhere else (`900a3617`).

### Planned — studio first, parity as a floor

- **Remix studio**: dependable undo/redo and named snapshots, side-by-side A/B against the source preset, remix provenance retained in exported `.milk`.
- **Creator-grade export**: deterministic frame pacing, loop-duration controls, and codec/AV-sync verification for 1080p and 4K recording.
- **Live EEL preset editor** with real-time expression AST diagnostics.
- Parity stays a maintenance floor, not a frontier: projectM WebGPU compute-shader lowering and the AudioWorklet analyzer migration proceed only as they serve the compatibility labels and recording path above.

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

[Unreleased]: https://github.com/zz-plant/stims/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/zz-plant/stims/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/zz-plant/stims/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/zz-plant/stims/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/zz-plant/stims/releases/tag/v1.0.0
