# Stims product and engineering roadmap

Stims is building a browser-native studio around audio-reactive, MilkDrop-inspired presets. The roadmap prioritizes user-visible workflow improvements and measurable compatibility before speculative rendering or hardware breadth.

## Product principles

1. **Fidelity before parity claims.** Loading and compiling a preset is not proof that it looks correct.
2. **Workflow before technology badges.** WebGPU matters when it improves a measured user outcome; it is not a product promise by itself.
3. **One coherent studio.** Discovery, playback, editing, inspection, and recording should share one session.
4. **Foundations are not features.** A service class, reserved signal, or API route is not shipped until it is connected, usable, and verified.
5. **Direct formats and portable state.** Preserve `.milk` authoring and shareable session URLs rather than hiding the source format.

## Current baseline

- Searchable imported preset catalog with previews, collections, favorites, queues, history, and deep links.
- Direct `.milk` import/export and a live CodeMirror authoring environment.
- WebGL2 compatibility baseline plus a guarded WebGPU execution path.
- Multi-source browser audio with off-main-thread analysis.
- Browser canvas recording beta.
- Native projectM reference capture, provenance, image-diff, and result-promotion tooling.
- MIDI/VJ hardware workflow with per-device persistent mappings, learn mode, hot-plug recovery, and an MCP-controllable virtual device.

See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) for file-level status and [`TECHNICAL_ACHIEVEMENTS.md`](./TECHNICAL_ACHIEVEMENTS.md) for evidence boundaries.

## Now: trustworthy library and proof loop

### Expand measured preset coverage

- Complete the checked-in reference and diff loop for the four bundled proof presets.
- Fix renderer behavior by subsystem: feedback orientation, shader sampling, color presentation, shapes, waves, and motion vectors.
- Promote results only after the requested backend and reference provenance are verified.
- Surface clear visual-evidence and fallback labels in the browsing and inspector workflows.

Exit criteria:

- every featured preset has current measured evidence;
- public compatibility wording is generated or guarded against tracked sources of truth; and
- unsupported or fallback behavior is visible rather than silent.

### Make the large catalog useful

- Improve preview reliability and cold-load behavior.
- Rank by visual quality, evidence, performance, author, mood, and session relevance instead of relying on preset count.
- Make queue, favorites, recent history, and shareable filtered views coherent on desktop and mobile.
- Treat semantic and audio-profile matching as optional enhancements, never as blockers for local search.

Exit criteria:

- a first-time user can find a strong preset without understanding MilkDrop naming conventions; and
- low-confidence or expensive presets do not dominate default recommendations.

### Flash-safety measurement

The bundled preset corpus was imported from the community without any photosensitive-seizure safety review. A real WCAG 2.3.1-grounded measurement tool now exists (`scripts/flash-analysis.ts` + `scripts/analyze-preset-flash.ts`, unit-tested, corpus-sampling built in) alongside the earlier placeholder-threshold tool (`bun run lab:flash-risk`). First sample run (50 presets, 34 measured, 16 timed out): zero exceeded threshold. Encouraging, not yet conclusive — see [`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md#layer-0--safety-first-sample-run-complete) for the full result and the tool-reliability gap to close first.

Exit criteria:

- the audit tool's apparent resource-exhaustion pattern (timeouts clustering late in a long run) is fixed and a full-corpus run completes without a large unmeasured tail;
- a corpus test in `tests/corpus/` continuously enforces the threshold, not just regression-tests the tool's report shape; and
- a default-on flash-rate cap ships as a visible safety control, not a buried setting.

## Next: authoring and creator workflow

### Remix studio

- Add dependable undo/redo and named snapshots.
- Provide side-by-side or rapid A/B comparison against the source preset.
- Record remix provenance and retain source in exported `.milk` files or companion metadata.
- Make generated or assisted edits inspectable as source diffs before application.
- Add a share format that preserves the preset or a stable community identifier without requiring an account for local work.

Exit criteria:

- browse → edit → compare → save → share works without leaving the running session.

### Creator-grade export

- Harden the native renderer-resize and active-audio composition paths now implemented for recording.
- Add deterministic frame pacing and loop-duration controls.
- Verify codec, aspect-ratio, duration, and frame-count output in browser-backed tests.
- Keep the existing `MediaRecorder` path as a clearly labeled compatibility fallback.

Exit criteria:

- “1080p” and “4K” describe measured render output rather than canvas container dimensions; and
- exported audio-video files remain synchronized over a documented test duration.

## Later: platform expansion

These workstreams begin only after their prerequisite user flows and proof contracts are stable.

| Workstream | Prerequisite |
| --- | --- |
| Stims-native WebGPU preset lane | Stable backend contract, performance telemetry, and a format that produces visuals unavailable to the classic compatibility lane. |
| Embeddable package or Web Component | Lifecycle, audio, preset, resize, and cleanup APIs proven inside the product and integration tests. |
| Real stem-aware reactivity | On-device separation with measured latency, resource budgets, privacy posture, and populated runtime signals. |
| Community catalog and sync | Stable preset identity, provenance, moderation, versioning, and local-first failure behavior. |
| Multi-display or venue output | Deterministic timing, remote recovery, and a supported transport contract. |

## Research, not roadmap commitments

- WebXR immersive stages;
- neural audio-to-visual generation;
- Gaussian-splat or latent rendering;
- DMX, Art-Net, NDI, or Syphon bridges; and
- a general plugin marketplace.

Research code may exist for these areas, but it should remain labeled as scaffolding until an end-to-end product workflow and verification plan exist.
