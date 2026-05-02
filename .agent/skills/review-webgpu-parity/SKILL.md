---
name: review-webgpu-parity
description: "Review changes to WebGPU/WebGL dual-backend parity. Use when a PR touches feedback managers, renderer adapters, shader lowering, or any code that affects both WebGPU and WebGL rendering paths."
---

# Review WebGPU/WebGL Parity

Use this skill when reviewing or authoring changes to `assets/js/milkdrop/feedback-manager-*`, `assets/js/milkdrop/renderer-adapter*`, `assets/js/milkdrop/backend-behavior.ts`, `assets/js/milkdrop/compiler/gpu-descriptor-plan.ts`, or any shader-lowering code.

## Why this exists

The most frequent source of fixes in this repo (~35% of fix commits) is parity drift between WebGPU and WebGL: alpha blending order, feedback color math, wave interpolation, resolution scales, and shader lowering. This skill prevents those regressions at review time.

## Pre-merge checklist

### 1. Both backends must be exercised

- [ ] `bun run test:compat` passes
- [ ] If the change touches shader generation or feedback sampling, run the parity reference suite:

  ```bash
  bun run test tests/milkdrop-renderer-adapter.test.ts
  bun run test tests/milkdrop-feedback-composite-profile.test.ts
  bun run test tests/milkdrop-shader-sampler-aliases.test.ts
  ```

- [ ] If the change touches compiler IR or GPU descriptor plans, run:

  ```bash
  bun run test tests/milkdrop-compiler.test.ts
  bun run test tests/milkdrop-compiler-seams.test.ts
  ```

### 2. No hardcoded backend-specific values without comment

- [ ] Every literal resolution scale, target size, sampler config, or blend factor is either:
  - a shared constant with a name explaining its parity role, or
  - accompanied by a comment explaining the WebGPU vs. WebGL semantic difference

### 3. Blend alpha order verified

- [ ] If changing wave, shape, or custom-wave blend behavior, confirm the additive/multiplicative/alpha order matches the projectM baseline.
- [ ] Prefer adding a regression test (see `tests/milkdrop-renderer-adapter.test.ts` for patterns).

### 4. Reference presets must not shift

- [ ] If the PR changes the render pipeline, verify against at least one of:
  - `eos-phat-cubetrace-v2`
  - `krash-rovastar-cerebral-demons-stars`
  - `rovastar-parallel-universe`

  ```bash
  bun run dev
  # Load preset, compare visual output to baseline or upstream projectM
  ```

### 5. Shader lowering comments

- [ ] Any change to `compiler/gpu-descriptor-plan.ts`, lowered field handling, or shader center normalization includes a comment explaining how the generated GPU code differs between WebGL and WebGPU.

## What to reject in review

- Unconditional `if (isWebGPU)` branches that duplicate logic without a shared helper
- New `innerHTML` or string-built shader code without a corresponding test fixture
- Changes to `feedback-manager-shared.ts` that do not also update `feedback-manager-webgpu.ts` (or explain why not)
- Missing regression tests for fixed parity bugs

## Related skills

- [`modify-preset-workflow`](../../modify-preset-workflow/SKILL.md) — when the change is mainly preset content, not renderer parity
- [`modify-visualizer-runtime`](../../modify-visualizer-runtime/SKILL.md) — when the change is broader runtime/shell work
- [`test-visualizer`](../../test-visualizer/SKILL.md) — for running the full validation suite
