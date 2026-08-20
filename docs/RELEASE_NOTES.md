# Stims Release Notes

Detailed release notes and milestone breakdown for the Stims Webtoys Visualizer Library.

---

## Release v1.3.0 (2026-07-29)

### 🌟 Release Highlights
- Settings, the preset browse drawer, and the dock controls were redesigned into a console-style workspace.
- Presets now compile VM program blocks into a single JavaScript function each instead of one per statement, cutting VM CPU cost from 2.00 ms/frame to 1.10 ms/frame (~45%).
- The transpilation engine recovered 157,950 EEL math statements lost during asset imports, restoring per-frame, per-pixel, and per-shape evaluation across the bundled preset corpus.
- Buffer reuse and signal packing in the compute VM cut GPU-to-CPU readback overhead.

### 🐛 Bug Fixes & Technical Improvements
- Added missing EEL math intrinsics: `randint`, `log10`, and global `gmegabuf`.
- Lowered shape radius floor to `0.002` to prevent instanced dot fields from inflating into overlapping circles.
- Decoupled `EngineSnapshotCtx` and state sub-trees to prevent 60 FPS re-render cascades in passive UI elements.

---

## Release v1.2.0 (2026-07-24)

### 🌟 Release Highlights
- The stage controls now include a real-time audio spectrum analyzer overlay.
- Test layout was re-architected into `tests/unit/` and `tests/e2e/` with fast-gate test profiles.
- The monolithic workspace view was split into `AudioSourcePanel`, `BrowseSheetPanel`, and `SettingsSheetPanel`.

### 🐛 Bug Fixes & Technical Improvements
- Fixed audio autoplay race condition when navigating via URL direct links (`?toy=...`).
- Consolidated microphone constraints across runtime and e2e test mocks.

---

## Release v1.1.0 (2026-07-19)

### 🌟 Release Highlights
- A native MilkDrop parity bridge aligns rendering behavior with native projectM / MilkDrop 2.0 pipelines.
- Resolved a texture-lookup coordinate alignment bug for volumetric procedural noise.
- Mobile fullscreen now extends edge-to-edge with responsive viewport and gesture handling.

### 🐛 Bug Fixes & Technical Improvements
- High-contrast shell accessibility updates for light mode interface.
- Hot-path vertex mesh array allocation pooling to eliminate per-frame garbage collection pressure.

---

## Release v1.0.0 (2025-02-04)

### 🌟 Release Highlights
- Initial release of the interactive audio-reactive toys: `aurora-painter`, `defrag`, `lights`, `multi`.
- Vite integration, Bun package runner, and a WebGL fallback chain.
