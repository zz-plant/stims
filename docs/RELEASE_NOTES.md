# Stims Release Notes

Dated release records for Stims. Claims and measurements describe each release revision; see [implementation status](./IMPLEMENTATION_STATUS.md) for current capability limits. `bun run release:notes` manages release-note preparation.

---

## Release v1.5.0 (2026-10-21)

### 🌟 Release Highlights

- Visual search in Browse. "Like your saved" sorts presets by the embeddings of their rendered previews (EmbeddingGemma 2, 256 int8 values per preset), Nearby ranks neighbours the same way, and 366 presets gained visual search terms: "galaxy" now finds 12 presets instead of 3, and a search made only of visual terms ("tunnel", "red fire") also lists every preset whose preview looks like it.
- The first paint downloads 585 kB of JavaScript instead of 1,007 kB, the start page paints its headline from the HTML, and the mobile start page's largest contentful paint fell from 4.8 s to 2.7 s.
- Preset switches no longer freeze: WebGPU compiles the incoming preset's pipelines before the blend starts, holding the fade for up to 1.5 s while the old preset keeps playing.
- Less CPU per frame: the JIT advances the EEL random generator inline, the per-vertex loop skips built-ins the preset never references, presets with an identity warp skip the mesh transform, and the outgoing preset of a crossfade runs at 75% detail.
- The editor treats a preset's warp and composite shaders as their own blocks: highlighted lines, per-block compile errors that name backend, program and stage, and a Shader tab that lists the GLSL the GPU runs.
- Remix credit travels with the preset: share links and exported `.milk` files record the parents (`remix_of_N_id`, `_title`, `_author`), and every bundled preset now fits in a share link.
- Live-stage keys and hardware: D blacks out the picture while held (two quick taps latch it), Y flashes white; a MIDI fader bound to crossfade drives the cue deck's hand fade DJ-style.
- Reduce flashing acts in production, sampling each frame as it is drawn, and a per-preset frame-cost record lets low-tier devices skip the heaviest presets in autoplay and shuffle.
- Four parts of Stims are standalone packages under `packages/`: `milkdrop-toolchain`, `flash-guard`, `audio-reactive` and `eel-conformance`; three are published on npm.

### 🐛 Bug Fixes & Technical Improvements

- Editing and comparing no longer overwrite work: undo history restarts on each preset load, A/B compares your edit with the original, drafts are saved only for real edits, and Refine shows a diff with Apply and Discard.
- The flash governor counts what the WCAG audit counts, flash samples are read back in a worker instead of stalling the main thread 2–3.6 ms a frame, and shuffle and autoplay skip measured flashers while it is on.
- More preset shaders compile on WebGL: HLSL `saturate`, `frac`, `lerp` and `atan2` are translated, assignments are wrapped in the target's type as HLSL broadcasts and truncates, and declarations above `shader_body` carry over.
- A shared preset's social card is a JPEG under 300 KB (96 KB median), so chat apps keep the preview; a `?preset=` page names its preset, lists its collection and links its `.milk` file, and the sitemap now lists 2,488 presets.
- Stims boots where reading `localStorage` throws: sandboxed iframes, third-party frames and browsers that block site data.
- The iframe `postMessage` bridge answers truthfully: every `toil:*` command gets one status reply, `load_preset` waits until the stage shows the preset, and unknown ids come back with suggestions.
- A shared `#code=` link waits for its preset to load before restoring the edited source, and links to presets you made or imported carry their code.
- **Breaking for MCP clients:** the leftover toy tools are removed. Replacements: `get_toys` → `list_presets` / `get_preset_info`, `launch_toy` → `open_preset_url`, `describe_loader` → `read_doc_section`, and the toy screenshot/health tools → `capture_preset`.

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
