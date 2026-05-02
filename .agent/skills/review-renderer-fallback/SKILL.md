---
name: review-renderer-fallback
description: "Review changes to renderer capability probing, fallback chains, timeout logic, or audio worklet initialization. Use when a PR touches assets/js/core/renderer-*, assets/js/core/audio-handler.ts, or assets/js/milkdrop/runtime/backend-fallback.ts."
---

# Review Renderer Fallback and Capability Lifecycle

Use this skill when reviewing or authoring changes to renderer setup, capability probing, fallback transitions, timeout handling, or audio worklet paths.

## Why this exists

~25% of fix commits are in the fallback chain: WebGPU timeout regressions, renderScale propagation failures, analyser worklet path breaks, and capability probe drift. This skill hardens that boundary.

## Pre-merge checklist

### 1. Fallback transitions must be explicit

- [ ] The change does not add a new implicit ordering dependency (e.g., "must call X before Y" without a state check).
- [ ] If adding a new fallback branch, document the transition matrix:

  ```text
  From State        | Condition                  | To State
  ------------------|----------------------------|------------------
  probing-webgpu    | timeout > N ms             | probing-webgl
  probing-webgl     | webgl unsupported          | error-no-backend
  ...
  ```

### 2. renderScale propagation end-to-end

- [ ] If touching `renderer-capabilities.ts`, `renderer-plan.ts`, `renderer-query-override.ts`, or `render-service.ts`, trace renderScale from:
  1. Capability probe computation
  2. Plan/override application
  3. Pooled renderer initialization
  4. Runtime frame update

- [ ] Add or update a test in `tests/renderer-setup.test.ts` or `tests/milkdrop-runtime-seams.test.ts` that asserts the propagated value matches the expected chain.

### 3. Audio worklet validated on fallback path

- [ ] If touching `audio-handler.ts` or `renderer-setup.ts`, confirm the analyser worklet initializes correctly when:
  - WebGPU is forced off
  - WebGL is forced off (error path)
  - Preferred backend is overridden by query param

  ```bash
  bun run test:integration
  ```

### 4. Timeout and cleanup

- [ ] Any new timeout has a matching cleanup/cancel path.
- [ ] Any new event listener or observer in the capability probe has a removal path in dispose/teardown.

### 5. Property-based mindset

- [ ] Consider: given any combination of `{webgpuSupported, webglSupported, timeoutMs, preferredBackend, queryOverride}`, does the code always reach a valid renderer + audio context pair?
- [ ] If the answer is "no" or "unclear," add a test or refactor to an explicit state machine.

## What to reject in review

- Nested `if/else` fallback chains deeper than 2 levels without a state-machine refactor
- renderScale computed in one file and applied in another without a typed contract
- Audio worklet initialization that assumes a specific backend is already chosen
- Missing tests for new timeout or fallback branches

## Related skills

- [`modify-visualizer-runtime`](../../modify-visualizer-runtime/SKILL.md) — for broader runtime changes
- [`test-visualizer`](../../test-visualizer/SKILL.md) — for running integration coverage
