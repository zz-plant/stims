# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

_Current release status: actively developed. Latest release: **v1.3.0**._

## [Unreleased]

### Planned

- projectM WebGPU compute shader parity & full WGSL pipeline lowering.
- Audio analyzer AudioWorklet migration for low-latency FFT analysis.
- Live EEL preset editor with real-time expression AST diagnostics.

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
