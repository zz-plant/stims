# Stims Release Notes

Detailed release notes and milestone breakdown for the Stims Webtoys Visualizer Library.

---

## Release v1.3.0 (2026-07-29)

### 🌟 Release Highlights
- **Console-Style Workspace UI**: Fully redesigned settings, preset browse drawer, and dock control UI for streamlined visualizer navigation and audio configuration.
- **JIT EEL Expression Compiler Overhaul**: Presets compile VM program blocks into single JavaScript functions rather than per-statement closures, cutting CPU execution time by ~45% (from 2.00 ms/frame down to 1.10 ms/frame average).
- **1,739 MilkDrop Presets Restored**: Transpilation engine recovers 157,950 EEL math statements previously lost during asset imports, enabling full per-frame, per-pixel, and per-shape evaluation across the entire bundled preset corpus.
- **WebGPU Readback Optimization**: Buffer reuse and signal packing improvements reduce GPU-to-CPU synchronization overhead.

### 🐛 Bug Fixes & Technical Improvements
- Added missing EEL math intrinsics: `randint`, `log10`, and global `gmegabuf`.
- Lowered shape radius floor to `0.002` to prevent instanced dot fields from inflating into overlapping circles.
- Decoupled `EngineSnapshotCtx` and state sub-trees to prevent 60 FPS re-render cascades in passive UI elements.

---

## Release v1.2.0 (2026-07-24)

### 🌟 Release Highlights
- **HUD Spectrum Analyzer**: Real-time audio spectrum analyzer overlay integrated directly into stage controls.
- **Modular Test Harness Restructuring**: Re-architected project test layout into `tests/unit/` and `tests/e2e/`, establishing fast-gate test profiles.
- **Workspace Panel Modularization**: Extracted monolithic workspace view into `AudioSourcePanel`, `BrowseSheetPanel`, and `SettingsSheetPanel`.

### 🐛 Bug Fixes & Technical Improvements
- Fixed audio autoplay race condition when navigating via URL direct links (`?toy=...`).
- Consolidated microphone constraints across runtime and e2e test mocks.

---

## Release v1.1.0 (2026-07-19)

### 🌟 Release Highlights
- **Native MilkDrop Parity Bridge**: High-fidelity WebGL/WebGPU bridge aligning rendering behavior with native projectM / MilkDrop 2.0 pipelines.
- **MilkDrop 3D Noise Texture Axis Alignment**: Resolved texture lookup coordinate alignment bug for volumetric procedural noise.
- **Mobile Edge-to-Edge Fullscreen**: Responsive viewport and gesture handling for mobile visualizer playback.

### 🐛 Bug Fixes & Technical Improvements
- High-contrast shell accessibility updates for light mode interface.
- Hot-path vertex mesh array allocation pooling to eliminate per-frame garbage collection pressure.

---

## Release v1.0.0 (2025-02-04)

### 🌟 Release Highlights
- **Initial Release**: Launch of the Stim Webtoys Visualizer Library featuring interactive audio-reactive toys (`aurora-painter`, `defrag`, `lights`, `multi`).
- **Core Runtime & Build System**: Vite integration, Bun package runner, WebGL fallback chain.
