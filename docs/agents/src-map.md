# src/ map

Where things live, which tests cover them, and which guards scan them. One line
per area; read the file itself for details.

## `src/js/core/` — engine plumbing

| Area | What lives here | Tests | Guards |
| --- | --- | --- | --- |
| Renderer lifecycle | `renderer-*.ts`, `webgl-renderer.ts`, `webgpu-renderer.ts`, `renderer-capabilities.ts`, `renderer-plan.ts`, `renderer-retry-policy.ts`, `renderer-telemetry.ts` | `renderer-capabilities.test.ts`, `renderer-setup.test.ts`, `renderer-retry-policy.test.ts`, `renderer-query-override.test.ts` | `check:architecture`, `check:quick` |
| Audio | `audio-handler.ts`, `audio-interpolator.ts`, `audio-lifecycle.ts`, `audio-gpu-texture.ts`, `audio-constants.ts` | `audio-handler.test.ts`, `audio-interpolator.test.ts`, `audio-lifecycle.test.ts`, `audio-gpu-texture.test.ts`, `audio-worklet.test.ts`, `audio-transient-dsp.test.ts` | `check:quick` |
| Quality / perf | `services/adaptive-quality-controller.ts`, `services/continuous-drs.ts`, `services/temporal-memory.ts`, `services/crash-telemetry.ts`, `services/performance-*.ts`, `frame-pacing.ts`, `power-state.ts`, `simulation-accumulator.ts` | `adaptive-quality-controller.test.ts`, `continuous-drs.test.ts`, `temporal-memory.test.ts`, `frame-pacing.test.ts`, `power-state.test.ts` | `check:quick` |
| State | `state/` (`domain-store`, `browser-storage`, `last-session-store`, `quality-preset-store`, `render-preference-store`, `performance-settings-store`, `power-saver-store`) | `domain-store.test.ts`, `performance-settings-store.test.ts` | `check:quick` |
| Services | `services/webmidi-controller.ts`, `services/picture-in-picture-service.ts`, `services/microphone-permission-service.ts`, `services/optional-api.ts`, `services/render-service.ts`, `services/visual-embedding.ts`, `services/audio-service.ts`, `services/audio-matcher.ts` | `webmidi-controller.test.ts`, `microphone-permission-service.test.ts`, `optional-api.test.ts`, `render-service-prewarm.test.ts`, `visual-embedding.test.ts`, `services-pool.test.ts` | `check:quick` |
| Toy / app shell | `toy-*.ts`, `web-toy.ts`, `shared-initializer.ts`, `unified-input.ts`, `animation-loop.ts` | `toy-*.test.ts`, `shared-initializer.test.ts`, `unified-input.test.ts`, `sample-toy.test.ts` | `check:quick` |
| Agent/automation | `agent-api.ts`, `edge-contracts.ts` | `agent-api.test.ts`, `agent-bridge.test.ts` | `check:quick` |

## `src/js/milkdrop/` — the preset engine (compiler + VM + renderers)

| Area | What lives here | Tests | Guards |
| --- | --- | --- | --- |
| Compiler | `compiler.ts`, `compiler/` (`core`, `ir.ts`, `parity.ts`, `compatibility.ts`, `preset-normalization.ts`, `shader-analysis*.ts`, `shader-execution-classification.ts`, `wgsl-generator.ts`, `gpu-descriptor-plan.ts`, `gpu-field-planner.ts`, `custom-samplers.ts`) | `milkdrop-compiler.test.ts`, `milkdrop-compiler-shader-analysis.test.ts`, `milkdrop-compiler-shader-glsl-emitter.test.ts`, `milkdrop-compiler-compatibility.test.ts`, `milkdrop-compiler-cache.test.ts`, `milkdrop-compiler-default-state.test.ts`, `wgsl-generator.test.ts`, `milkdrop-shader-execution-classification.test.ts` | `check:quick`, `check:architecture` |
| Expression / JIT | `expression.ts`, `expression-jit.ts`, `vectorize-id.ts`, `shader-ast.ts`, `shader-expression-shared.ts` | `milkdrop-expression.test.ts`, `milkdrop-program-jit.test.ts` | `check:quick` |
| VM | `vm.ts`, `vm-gpu.ts`, `vm/` (`buffer-manager`, `frame-generation`, `geometry-builder`, `post-effects-builder`, `shape-border-builder`, `wave-builder`) | `milkdrop-vm.test.ts`, `milkdrop-vm-frame-generation.test.ts`, `vm-gpu.test.ts`, `vm-buffer-manager.test.ts`, `milkdrop-modulo-parity.test.ts` | `check:quick` |
| Parser / runtime | `preset-parser.ts`, `runtime.ts`, `runtime/` (`lifecycle`, `session`, `startup`, `preset-*`, `catalog-coordinator`, `performance-tracker`, `presentation-*`) | `milkdrop-runtime.test.ts`, `milkdrop-runtime-seams.test.ts`, `milkdrop-preset-navigation-controller.test.ts`, `milkdrop-scene-selection.test.ts`, `milkdrop-catalog-coordinator.test.ts` | `check:quick` |
| Renderer adapters | `renderer-adapter-*.ts`, `renderer-bundles.ts`, `renderer-execution-plan.ts`, `renderer-helpers/` (`wave-renderer`, `shape-renderer`, `border-renderer`, `mesh-renderer`, `feedback-composite`, `particle-field-renderer`, `procedural-wave-renderer`, `motion-vector-renderer`) | `milkdrop-renderer-adapter.test.ts`, `milkdrop-wave-renderer.test.ts`, `milkdrop-border-renderer.test.ts`, `milkdrop-particle-field.test.ts`, `milkdrop-feedback-*.test.ts`, `milkdrop-renderer-execution-plan.test.ts`, `primitive-rasterization-fidelity.test.ts` | `check:architecture` |
| Feedback / WebGPU | `feedback-manager-*.ts`, `feedback-render-targets.ts`, `feedback-composite-profile.ts`, `feedback-volume-sampling.ts`, `webgpu-optimization-flags.ts`, `wgsl-signal-layout.ts`, `wgsl-vectorization.ts`, `renderer-backends/` | `milkdrop-feedback-manager-webgpu.test.ts`, `milkdrop-feedback-perf.test.ts`, `milkdrop-feedback-composite-profile.test.ts`, `milkdrop-feedback-render-targets.test.ts`, `milkdrop-feedback-volume-sampling.test.ts`, `milkdrop-wgsl-vectorization.test.ts`, `milkdrop-webgpu-feature-routing.test.ts` | `check:quick` |
| Catalog / store | `catalog-store*.ts`, `catalog-types.ts`, `catalog-sort.ts`, `catalog-query-override.ts`, `catalog-store-analysis.ts` | `milkdrop-catalog-store.test.ts`, `milkdrop-catalog-store-bundled-loader.test.ts`, `milkdrop-catalog-store-resilience.test.ts`, `catalog-store-analysis.test.ts`, `catalog-compiler-smoke.test.ts`, `browse-author-filter.test.ts` | `check:catalog-integrity`, `check:catalog-fidelity`, `check:readme-claims` |
| Editor | `overlay/editor-panel.ts`, `overlay/editor-language.ts`, `editor-session.ts`, `editor-worker.ts`, `formatter.ts`, `preset-controls.ts`, `preset-modulation.ts`, `source-diff.ts` | `editor-panel.test.ts`, `editor-panel-controls.test.ts`, `milkdrop-editor-session.test.ts`, `milkdrop-formatter-*.test.ts`, `live-modulation.test.ts`, `code-editing-tooling-hardening.test.ts` | `check:quick` |
| MIDI / signals | `runtime-signals.ts`, `harmonic-percussive-shader-signals.ts`, `audio-signal-processor.ts`, `backend-behavior.ts` | `milkdrop-runtime-signals.test.ts`, `harmonic-percussive-signals.test.ts`, `milkdrop-shader-harmonic-percussive-signals.test.ts`, `milkdrop-input-signals.test.ts` | `check:quick` |

## `src/js/frontend/` — the React workspace

| What lives here | Tests | Guards |
| --- | --- | --- |
| `App.tsx`, app shell, workspace panels, `url-state.ts`, `engine/*` (video-export, preview), `HudOverlay.tsx`, `CapturePanel.tsx` | `app-shell.test.ts`, `app-shell-*.test.ts`, `frontend-url-state.test.ts`, `frontend-video-export-runtime.test.ts`, `split-view-browse.test.ts`, `workspace-*.test.ts`, `stage-*.test.tsx` | `check:architecture` (import cycles and production-to-test imports only; the frontend → engine seam rule is proposed in `docs/architecture/architectural-changes-proposal-2026-09.md`) |

## `src/js/ui/`, `src/js/utils/`, `src/js/lighting/`

| What lives here | Tests | Guards |
| --- | --- | --- |
| Framework-free UI helpers (audio controls, identicons, YouTube), browser/media/audio utilities, lighting-rig toys | `shader-identicon.test.ts`, `youtube-controller.test.ts`, `preset-artwork.test.ts`, `display-audio-capture.test.ts` | `check:quick` |

## Generated artifacts (edit the source, not these)

| File | Generated by | Guard |
| --- | --- | --- |
| `docs/authoring/reference.md` | `bun run docs:authoring-reference` (from `expression.ts` / `builtin-docs.ts`) | `check:authoring-docs` |
| `public/milkdrop-presets/catalog.json` | catalog import/sync tooling | `check:catalog-integrity`, `check:catalog-fidelity` |