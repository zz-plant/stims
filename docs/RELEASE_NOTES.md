# Stims Release Notes

Detailed release notes and milestone breakdown for the Stims Webtoys Visualizer Library.

---

## Release v1.4.0 (2026-10-01)

### 🌟 Release Highlights
- Pause: Space or the dock's transport button holds the picture, while the preset, history and audio session stay put.
- The preset-tuning keys are listed and rebindable: H (blend/cut), W (waveform), I (zoom), O (warp), J (wave scale) and `<` / `>` (rotation). The first nine Browse cards play from the number keys.
- Presets draw closer to MilkDrop: wave modes 6 and 7 follow MilkDrop 2's geometry, the main wave no longer leaves trails MilkDrop never drew, and waves and shapes land where MilkDrop puts them.
- Matrix element writes in preset shaders now execute directly on WebGPU, so more presets run there without approximation. Of the 1,750 presets in the bundled Butterchurn pack, 1,578 run with no approximation on both WebGL2 and WebGPU.
- A corpus-wide sweep for presets that rendered black, white or flat fixed the causes with a compile-level signature.
- One pitch across the site, link previews and README: "Play and live-edit MilkDrop presets in your browser". The README is less than half its old length, and the repository no longer carries 130 MiB of build output.

### 🐛 Bug Fixes & Technical Improvements
- The keyboard is no longer treated as a TV remote on every page, and closing a panel no longer reverts a preset change made in the same tick.
- Status messages no longer silence each other, and the status toast no longer covers the Cue deck card.
- oEmbed titles name a preset's author once.
- Bounded the cache and pool growth paths found in the #1105–#1111 series.
- Pushing a release tag now publishes a GitHub Release from these notes.

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
