# tests/ index

Find the canonical test for a change surface. Tests are categorized by the
folder they live in — `unit`, `compat`, `corpus`, `e2e`, `accessibility` —
and the runner derives profiles from those folders (`fast` = unit + compat;
`all` adds corpus + e2e). Run one file with `bun run test <path>`.

## Compiler / expression / JIT

`milkdrop-compiler.test.ts` (2663 lines, the big one) · `milkdrop-compiler-cache.test.ts` ·
`milkdrop-compiler-compatibility.test.ts` · `milkdrop-compiler-default-state.test.ts` ·
`milkdrop-compiler-seams.test.ts` · `milkdrop-compiler-shader-analysis.test.ts` ·
`milkdrop-compiler-shader-glsl-emitter.test.ts` · `milkdrop-expression.test.ts` ·
`milkdrop-program-jit.test.ts` · `milkdrop-shader-execution-classification.test.ts` ·
`wgsl-generator.test.ts` · `milkdrop-wgsl-vectorization.test.ts` ·
`milkdrop-shader-tsl-intrinsics.test.ts` · `milkdrop-shader-sampler-aliases.test.ts` ·
`custom-shader-import.test.ts` ·
`butterchurn-eel-transpiler.test.ts` (scripts/)

## VM / runtime

`milkdrop-vm.test.ts` (1698 lines) · `milkdrop-vm-frame-generation.test.ts` ·
`vm-gpu.test.ts` · `vm-buffer-manager.test.ts` · `milkdrop-modulo-parity.test.ts` ·
`milkdrop-runtime.test.ts` · `milkdrop-runtime-seams.test.ts` ·
`milkdrop-runtime-signals.test.ts` · `milkdrop-runtime-performance.test.ts` ·
`milkdrop-preset-load-trace.test.ts` · `milkdrop-salvage-compile.test.ts`

## Renderer / feedback / WebGPU

`milkdrop-renderer-adapter.test.ts` (4495 lines) · `milkdrop-renderer-execution-plan.test.ts` ·
`milkdrop-renderer-seams.test.ts` · `milkdrop-wave-renderer.test.ts` ·
`milkdrop-border-renderer.test.ts` · `milkdrop-particle-field.test.ts` ·
`primitive-rasterization-fidelity.test.ts` · `milkdrop-feedback-manager-webgpu.test.ts` ·
`milkdrop-feedback-perf.test.ts` · `milkdrop-feedback-composite-profile.test.ts` ·
`milkdrop-feedback-render-targets.test.ts` · `milkdrop-feedback-volume-sampling.test.ts` ·
`milkdrop-webgpu-feature-routing.test.ts` · `webgpu-timestamp-profiler.test.ts` ·
`shader-dependent-presets.test.ts` · `renderer-capabilities.test.ts` ·
`renderer-query-override.test.ts` · `renderer-retry-policy.test.ts` ·
`renderer-settings.test.ts` · `renderer-setup.test.ts`

## Audio

`audio-handler.test.ts` · `audio-lifecycle.test.ts` · `audio-interpolator.test.ts` ·
`audio-gpu-texture.test.ts` · `audio-frame-allocation.test.ts` · `audio-worklet.test.ts` ·
`audio-transient-dsp.test.ts` · `harmonic-percussive-dsp.test.ts` ·
`harmonic-percussive-signals.test.ts` · `milkdrop-audio-signal-contract.test.ts` ·
`milkdrop-input-signals.test.ts` · `audio-visual-transfer.test.ts` · `waveform-auto-gain.test.ts` ·
`display-audio-capture.test.ts` · `youtube-controller.test.ts` · `test-audio-rig.ts` (script)

## Catalog / store / search

`milkdrop-catalog-store.test.ts` · `milkdrop-catalog-store-bundled-loader.test.ts` ·
`milkdrop-catalog-store-resilience.test.ts` · `catalog-store-analysis.test.ts` ·
`catalog-compiler-smoke.test.ts` (compiles all bundled presets) · `browse-author-filter.test.ts` ·
`sync-bundled-catalog-fidelity.test.ts` · `check-bundled-catalog-fidelity.test.ts` ·
`milkdrop-vendored-library-manifest.test.ts` · `milkdrop-projectm-cream-library.test.ts`

## Editor / authoring / presets

`editor-panel.test.ts` · `editor-panel-controls.test.ts` · `milkdrop-editor-session.test.ts` ·
`milkdrop-formatter-field-read.test.ts` · `milkdrop-formatter-upsert.test.ts` ·
`milkdrop-formatter-midi-shadowing.test.ts` · `preset-controls.test.ts` ·
`live-modulation.test.ts` · `preset-modulation.test.ts` · `preset-sharing.test.ts` ·
`preset-file-actions.test.ts` · `preset-id-resolution.test.ts` · `preset-handles.test.ts` ·
`preset-credit.test.ts` · `preset-lineage.test.ts` · `preset-artwork.test.ts` ·
`preset-visual-description.test.ts` · `assisted-edit-gate.test.ts` ·
`milkdrop-preset-navigation-controller.test.ts` · `milkdrop-preset-preview-service.test.ts` ·
`milkdrop-preset-performance-overrides.test.ts` · `milkdrop-scene-selection.test.ts` ·
`bundled-first-run-preset.test.ts` · `milkdrop-overlay-panels.test.ts` ·
`milkdrop-overlay-stacking.test.ts` · `milkdrop-live-tile-pool.test.ts` ·
`preset-lab-metrics.test.ts`

## App shell / frontend

`app-shell.test.ts` · `app-shell-*.test.ts` (first-run-recovery, minimal-surfaces,
mobile-layout, passive-guidance, performance-hardware, performance-regression, route-sync,
skip-flow, stage-tools, toast-regression, ui-simplification) · `frontend-url-state.test.ts` ·
`frontend-video-export-runtime.test.ts` · `frontend-fullscreen.test.ts` ·
`split-view-browse.test.ts` · `workspace-activity.test.ts` · `workspace-first-fold-actions.test.ts` ·
`workspace-youtube-preview.test.ts` · `stage-gestures.test.tsx` ·
`stage-warp-gizmo.test.tsx` · `preflight-mobile-visibility.test.ts` · `mobile-viewport-matrix.test.ts` ·
`use-auto-hide-activity.test.tsx` · `use-focus-trap.test.tsx` · `use-lazy-factory.test.ts` ·
`shader-identicon-component.test.tsx`

## Services / state / quality

`adaptive-quality-controller.test.ts` · `continuous-drs.test.ts` · `temporal-memory.test.ts` ·
`frame-pacing.test.ts` · `power-state.test.ts` · `simulation-accumulator.test.ts` ·
`device-profile.test.ts` · `device-refresh-rate.test.ts` · `performance-hardware-controls.test.ts` ·
`performance-settings-store.test.ts` · `domain-store.test.ts` · `crash-telemetry.test.ts` ·
`services-pool.test.ts` · `webmidi-controller.test.ts` ·
`microphone-permission-service.test.ts` · `optional-api.test.ts` · `visual-embedding.test.ts` ·
`render-service-prewarm.test.ts`

## Toy / agent / automation

`agent-api.test.ts` · `agent-bridge.test.ts` · `toy-*.test.ts` (inline-handlers, renderer-native-capture,
runtime-starter, viewport-session, sample-toy) · `shared-initializer.test.ts` · `unified-input.test.ts` ·
`webgl-check.test.ts` · `synthetic-stimulus.test.ts` · `mcp-server.test.ts` · `sync-room-protocol.test.ts`

## Parity / evidence / corpus (slow — `all` profile)

`tests/corpus/milkdrop-parity.test.ts` · `milkdrop-corpus-compat.test.ts` ·
`milkdrop-projectm-compat.test.ts` · `butterchurn-corpus-support.test.ts` ·
`run-parity-diff-suite.test.ts` · `native-projectm-reference.test.ts` ·
`promote-projectm-reference.test.ts` · `visual-reference-manifest.test.ts` ·
`measured-visual-results.test.ts` · `parity-artifacts.test.ts` · `parity-artifact-prune.test.ts` ·
`diff-parity-artifacts.test.ts` · `check-catalog-integrity.test.ts`

## Docs / metadata guards (validate the repo, not runtime)

`check-architecture.test.ts` · `check-ci-config.test.ts` · `check-commit-msg.test.ts` ·
`check-duplicate-css.test.ts` · `run-quality-gate.test.ts` · `check-catalog-integrity.test.ts` ·
`codex-*.test.ts` (model-route, session-script, setup-script) · `generate-seo.test.ts` ·
`seo-canonical-intent.test.ts` · `check-no-ts-nocheck` (script) · `check-doc-references` (script) ·
`check-readme-claims` (script) · `check-cache-bounds.test.ts`

## Visual / regression / accessibility

`tests/accessibility/accessibility-regression.test.tsx` · `preset-visual-regression-capture.ts` (script) ·
`parity:capture` / `parity:suite` (scripts) · `tests/e2e/e2e-engine-mount.test.ts` ·
`tests/e2e/agent-integration.test.ts` (the `integration` profile)