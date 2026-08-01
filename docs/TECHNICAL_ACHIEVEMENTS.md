# Technical foundations and evidence status

This document maps Stims' implemented engineering systems without turning scaffolding, optional services, or roadmap work into shipped-product claims.

## 1. Preset compiler and VM — implemented

- [`src/js/milkdrop/expression-jit.ts`](../src/js/milkdrop/expression-jit.ts) compiles preset equations into browser-executable functions.
- [`src/js/milkdrop/vm.ts`](../src/js/milkdrop/vm.ts) and its focused modules model preset state, registers, custom waves and shapes, `megabuf`, and `gmegabuf` behavior.
- [`src/js/milkdrop/compiler/ir.ts`](../src/js/milkdrop/compiler/ir.ts) provides a shared intermediate representation for runtime execution and backend-specific lowering.
- Direct `.milk` import and export keep the authoring format visible to users instead of requiring a renderer-specific JSON representation.

Compilation and runtime stepping are necessary compatibility evidence. They do not, by themselves, prove visual fidelity.

## 2. WebGL2 baseline and guarded WebGPU path — implemented, partially certified

- WebGL2 remains the compatibility baseline.
- [`src/js/core/renderer-capabilities.ts`](../src/js/core/renderer-capabilities.ts) probes browser support and records renderer decisions.
- [`src/js/milkdrop/compiler/shader-execution-classification.ts`](../src/js/milkdrop/compiler/shader-execution-classification.ts) classifies shader programs before runtime selection.
- WebGPU batching, descriptors, WGSL generation, and TSL feedback work live behind independent rollout flags and fallback rules.

The WebGPU path is not presented as broadly visually equivalent. Current certification status lives in [`src/data/milkdrop-parity/webgpu-certification-report.json`](../src/data/milkdrop-parity/webgpu-certification-report.json), and measured results require trusted projectM reference captures.

## 3. Browser-native workspace — implemented

- [`src/js/frontend/App.tsx`](../src/js/frontend/App.tsx) owns the single product workspace.
- Catalog search, collection filters, rendered previews, favorites, queues, recent history, and session state are integrated around the running visualizer.
- [`src/js/frontend/url-state.ts`](../src/js/frontend/url-state.ts) retains preset, collection, audio, tool, and automation state in URL query parameters.
- Progressive catalog loading and bounded preview work keep the large imported library usable on constrained devices.

This product layer—not graphics API branding—is the primary differentiation from engine-only integrations.

## 4. Live preset editor — implemented

- [`src/js/milkdrop/overlay/editor-panel.ts`](../src/js/milkdrop/overlay/editor-panel.ts) integrates CodeMirror with MilkDrop-oriented completions, snippets, diagnostics, and line navigation.
- Live controls patch common values such as `zoom`, `warp`, `rot`, and `decay` in the active authoring session.
- Import, edit, inspect, and export actions operate around the same running preset.

Optional edge-assisted fixes and blending are separate from the local editor contract and may require deployed API configuration.

## 5. Audio analysis and sources — implemented; stem separation not implemented

- [`src/js/utils/audio/frequency-analyser-processor.ts`](../src/js/utils/audio/frequency-analyser-processor.ts) calculates waveform, band-energy, transient, and envelope data in an AudioWorklet when available.
- [`src/js/core/audio-handler.ts`](../src/js/core/audio-handler.ts) coordinates demo, microphone, tab, YouTube, and local-file paths subject to browser support and permissions.
- [`src/js/core/audio-gpu-texture.ts`](../src/js/core/audio-gpu-texture.ts) packs frequency and waveform data into a shared GPU texture allocation for renderer consumption.

Stem-oriented runtime identifiers are reserved for future use. The repository does not currently perform client-side vocal, drum, bass, or instrument separation.

## 6. Browser audio-video recording — beta, browser proof pending

- [`src/js/frontend/CapturePanel.tsx`](../src/js/frontend/CapturePanel.tsx) exposes landscape and portrait recording targets.
- [`src/js/utils/media/canvas-video-exporter.ts`](../src/js/utils/media/canvas-video-exporter.ts) records with `MediaRecorder`, can compose a cloned active audio track, and uses a native renderer-resize contract for the 4K target.
- [`src/js/frontend/engine/video-export-runtime.ts`](../src/js/frontend/engine/video-export-runtime.ts) switches renderer, camera, and MilkDrop targets to the requested native dimensions and restores the session afterward.

The implementation still depends on browser codec and allocation support. Unit coverage proves lifecycle and track composition; it does not yet prove encoded resolution, synchronization, frame pacing, or sustained 4K output in supported browsers.

## 7. Optional edge services — implemented routes, deployment-dependent product behavior

The repository contains Cloudflare Worker routes for preset generation, batch generation, blending, image-guided generation, visual search, and community storage. The local application does not require them for playback, catalog browsing, editing, or import/export.

The bundled Generate panel now calls [`src/js/milkdrop/preset-generator.ts`](../src/js/milkdrop/preset-generator.ts) through either a configured hosted route or a loopback OpenAI-compatible endpoint, and compiles the returned source before loading it. That implementation is model-backed, but hosted deployment availability, local browser configuration, output quality, and the full generated-preset user flow still require end-to-end verification. Blending and the other optional services are not part of that bundled flow.

## 8. Automation and visual evidence — implemented

- [`src/js/core/agent-api.ts`](../src/js/core/agent-api.ts) exposes session state and controls for headless verification.
- `?agent=true` provides the canonical automation route.
- Native projectM capture metadata, checked-in references, backend-aware browser captures, image diffs, and promoted measured results form the compatibility evidence chain.
- [`scripts/check-toys.ts`](../scripts/check-toys.ts) prevents the public README preset count and selected product claims from drifting beyond their implementation evidence.

See [`MILKDROP_PROJECTM_PARITY_PLAN.md`](./MILKDROP_PROJECTM_PARITY_PLAN.md) for the complete capture and promotion workflow.

## Foundations that are not shipped workflows

| Foundation | Current status |
| --- | --- |
| WebMIDI workflow | Workspace settings connect mapped CC values to live parameters; persistent mappings, recovery behavior, and device-backed verification remain open. |
| WebXR stage | Workspace settings can attach an immersive session to the active renderer; headset rendering, spatial audio, and recovery lack device-backed proof. |
| Stem-oriented signals | Runtime fields exist; separation and real signal population do not. |
| Creator-certified high-resolution export | Native resize and audio-track composition are implemented; encoded output and synchronization still need browser-backed certification. |
| Model-backed Generate panel | Hosted and loopback provider paths are wired; availability, output quality, and the full browser flow still need end-to-end proof. |
