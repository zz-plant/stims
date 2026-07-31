# Technical Achievements

This document highlights the core technical achievements and engineering systems built into **Stims**.

---

## 1. In-Browser JIT Compiler & VM for Legacy MilkDrop DSL

- **JIT Compilation Engine**: Implemented in [`src/js/milkdrop/expression-jit.ts`](../src/js/milkdrop/expression-jit.ts), compiling Winamp MilkDrop per-frame, per-vertex, custom wave, custom shape, and warp math equations (EEL2 / HLSL-like DSL) directly into zero-closure, high-throughput JavaScript functions in the browser.
- **MilkDrop State & Memory Emulation**: Emulates Winamp MilkDrop's memory buffers in [`src/js/milkdrop/vm.ts`](../src/js/milkdrop/vm.ts) and [`src/js/milkdrop/vm-gpu.ts`](../src/js/milkdrop/vm-gpu.ts), including per-preset memory (`megabuf` of 65,536 floats) and persistent inter-preset memory (`gmegabuf` of 1,048,576 floats).
- **Multi-Target Lowering**: Uses an intermediate AST representation in [`src/js/milkdrop/compiler/ir.ts`](../src/js/milkdrop/compiler/ir.ts) to lower equations into WebGL GLSL ([`src/js/milkdrop/compiler/shader-analysis-glsl.ts`](../src/js/milkdrop/compiler/shader-analysis-glsl.ts)), WebGPU WGSL ([`src/js/milkdrop/compiler/wgsl-generator.ts`](../src/js/milkdrop/compiler/wgsl-generator.ts)), and Three.js Shading Language / TSL ([`src/js/milkdrop/compiler/tsl-generator.ts`](../src/js/milkdrop/compiler/tsl-generator.ts)).

---

## 2. Dual WebGPU / WebGL2 Rendering Architecture & Resilient Fallback Chains

- **Next-Gen WebGPU Renderer**: Complete WebGPU pipeline featuring segment batching ([`src/js/milkdrop/renderer-adapter-webgpu-batching.ts`](../src/js/milkdrop/renderer-adapter-webgpu-batching.ts)), compute pipelines, and TSL feedback managers ([`src/js/milkdrop/feedback-manager-webgpu-tsl.ts`](../src/js/milkdrop/feedback-manager-webgpu-tsl.ts)).
- **Granular Optimization Rollout Flags**: Independent flag gating ([`src/js/milkdrop/webgpu-optimization-flags.ts`](../src/js/milkdrop/webgpu-optimization-flags.ts)) for main wave, trail waves, mesh fields, motion vectors, and feedback shaders via URL parameters and `localStorage`.
- **Zero-Interruption Fallback Chains**: Real-time capability probing ([`src/js/core/renderer-capabilities.ts`](../src/js/core/renderer-capabilities.ts)) and execution classification ([`src/js/milkdrop/compiler/shader-execution-classification.ts`](../src/js/milkdrop/compiler/shader-execution-classification.ts)) categorize shader programs into executable states, automatically falling back to WebGL2 without crashing or dropping frames.

---

## 3. Serverless AI Generation, Algorithmic Preset Blending & Vision Processing

- **Text-to-MilkDrop AI Compiler**: Cloudflare Worker edge API ([`functions/api/generate-preset.ts`](../functions/api/generate-preset.ts)) that translates natural language prompts (*e.g., "neon waves pulsing through a starfield"*) into syntactically valid MilkDrop equations using models like Qwen 2.5 Coder 32B.
- **Parallel Batch Generation**: Concurrent job dispatch ([`functions/api/batch-generate.ts`](../functions/api/batch-generate.ts)) producing 5 distinct variations of a prompt simultaneously.
- **AST Preset Blending Engine**: Algorithmic AST preset blender ([`functions/api/blend-presets.ts`](../functions/api/blend-presets.ts)) that extracts motion vectors from Preset A and color/atmosphere equations from Preset B, unifying them into a coherent new preset.
- **Multimodal Image-to-Preset**: Image analysis endpoint ([`functions/api/image-to-preset.ts`](../functions/api/image-to-preset.ts)) converting screenshot aesthetics into synthesized MilkDrop equations.

---

## 4. Edge Semantic Vector Search & Audio-Reactive Preset Matching

- **Vector Similarity Search**: Indexes 1,868+ presets using BGE embeddings stored in Cloudflare D1 ([`functions/api/visual-search.ts`](../functions/api/visual-search.ts)). Performs in-memory TTL-cached cosine similarity searches over normalized `Float32Array` vectors at the edge.
- **Audio-Reactive Matching**: Monitors live audio spectral energy dynamics (bass, mid, treble) in [`src/js/milkdrop/audio-signal-processor.ts`](../src/js/milkdrop/audio-signal-processor.ts) and dynamically recommends presets with matching visual motion profiles.

---

## 5. IDE-Grade MilkDrop CodeMirror 6 Editor & Live Variable Patching

- **Custom Language Environment**: CodeMirror 6 workspace integrated into [`src/js/milkdrop/overlay/editor-panel.ts`](../src/js/milkdrop/overlay/editor-panel.ts) featuring MilkDrop EEL/HLSL syntax highlighting, code folding, bracket matching, 60+ MilkDrop completions, and 14 template snippets.
- **Live Parameter Tuning**: Real-time slider sidebar (`zoom`, `warp`, `rot`, `decay`, `hue`) directly patches live VM register values without resetting rendering state or interrupting audio playback.
- **AI Quick Fix & Diagnostics**: Real-time AST compiler diagnostics (`computeAstDiagnostics`) surface line-by-line compiler errors, with one-click AI correction routing shader errors back to edge models for automatic syntax repair.

---

## 6. Low-Latency Audio Processing & Zero-Dependency Synthetic Audio Generator

- **Off-Main-Thread AudioWorklet DSP**: AudioWorklet processor ([`src/js/utils/frequency-analyser-processor.ts`](../src/js/utils/frequency-analyser-processor.ts)) calculates 4-band transient metrics, energy envelope tracking, and multi-band energy levels (`bass`, `mid`, `treble`, `subBass`, `kick`) off the main thread.
- **Multi-Source Audio Engine**: Integrated handler ([`src/js/core/audio-handler.ts`](../src/js/core/audio-handler.ts)) managing microphone input, browser tab capture, YouTube routing, audio files, and a built-in zero-dependency Web Audio synthesizer (arpeggiator + kick drum + sub drone).
- **WebGPU Shared Audio Texture**: Uploads FFT frequency and waveform data directly into a 512x2 RGBA GPU texture ([`src/js/core/audio-gpu-texture.ts`](../src/js/core/audio-gpu-texture.ts)) for zero-copy shader access.

---

## 7. Agent Automation API & Headless Verification Harness

- **Programmatic Session API**: Exposes runtime state, debug snapshots, audio source selection, and lifecycle event callbacks via `window.stimState` ([`src/js/core/agent-api.ts`](../src/js/core/agent-api.ts)).
- **Automation & QA Suite**: Supports headless execution via the `?agent=true` URL query parameter for AI agent automation and automated integration testing ([`tests/agent-integration.test.ts`](../tests/agent-integration.test.ts)).

---

## 8. Zero-Router URL State Architecture

- **Native History API Synchronization**: High-performance URL state management ([`src/js/frontend/url-state.ts`](../src/js/frontend/url-state.ts)) eliminating client-side router overhead.
- **Deep-Link State Retention**: Synchronizes active tools, preset collections, audio modes, agent flags, and override parameters directly in URL search params with popstate back/forward support.
