# WebGL/WebGPU Architectural Revamp Plan

This plan addresses structural issues in the dual-backend rendering pipeline identified during the [Stims renderer evaluation](./ARCHITECTURE.md).

## Problem Summary

1. **WebGPU feedback pipeline goes through WebGL internals** — `WebGLRenderTarget` is used exclusively in the shared feedback manager, meaning even WebGPU sessions run feedback through WebGL
2. **1400-line TSL duplication** — `feedback-manager-webgpu-tsl.ts` manually mirrors the GLSL composite shader as TSL node graphs
3. **Worker renderer is WebGPU-only with no fallback** — `renderer-worker.ts` throws if WebGPU is unavailable
4. **WGSL codegen is scalar-only** — `wgsl-generator.ts` never vectorizes
5. **No RenderBundle or OffscreenCanvas transfer** — capability detection exists but implementation is absent
6. **Default-off posture limits real-world WebGPU testing** — compatibility gap guards keep most users on WebGL

## Workstreams

### 1) Unify Feedback Pipeline to Be Backend-Native

**Objective**: Make feedback render targets backend-aware so WebGPU sessions don't round-trip through WebGL internals.

**Key changes**:
- Extract `createFeedbackRenderTarget` as a backend-aware factory
- Implement WebGPU render target variant using `three/webgpu`
- Route `setRenderTarget` calls through the renderer, not hardcoded WebGL assumptions

**Files**:
- `assets/js/milkdrop/feedback-manager-shared.ts`
- `assets/js/milkdrop/feedback-manager-webgpu-tsl.ts`  
- `assets/js/milkdrop/renderer-adapter-core.ts`

### 2) Consolidate Composite Shader Source of Truth

**Objective**: Eliminate the GLSL/TSL dual-maintenance problem.

**Key changes**:
- Define composite pipeline as a declarative IR
- Generate both GLSL and TSL from the single IR
- Explore using TSL for both backends (TSL can emit GLSL)

**Files**:
- New: `assets/js/milkdrop/feedback-composite-ir.ts`
- `assets/js/milkdrop/feedback-manager-shared.ts`
- `assets/js/milkdrop/feedback-manager-webgpu-tsl.ts`

### 3) Add WebGL Fallback to Worker Renderer

**Objective**: Make offscreen rendering available on WebGL-only devices.

**Key changes**:
- Add `WorkerWebGLOffscreenRenderer` using `OffscreenCanvas.getContext('webgl2')`
- Route via existing message protocol
- Keep worker WebGL path simple (no feedback/batching)

**Files**:
- `assets/js/core/renderer-worker.ts`
- `assets/js/core/renderer-worker-protocol.ts`
- `assets/js/core/renderer-setup.ts`

### 4) Vectorize WGSL Code Generation

**Objective**: Generate `vec2f`/`vec3f` WGSL types where expression trees operate on related scalars.

**Key changes**:
- Track value "width" through expression tree
- Emit vectorized WGSL when all operands share a width
- Fuse adjacent scalar assignments into vector assignments

**Files**:
- `assets/js/milkdrop/compiler/wgsl-generator.ts`
- `assets/js/milkdrop/vm-gpu.ts`

### 5) Implement RenderBundle for Static Draw Calls

**Objective**: Pre-record static draw commands to reduce per-frame CPU overhead.

**Key changes**:
- Identify static draw calls (background quad, border outlines)
- Pre-record as WebGPU RenderBundles
- Execute bundles in render pass

**Files**:
- New: `assets/js/milkdrop/renderer-bundles.ts`
- `assets/js/milkdrop/renderer-adapter-core.ts`

### 6) Gradual WebGPU Enablement

**Objective**: Phase WebGPU enablement by platform instead of universal off.

**Key changes**:
- Platform-specific gating (Chrome 120+ desktop first)
- Track engagement/error/fallback rates via telemetry

**Files**:
- `assets/js/core/renderer-query-override.ts`

## Sequencing

| Milestone | Workstream(s) | Dependency |
|---|---|---|
| **A: Safe Wins** | 4 (Vectorize WGSL), 5 (RenderBundles) | None — additive |
| **B: Worker Completeness** | 3 (Worker WebGL fallback) | None — additive |
| **C: Pipeline Unification** | 1 (Backend-native feedback), 2 (Single IR) | Matures together |
| **D: Rollout** | 6 (Gradual enablement) | After C passes visual parity |

## Validation

- `bun run check` green throughout
- `bun run check:toys` for toy compatibility
- Visual parity: certification corpus diffs against baseline
- Performance: benchmark before/after for each milestone

## Rollback

Each workstream ships behind a feature flag (optimization flag or URL param), allowing per-workstream rollback without reverting the entire revamp.