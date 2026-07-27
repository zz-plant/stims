# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

_Current release status: actively developed. The latest tagged release is **1.0.0** and ongoing updates will appear in **Unreleased**._

## [Unreleased]

### Added

- Preset equations restored across the bundled butterchurn corpus. The importer previously emitted base values and shaders only, so 1739 of the 1791 catalogued presets ran with no per-frame, per-pixel, per-point, or per-shape code at all. `scripts/butterchurn-eel-transpiler.ts` converts the upstream JavaScript equation strings back to MilkDrop EEL, and the importer now writes canonical `.milk` output (`per_frame_N`, `per_pixel_N`, `wave_N_per_pointM`, `shape_N_per_frameM`, `wavecode_N_*`, `shapecode_N_*`). 157,950 statements recovered; 1629 presets gained per-frame code and 1068 gained per-pixel code.
- Custom shape instancing (`shapecode_N_num_inst`): per-frame shape code now runs once per instance with `instance` and `num_inst` in scope, as MilkDrop does. 304 bundled presets declare multi-instance shapes and 232 vary geometry by `instance`; all of them previously collapsed to a single draw.
- `randint`, `log10`, and `gmegabuf` in the preset expression language. `randint` alone appears in 472 bundled presets, where it had been silently evaluating to zero.
- Performance controls with persistent pixel ratio, particle budget, and shader-quality presets.
- Low-motion quality preset and inline preset descriptions to clarify performance tradeoffs.
- Demo audio auto-plays on load with the featured preset — no CTA required.
- `EngineSnapshotCtx` with `useEngineSnapshot()` hook for frame-accurate state without re-rendering the full UI tree.

### Changed

- VM program blocks compile to one JavaScript function each instead of one per statement, removing the per-statement dispatch and the two closures each statement allocated for buffer access. Average CPU VM cost across a 40-preset sample dropped from 2.00 ms/frame to 1.10 ms/frame, and the worst preset in the sample from 12.9 ms/frame to 6.1 ms/frame. `tests/unit/milkdrop-program-jit.test.ts` diffs compiled output against the interpreter to pin the semantics.
- Custom shape radius floor lowered from 0.04 to 0.002 so MilkDrop-scale instanced dot fields (typically 0.005–0.02) stay dots instead of being inflated into overlapping blobs.
- Engine snapshot split from catalog context — UI-only components no longer re-render 60fps.
- Workspace UI extracted from monolithic `workspace-ui.tsx` (1260→294 lines) into `AudioSourcePanel`, `BrowseSheetPanel`, `SettingsSheetPanel`.
- `launchControlsHidden` renamed to `audioActive` across engine, workspace, and shell hooks.
- Sheet backdrop removed — stage interaction guarded by `pointer-events: none` while sheet is open.

### Removed

- Capability preflight panel, readiness probes, and `microphone-flow` — capability detection folded into engine-context startup.
- `OnboardingFlow` first-time popup, Inspector panel, GitHub corner link.
- `StimsStageAmbient` decorative layer (orbs, beams, rings, pulse, grid, EQ bars).
- ~300 lines of dead CSS (ambient animations, nav classes, source grid, launch hero, section headings, sheet backdrop).
- `quiet-hint` and `first-shuffle` contextual help hints (duplicate or untriggered).
- `tests/microphone-flow.test.ts`, `tests/capability-preflight*.ts` — test-only production files.

## [1.0.0] - 2025-02-04

### Added

- Initial release of the Stim Webtoys Library with interactive experiences such as [Aurora Painter](./toy.html?toy=aurora-painter), [Defrag Visualizer](./toy.html?toy=defrag), [Multi-Capability Visualizer](./toy.html?toy=multi), [Audio Light Show](./toy.html?toy=lights), and many more listed in the [README](./README.md#toys-in-the-collection).
- Core setup for running toys locally via Vite with Bun or Node.js, including build, preview, lint, and test scripts.

### Changed

- Documented repository layout and contribution guidance to help users navigate assets, utilities, and test suites.

### Fixed

- Clarified local setup to avoid issues when opening HTML files directly without a dev server.

[Unreleased]: https://github.com/zz-plant/stims/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zz-plant/stims/releases/tag/v1.0.0
