# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

_Current release status: actively developed. Latest release: **v1.3.0**._

## [Unreleased]

### Added

- Virtual time for deterministic visual captures: `animation-loop.ts` exposes a controllable `virtualTimeSource`, and the capture script plus visual-regression e2e drive it so single-frame comparisons stop drifting on phase (`0951a1a9`).
- WebGPU timestamp profiler and temporal reconstruction (`e76d092c`).
- Hermite-spline audio reactivity interpolation (`f8b9ba56`), continuous dynamic-resolution scaling with an accumulator, and CAS sharpening (`fb72fa4d`).
- Per-frame `q`-registers in GPU field programs (`b93d1adf`), extended shader intrinsics and metadata (`0a5726f4`).
- Audio search now feeds real spectral bands, and presets are described by how they look rather than what they are called (`29afa912`, `4c44533e`).

### Changed

- `mat2` element writes in a native `shader_body` now execute directly on WebGPU: the analysis gate that sent every matrix element write to the uniform-only approximation is narrowed to `mat3`/`mat4`, the only sizes the node executor cannot represent. 57 bundled presets move off the approximation (WebGPU shader-translation gap 226 → 169; fully supported on both backends 1521 → 1577).
- The WebGPU node executor now binds MilkDrop per-frame registers a shader body reads without assigning (`tele`, `hordist`, `blur1_min`, …) as uniforms driven from the VM frame state, as the WebGL path already did with `uniform float` declarations. Reads of such names used to compile to nothing and silently dropped the statement and everything downstream of it (8 bundled presets, 3 of them among the `mat2` bodies above).
- Bounded every growth path the `#1105`–`#1111` series touched: compiled-preset cache warmup, preset preview cache, idle renderer pool retention, source-diff memory, and offscreen shader identicons (`a63a1dda`, `12bd38be`, `663df8c8`, `fed4a2bb`, `9cf158e4`).
- Coalesced stage-control activity and optimized preset stage transitions (`4d046c3d`, `d7f2e5a8`); removed redundant layers (`b28b4aa9`).

### Fixed

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
