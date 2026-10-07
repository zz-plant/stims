# src/ map

Where things live, which tests cover them, and which guards scan them. One line
per area; read the file itself for details.

## `src/js/core/` — engine plumbing

| Area | What lives here | Tests | Guards |
| --- | --- | --- | --- |
| Renderer lifecycle | `renderer-*.ts`, `webgl-renderer.ts`, `webgpu-renderer.ts`, `renderer-capabilities.ts`, `renderer-plan.ts`, `renderer-retry-policy.ts`, `renderer-telemetry.ts` | `renderer-capabilities.test.ts`, `renderer-setup.test.ts`, `renderer-retry-policy.test.ts`, `renderer-query-override.test.ts` | `check:architecture`, `check:quick` |
| Audio | `audio-handler.ts`, `audio-gpu-texture.ts`, `audio-constants.ts`; the DSP is `packages/audio-reactive` (below) | `audio-handler.test.ts`, `audio-gpu-texture.test.ts`, `audio-worklet.test.ts` | `check:quick` |
| Flash safety | `services/flash-safety.ts` (the stage adapter), `services/stage-luminance.ts`, `sensory-profile.ts`; the governor and analysis are `packages/flash-guard` (below) | `flash-safety.test.ts`, `sensory-profile.test.ts`, `reduce-flashing-reach.test.tsx` | `check:quick` |
| Quality / perf | `services/adaptive-quality-controller.ts`, `services/continuous-drs.ts`, `services/crash-telemetry.ts`, `services/performance-*.ts`, `frame-pacing.ts`, `power-state.ts`, `simulation-accumulator.ts` | `adaptive-quality-controller.test.ts`, `continuous-drs.test.ts`, `frame-pacing.test.ts`, `power-state.test.ts` | `check:quick` |
| State | `state/` (`domain-store`, `browser-storage`, `last-session-store`, `quality-preset-store`, `render-preference-store`, `performance-settings-store`, `power-saver-store`) | `domain-store.test.ts`, `performance-settings-store.test.ts` | `check:quick` |
| Services | `services/webmidi-controller.ts`, `services/picture-in-picture-service.ts`, `services/microphone-permission-service.ts`, `services/optional-api.ts`, `services/render-service.ts`, `services/visual-embedding.ts`, `services/audio-service.ts`, `services/audio-matcher.ts` | `webmidi-controller.test.ts`, `microphone-permission-service.test.ts`, `optional-api.test.ts`, `render-service-prewarm.test.ts`, `visual-embedding.test.ts`, `services-pool.test.ts` | `check:quick` |
| Toy / app shell | `toy-*.ts`, `web-toy.ts`, `shared-initializer.ts`, `unified-input.ts`, `animation-loop.ts` | `toy-*.test.ts`, `shared-initializer.test.ts`, `unified-input.test.ts`, `sample-toy.test.ts` | `check:quick` |
| Agent/automation | `agent-api.ts`, `edge-contracts.ts` | `agent-api.test.ts`, `agent-bridge.test.ts` | `check:quick` |

## `src/js/milkdrop/` — the preset engine (compiler + VM + renderers)

| Area | What lives here | Tests | Guards |
| --- | --- | --- | --- |
| Compiler, expression / JIT, formatter | `packages/milkdrop-toolchain` (below); the app imports it as `milkdrop-toolchain/src/<module>.ts` | Corpus cases only here: `milkdrop-compiler.test.ts`, `milkdrop-program-jit.test.ts`, `milkdrop2-export.test.ts`, `milkdrop-preset-syntax.test.ts`, `shader-execution-mode.test.ts`, `milkdrop-shader-translation.test.ts` | `check:quick`, `check:architecture` |
| VM | `vm.ts`, `vm-gpu.ts`, `vm/` (`buffer-manager`, `frame-generation`, `geometry-builder`, `post-effects-builder`, `shape-border-builder`, `wave-builder`) | `milkdrop-vm.test.ts`, `milkdrop-vm-frame-generation.test.ts`, `vm-gpu.test.ts`, `vm-buffer-manager.test.ts`, `milkdrop-modulo-parity.test.ts` | `check:quick` |
| Parser / runtime | `preset-parser.ts`, `runtime.ts`, `runtime/` (`lifecycle`, `session`, `startup`, `preset-*`, `catalog-coordinator`, `performance-tracker`, `presentation-*`) | `milkdrop-runtime.test.ts`, `milkdrop-runtime-seams.test.ts`, `milkdrop-preset-navigation-controller.test.ts`, `milkdrop-catalog-coordinator.test.ts` | `check:quick` |
| Renderer adapters | `renderer-adapter-*.ts`, `renderer-bundles.ts`, `renderer-execution-plan.ts`, `renderer-helpers/` (`wave-renderer`, `shape-renderer`, `border-renderer`, `mesh-renderer`, `feedback-composite`, `particle-field-renderer`, `procedural-wave-renderer`, `motion-vector-renderer`) | `milkdrop-renderer-adapter.test.ts`, `milkdrop-wave-renderer.test.ts`, `milkdrop-border-renderer.test.ts`, `milkdrop-particle-field.test.ts`, `milkdrop-feedback-*.test.ts`, `milkdrop-renderer-execution-plan.test.ts`, `primitive-rasterization-fidelity.test.ts` | `check:architecture` |
| Feedback / WebGPU | `feedback-manager-*.ts`, `feedback-render-targets.ts`, `feedback-composite-profile.ts`, `feedback-volume-sampling.ts`, `webgpu-optimization-flags.ts`, `wgsl-vectorization.ts`, `renderer-backends/` | `milkdrop-feedback-manager-webgpu.test.ts`, `milkdrop-feedback-perf.test.ts`, `milkdrop-feedback-composite-profile.test.ts`, `milkdrop-feedback-render-targets.test.ts`, `milkdrop-feedback-volume-sampling.test.ts`, `milkdrop-wgsl-vectorization.test.ts`, `milkdrop-webgpu-feature-routing.test.ts` | `check:quick` |
| Catalog / store | `catalog-store*.ts`, `catalog-types.ts`, `catalog-sort.ts`, `catalog-query-override.ts`, `catalog-store-analysis.ts` | `milkdrop-catalog-store.test.ts`, `milkdrop-catalog-store-bundled-loader.test.ts`, `milkdrop-catalog-store-resilience.test.ts`, `catalog-store-analysis.test.ts`, `catalog-compiler-smoke.test.ts`, `browse-author-filter.test.ts` | `check:catalog-integrity`, `check:catalog-fidelity`, `check:readme-claims` |
| Editor | `overlay/editor-panel.ts`, `overlay/editor-language.ts`, `editor-session.ts`, `editor-worker.ts`, `preset-controls.ts`, `preset-modulation.ts`, `source-diff.ts` | `editor-panel.test.ts`, `editor-panel-controls.test.ts`, `milkdrop-editor-session.test.ts`, `live-modulation.test.ts`, `code-editing-tooling-hardening.test.ts` | `check:quick` |
| MIDI / signals | `runtime-signals.ts`, `harmonic-percussive-shader-signals.ts`, `audio-signal-processor.ts`, `backend-behavior.ts` | `milkdrop-runtime-signals.test.ts`, `harmonic-percussive-signals.test.ts`, `milkdrop-shader-harmonic-percussive-signals.test.ts`, `milkdrop-input-signals.test.ts` | `check:quick` |

## `packages/` — standalone libraries the app imports

Each is a workspace package with its own tests, run by `bun run check:packages` (in the full gate). The app imports them by name; see `packages/README.md`.

| Package | What lives here | Tests |
| --- | --- | --- |
| `milkdrop-toolchain` | `compiler.ts`, `compiler/` (IR, parity, compatibility, shader analysis and GLSL emission, WGSL generator, GPU planners), `expression.ts`, `expression-jit.ts`, `preset-parser.ts`, `formatter.ts`, `milkdrop2-export.ts`, `preset-dataflow.ts`, `builtin-docs.ts`, `wgsl-signal-layout.ts` | `packages/milkdrop-toolchain/tests/` (compiler, shader analysis, GLSL emitter, WGSL generator, expression, JIT, formatter, dataflow) |
| `audio-reactive` | The AudioWorklet FFT (`frequency-analyser-processor.ts`, entry `audio-reactive/worklet`), `harmonic-percussive.ts`, `beat.ts`, `spectral-features.ts`, `reactivity.ts`, `audio-interpolator.ts`, `audio-lifecycle.ts`, `audio-gesture-gate.ts` | `packages/audio-reactive/tests/` |
| `flash-guard` | WCAG thresholds, offline analysis, the live governor, the sampler and its readback worker, the controller, the risk classifier | `packages/flash-guard/tests/` |
| `eel-conformance` | The EEL2 conformance corpus and runner contract (`spec/eel-conformance/` re-exports it) | `packages/eel-conformance/tests/`; the corpus runs against all three tiers in `tests/unit/eel-conformance-spec.test.ts` |

## `src/js/frontend/` — the React workspace

| What lives here | Tests | Guards |
| --- | --- | --- |
| `App.tsx`, app shell, workspace panels, `url-state.ts`, `engine/*` (video-export, preview), `HudOverlay.tsx`, `CapturePanel.tsx` | `app-shell.test.ts`, `app-shell-*.test.ts`, `frontend-url-state.test.ts`, `frontend-video-export-runtime.test.ts`, `split-view-browse.test.ts`, `workspace-*.test.ts`, `stage-*.test.tsx` | `check:architecture` (import cycles and production-to-test imports only; the frontend → engine seam rule is proposed in `docs/architecture/architectural-changes-proposal-2026-09.md`) |

## `src/js/ui/`, `src/js/utils/`, `src/js/lighting/`

| What lives here | Tests | Guards |
| --- | --- | --- |
| Framework-free UI helpers (audio controls, identicons, YouTube), browser/media/audio utilities, lighting-rig toys | `youtube-controller.test.ts`, `preset-artwork.test.ts`, `display-audio-capture.test.ts` | `check:quick` |

## Generated artifacts (edit the source, not these)

| File | Generated by | Guard |
| --- | --- | --- |
| `docs/authoring/reference.md` | `bun run docs:authoring-reference` (from `packages/milkdrop-toolchain/src/builtin-docs.ts`) | `check:authoring-docs` |
| `public/milkdrop-presets/catalog.json` | catalog import/sync tooling | `check:catalog-integrity`, `check:catalog-fidelity` |