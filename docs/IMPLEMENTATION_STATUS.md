# Implementation status

This document is the consolidated source for implementation progress across roadmap priorities, refactor milestones, technical debt execution, and UX backlog planning.

## Completed foundations

- [x] Compatibility + onboarding improvements are in place.
- [x] Performance + quality controls are in place.
- [x] Audio permission clarity improvements are in place.
- [x] Touch + gesture consistency baseline is in place.
- [x] Library discovery improvements are in place.
- [x] Homepage first-view CTAs are reduced to one primary launch path plus browse.
- [x] Shared runtime helper foundations are in place.
- [x] **Shared audio GPU texture foundation** (2026-07-29):
  - [x] Enhanced `SharedAudioGpuTextureManager` in `src/js/core/audio-gpu-texture.ts` with reusable buffer allocations and WebGPU queue writes (`writeToGpuTexture`, `updateAudioGpuTexture`).
  - [x] Packed FFT frequency data into Row 0 (`y = 0`) and waveform data into Row 1 (`y = 1`) of a single `512x2` RGBA texture allocation.
  - [x] Extended `MilkdropFeedbackManager` in `src/js/milkdrop/renderer-types.ts` and wired `setAudioTexture` across WebGL (`feedback-manager-shared.ts`) and WebGPU (`feedback-manager-webgpu-tsl.ts`) renderers.
  - [x] Added unit test coverage in `tests/unit/audio-gpu-texture.test.ts`.
  - [x] Verified quality gate passes (`bun run check:quick` clean).
- [x] **Q3 Roadmap feature: Live EEL Preset Studio AST Diagnostics & Sliders** (2026-07-29):
  - [x] Integrated real-time AST syntax diagnostics (`computeAstDiagnostics`) into `EditorPanel` in `src/js/milkdrop/overlay/editor-panel.ts`.
  - [x] Added compile error banner indicators, severity-tagged console diagnostics with line navigation, and CodeMirror line gutter error highlights.
  - [x] Added live parameter tweak sliders (`zoom`, `warp`, `rot`, `decay`, etc.) with double-click reset and document sync.
  - [x] Added unit tests in `tests/unit/editor-panel.test.ts`.
  - [x] Verified quality gate passes (`bun run check:quick` clean).
- [x] **Off-main-thread AudioWorklet DSP analysis** (2026-07-29):
  - [x] Enhanced `FrequencyAnalyserProcessor` in `src/js/utils/audio/frequency-analyser-processor.ts` to compute multi-band energy levels (`bass`, `mid`, `treble`, `subBass`, `kick`), energy envelope tracking, and 4-band transient metrics off the main thread.
  - [x] Updated `FrequencyAnalyser` in `src/js/core/audio-handler.ts` to consume worklet energy payloads with fallback to standard `AnalyserNode`.
  - [x] Added unit test suite in `tests/unit/audio-worklet.test.ts`.
  - [x] Verified quality gate passes (`bun run check:quick` clean).
- [x] **Browser canvas recording beta** (2026-07-29):
  - [x] Expanded `CapturePanel.tsx` video format options to include Ultra HD 4K (`4k-landscape`, 3840×2160) alongside Full HD 1080p and Spotify Canvas (9:16 vertical).
  - [x] Added a native renderer-resize path for the 4K target and active-audio track composition.
  - [ ] Verify encoded resolution, audio synchronization, frame pacing, and sustained recording in supported browsers before describing it as creator-grade export.
  - [x] Updated unit tests in `tests/unit/utils/canvas-video-exporter.test.ts` for export options coverage.
  - [x] Verified quality gate passes (`bun run check:quick` clean).
- [x] **Q4 Roadmap feature: EEL `loop`/`while` Transpiler Support** (2026-07-30):
  - [x] Extended `scripts/butterchurn-eel-transpiler.ts` AST parser to transpile JS `for`/`while` loops, `++`/`--` increment operators, and `exec2` sequence expressions into EEL statements.
  - [x] Unblocked 79 catalog presets (reducing untranslated count from 109 to 30) and emitted 163,887 valid EEL statements during re-transpilation.
  - [x] Added unit test suite in `tests/unit/butterchurn-eel-transpiler.test.ts` (4/4 tests passing).
  - [x] Verified quality gate passes (`bun run check:quick` clean).
- [x] **WebMIDI controller-service foundation** (2026-07-30):
  - [x] Implemented WebMIDI access, mapping, and learn-mode logic in `src/js/core/services/webmidi-controller.ts`.
  - [x] Connected the shared controller service to live workspace parameters and Settings UI.
  - [x] Add persistent mappings, recovery behavior, and device-backed verification (2026-08-13, below).
  - [x] Verified quality gate passes (`bun run check:quick` clean).
- [x] **MIDI/VJ hardware workflow: persistent mappings, device QA, recovery, MCP performance** (2026-08-13):
  - [x] Rewrote `src/js/core/services/webmidi-controller.ts`: per-device bindings persisted to localStorage, MIDI-learn mode, `onstatechange` hot-plug recovery, per-device enable toggle. Deleted the unused parallel `MidiControllerManager` class it superseded.
  - [x] Opened `performance-hardware-controls.ts`'s live-target allowlist — any field name is now bindable, matching what the inspector panel already accepts.
  - [x] Moved the live MIDI→engine binding from `PerformanceHardwareSection` (mounted only while Settings was open) to `App.tsx`, so a controller keeps driving the visuals with Settings closed.
  - [x] Modeled Claude as a virtual "Claude (MCP)" MIDI device sharing the same binding pipeline as hardware; added `toil:midi_set`/`toil:midi_cc` commands to the agent bridge (`src/js/frontend/agent-bridge.ts`) and `session_midi_set`/`session_midi_cc`/`session_midi_bindings`/`session_midi_devices` MCP tools (`scripts/mcp-server.ts`).
  - [x] Rebuilt `PerformanceHardwareSection.tsx`: device list with connect state, per-device enable switch, bindings table with remove, MIDI-learn UI.
  - [x] Verified quality gate passes (`bun run check:quick` clean).
- [x] **Polish phase: Overlay theme CSS variables extraction and styling consistency** (2026-05-17):
  - [x] Added 23 theme variables for overlay component (bg-primary, bg-secondary, bg-tertiary, overlay, overlay-2, border, blur-lg, shadow, button, active-indicator)
  - [x] Centralized overlay styling in CSS variables for maintainability
  - [x] Fixed all Biome lint warnings via `bun run lint --fix`
  - [x] Verified quality gate passes (`bun run check:quick` all checks clean)
  - [x] Updated keyboard shortcuts documentation for browsing mode (T arrow keys Escape)

## Active priorities

- [ ] Expand trusted projectM-reference coverage for featured and bundled presets.
- [ ] Surface visual-evidence, fallback, and performance status clearly in discovery flows.
- [ ] Complete the browse → edit → compare → save → share remix workflow.
- [ ] Certify native-resolution, audio-muxed export in supported browsers and add deterministic frame-pacing evidence.
- [ ] **Client-side audio stem separation research** (runtime identifiers are reserved, but no separation model populates them).
- [ ] **Q4 Roadmap feature: Unified Composite Shader IR** (Single IR generating both GLSL and TSL node graphs to eliminate feedback shader duplication). Not started: two stub modules were removed unused — neither had a code generator consuming them, and both restated uniform defaults the feedback managers already own.
- [ ] **WebXR spatial stage experiment** — shipped and unit-tested (`webxr-service.ts`, `useWebXr.ts`, an "Enter VR" item in the stage overflow menu on `immersive-vr`-capable browsers, WebGL only), but **never run on physical VR hardware** — that a session actually presents correctly there is unproven. See [docs/TECHNICAL_ACHIEVEMENTS.md](./TECHNICAL_ACHIEVEMENTS.md) and README.md's "Experimental foundations" for the evidence boundary.

## Refactor milestone tracking

- [x] **Milestone A:** Baseline + lifecycle contract draft.
  - [x] Extracted MilkDrop runtime lifecycle seams into focused startup, failover, interaction, and lifecycle modules.
  - [x] Added targeted startup/fallback/lifecycle seam coverage for the refactored runtime modules.
  - [x] Split oversized MilkDrop compiler/runtime/catalog/renderer type groups into topic-specific modules behind the shared barrel.
  - [x] Documented manual smoke baselines and behavior snapshots for milestone sign-off.
- [x] **Milestone B:** Pilot migration complete and validated.
  - [x] Documented the runtime ownership map and shell contract in `docs/ARCHITECTURE.md`.
  - [x] Migrated the shipped MilkDrop starter/quality helpers from `utils/` into `core/` as the pilot boundary slice.
  - [x] Validated the pilot with focused tests, `bun run check:readme-claims`, and `bun run check`.
- [x] **Milestone C:** Broad toy migration with hardened drift checks.
  - [x] Added `bun run check:architecture` and wired it into the full `bun run check` quality gate.
  - [x] Promoted additional runtime-critical helpers (`audio-handler`, `unified-input`, `webgl-check`, `webgl-renderer`, `party-mode`, `shared-initializer`, and library back-navigation) out of `utils/` and into `core/`.
  - [x] Retired the generated toy-manifest artifacts; `src/data/toys.json` is now read directly by the MCP server.
  - [x] Wired `bun run check:readme-claims` and `bun run check:seo` into the main quality gate so metadata/docs and shipped SEO surfaces fail fast when they drift.
- [x] **Milestone D:** Performance/reliability pass complete.
  - [x] Reduced per-frame signal override allocation churn in the MilkDrop input-response path.
  - [x] Expanded browser-backed smoke coverage to include homepage-to-launchpad navigation in addition to live-session launch coverage.
  - [x] Coalesced queued catalog refreshes to the latest requested state and added direct runtime coverage for mid-sync updates.
  - [x] Stopped rebuilding collection-filter controls across browse search rerenders when the available options stay unchanged.
- [x] **Milestone E:** Documentation closeout and cleanup.
  - [x] Rewrote current contributor docs around the single-visualizer workflow and removed stale references to retired toy-entry surfaces from active docs.
  - [x] Marked remaining multi-toy strategy/audit docs as archival context and rewrote manual workflow notes that still needed a live `/milkdrop/` path.

### Refactor workstream tracking

- [x] 1) Baseline and observability.
- [x] 2) Shared runtime boundary extraction.
  - [x] MilkDrop runtime orchestration now delegates startup selection, backend failover, interaction shaping, and frame lifecycle decisions to dedicated modules.
  - [x] Runtime ownership boundaries are now documented in `docs/ARCHITECTURE.md`.
  - [x] Runtime-critical boundary helpers now live under `src/js/core/*` instead of `src/js/utils/*`.
- [x] 3) Toy module normalization.
  - [x] MilkDrop pilot slice now uses `core/` starter/quality helpers instead of `utils/` runtime helpers.
- [x] 4) Data and metadata consistency hardening.
  - [x] Architecture boundary enforcement now runs in CI-local parity through `bun run check:architecture`.
  - [x] README public claims are validated against the shipped catalog by `bun run check:readme-claims`.
  - [x] SEO surface validation now runs alongside the main quality gate through `bun run check:seo`.
- [x] 5) Incremental performance and reliability pass.
  - [x] Catalog refresh scheduling now coalesces to the latest requested overlay state during rapid preset/backend churn.
  - [x] Browse collection filters no longer rebuild on every search-driven rerender when the option set is unchanged.
- [x] 6) Documentation and contributor UX completion.
  - [x] Contributor and agent docs now reflect the single-visualizer product model and generated manifest-doc workflow.
  - [x] Historical docs and manual notes now explicitly distinguish archival multi-toy context from the current `/milkdrop/` workflow.

## Technical debt execution queue

- [x] Split oversized runtime modules by responsibility and backfill focused tests.
- [x] Add deterministic generated-artifact validation for metadata/taxonomy updates.
- [x] Raise toy-level smoke coverage, starting with the flagship shipped visualizer flow.
- [x] Harden metadata source-of-truth drift checks.
- [x] Maintain visible refactor execution checkpoints in this document.

## UX delivery queue

### Now (1 sprint)

- [x] Keep filter/refine state obvious on mobile and during scroll.
- [x] Reduce first-view library control density.
- [x] Simplify preflight/error states to one primary CTA.

### Next (1–2 sprints)

- [x] Move diagnostics/technical language behind progressive disclosure.
- [x] Reorder mobile layout to prioritize delight/launch before utility rails.
- [x] Normalize status taxonomy across browsing and live session surfaces.

### Later

- [ ] Personalize launch defaults from prior successful sessions.
- [x] Add lightweight dismissible onboarding hints.
- [ ] A/B test hero-only launch vs hero + quick-start variants.

## Maintenance notes

- This file is the authoritative, editable status checklist for roadmap/refactor/debt/UX execution.
- Update this file in the same PR when item status changes.
- Keep `docs/FULL_REFACTOR_PLAN.md` for detailed strategy and rationale (non-authoritative for checklist state).
- Recent changes (2026-05-17): Overlay theme CSS variables extraction for improved maintainability and consistency.
